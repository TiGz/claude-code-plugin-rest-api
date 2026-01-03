# Queue-Based Async Request/Response for Claude Agents

## Overview

Add async request/response support via message queues to complement the existing REST API. Agents will listen for requests on input queues and publish responses to output queues, enabling decoupled, scalable architectures.

**Key Decisions:**
- **Separate QueueModule** - Users import `QueueModule.forRoot()` alongside `ClaudePluginModule.forRoot()`
- **pg-boss first** - Uses PostgreSQL (ideal for AWS ECS/RDS - no additional Redis infrastructure)
- **Request/response only** - No streaming over queues (keeps implementation simple)

---

## Architecture

### Message Flow

```
┌─────────────────┐     ┌───────────────────────────────────────┐     ┌─────────────────┐
│  External       │     │  Claude Agent REST API Server         │     │  External       │
│  Producer       │     │                                       │     │  Consumer       │
│                 │     │  ┌─────────────────────────────────┐  │     │                 │
│  Publishes to:  │────▶│  │  QueueWorkerService             │  │     │  Subscribes to: │
│  claude.agents. │     │  │  - Subscribes to request queues │  │     │  claude.responses│
│  {name}.requests│     │  │  - Calls AgentService.execute() │──│────▶│  .{correlationId}│
│                 │     │  │  - Publishes to response queue  │  │     │                 │
└─────────────────┘     │  └─────────────────────────────────┘  │     └─────────────────┘
                        │                                       │
                        │  ┌─────────────────────────────────┐  │
                        │  │  QueueAdapter (interface)       │  │
                        │  │  - PgBossAdapter (PostgreSQL)   │  │
                        │  │  - BullMQAdapter (Redis) [later]│  │
                        │  └─────────────────────────────────┘  │
                        └───────────────────────────────────────┘
```

### Request/Response Correlation

1. Producer generates a unique `correlationId` before enqueuing
2. Request includes `correlationId` in metadata
3. Worker processes request via `AgentService.execute()`
4. Response published to queue keyed by `correlationId`
5. Consumer fetches response from their response queue

---

## Message Schemas

### Request Message

```typescript
interface AgentRequestMessage {
  agentName: string;
  payload: {
    prompt?: string;                    // Standard prompt mode
    body?: Record<string, unknown>;     // Custom body for requestSchema agents
  };
  metadata: {
    correlationId: string;              // Required: links request to response
    requestedAt: string;                // ISO timestamp
    userContext?: Record<string, unknown>; // Optional: auth info, tenant, etc.
    traceId?: string;                   // Optional: distributed tracing
    responseTtl?: number;               // Optional: response expiry (seconds)
  };
}
```

### Response Message

```typescript
interface AgentResponseMessage {
  correlationId: string;
  result: {
    success: boolean;
    result?: string;
    structuredOutput?: unknown;
    error?: string;
    cost?: number;
    turns?: number;
    usage?: { inputTokens: number; outputTokens: number };
  };
  completedAt: string;
  durationMs: number;
  metadata: { /* echoed from request */ };
}
```

---

## Queue Naming Convention

pg-boss uses dot notation for queue names:

| Purpose | Queue Name |
|---------|------------|
| Agent requests | `claude.agents.{agentName}.requests` |
| Responses | `claude.responses.{correlationId}` |

---

## Module Configuration

```typescript
import { ClaudePluginModule, QueueModule } from '@tigz/claude-code-plugin-rest-api';

@Module({
  imports: [
    ClaudePluginModule.forRoot({
      agents: {
        'async-processor': {
          systemPrompt: 'You process async requests.',
          permissionMode: 'bypassPermissions',
        },
      },
    }),

    // Separate QueueModule for async processing
    QueueModule.forRoot({
      adapter: 'pgboss',
      pgboss: {
        connectionString: process.env.DATABASE_URL,
      },
      config: {
        agents: ['async-processor'],  // Optional: defaults to all registered agents
        consumerGroup: 'worker-1',    // For horizontal scaling with ECS
      },
    }),
  ],
})
export class AppModule {}
```

---

## Implementation Plan

### Phase 1: Core Types and Interface

**Files to create:**
- `packages/claude-code-plugin-rest-api/src/queue/queue.types.ts`
- `packages/claude-code-plugin-rest-api/src/queue/queue.tokens.ts`
- `packages/claude-code-plugin-rest-api/src/queue/queue-adapter.interface.ts`

**Tasks:**
1. Define `AgentRequestMessage`, `AgentResponseMessage` types
2. Define `QueueMessageMetadata` interface with correlationId, userContext, etc.
3. Define `QueueAdapter` interface with methods:
   - `connect()` / `disconnect()`
   - `subscribeRequests(agentName)` → `Observable<AgentRequestMessage>`
   - `publishResponse(response)`
   - `publishRequest(request)` (for testing)
   - `subscribeResponse(correlationId)` → `Observable<AgentResponseMessage>`
   - `isHealthy()`
4. Define `QueueNamingStrategy` interface and default implementation
5. Create DI tokens: `QUEUE_ADAPTER`, `QUEUE_CONFIG`

### Phase 2: pg-boss Adapter (Primary)

**Files to create:**
- `packages/claude-code-plugin-rest-api/src/queue/adapters/pgboss.adapter.ts`

**Tasks:**
1. Implement `PgBossAdapter` class implementing `QueueAdapter`
2. Use `boss.send()` for publishing requests
3. Use `boss.work()` for consuming requests (with teamSize for ECS horizontal scaling)
4. Use dedicated response queues with singletonKey for correlation
5. Implement `subscribeResponse()` with polling + in-memory notification
6. Add health check via database query
7. Configure appropriate archive/delete policies for job cleanup

**Dependencies:** `pg-boss` (add as dependency)

### Phase 3: Queue Worker Service

**Files to create:**
- `packages/claude-code-plugin-rest-api/src/queue/queue-worker.service.ts`

**Tasks:**
1. Create `QueueWorkerService` implementing `OnModuleInit`, `OnModuleDestroy`
2. On init: connect adapter, subscribe to configured agents
3. For each request:
   - Resolve prompt from `payload.prompt` or `payload.body` (using requestSchema template)
   - Call `AgentService.execute()`
   - Publish response message
4. Handle errors gracefully (publish error response, don't throw)
5. On destroy: unsubscribe all, disconnect adapter

### Phase 4: Queue Module

**Files to create:**
- `packages/claude-code-plugin-rest-api/src/queue/queue.module.ts`
- `packages/claude-code-plugin-rest-api/src/queue/index.ts`

**Tasks:**
1. Create `QueueModule` with `forRoot()` and `forRootAsync()` methods
2. Factory to instantiate adapter based on `adapter` option
3. Import AgentService from ClaudePluginModule
4. Register `QueueWorkerService` as provider
5. Export adapter and worker service

### Phase 5: Integration and Exports

**Files to modify:**
- `packages/claude-code-plugin-rest-api/src/index.ts`
- `packages/claude-code-plugin-rest-api/src/services/agent.service.ts` (minor: add `getAgentNames()`)

**Tasks:**
1. Export queue types, module, and adapter interface from package index
2. Add `getAgentNames(): string[]` to AgentService for worker autodiscovery
3. Document usage in CLAUDE.md

### Phase 6: BullMQ Adapter (Future)

**Files to create:**
- `packages/claude-code-plugin-rest-api/src/queue/adapters/bullmq.adapter.ts`

**Tasks:** (implement later if Redis support needed)
1. Implement `BullMQAdapter` class implementing `QueueAdapter`
2. Use `Queue` for publishing, `Worker` for consuming
3. Use Redis pub/sub for response notifications

### Phase 7: Testing

**Files to create:**
- `examples/basic-server/test/queue.e2e-spec.ts`
- `packages/claude-code-plugin-rest-api/src/queue/adapters/__tests__/pgboss.adapter.spec.ts`

**Tasks:**
1. Unit tests for PgBossAdapter (mock pg-boss)
2. E2E tests using in-memory mock or testcontainers
3. Local integration tests with real PostgreSQL

---

## File Structure

```
packages/claude-code-plugin-rest-api/src/
├── queue/
│   ├── index.ts                       # Public exports
│   ├── queue.types.ts                 # Message schemas
│   ├── queue.tokens.ts                # DI tokens
│   ├── queue.module.ts                # NestJS module
│   ├── queue-adapter.interface.ts     # Adapter interface
│   ├── queue-worker.service.ts        # Worker service
│   └── adapters/
│       ├── pgboss.adapter.ts          # pg-boss implementation (primary)
│       └── bullmq.adapter.ts          # BullMQ implementation (future)
└── index.ts                           # Add queue exports
```

---

## User Context Propagation

User context flows through the system as follows:

1. **Producer** includes arbitrary context in `metadata.userContext`:
   ```json
   {
     "agentName": "async-processor",
     "payload": { "prompt": "Process this data" },
     "metadata": {
       "correlationId": "abc-123",
       "requestedAt": "2025-01-03T10:00:00Z",
       "userContext": {
         "userId": "user-456",
         "tenantId": "tenant-789",
         "role": "admin"
       }
     }
   }
   ```

2. **Worker** can access context for logging, authorization:
   ```typescript
   const { userContext } = request.metadata;
   logger.log(`Processing for tenant ${userContext?.tenantId}`);
   ```

3. **Response** echoes back original metadata for client correlation:
   ```json
   {
     "correlationId": "abc-123",
     "result": { "success": true, "result": "..." },
     "completedAt": "2025-01-03T10:00:05Z",
     "durationMs": 5000,
     "metadata": { /* echoed from request */ }
   }
   ```

---

## Horizontal Scaling with ECS

Multiple ECS tasks can process the same queue using pg-boss's competing consumer pattern:

```typescript
// ECS Task 1
QueueModule.forRoot({
  adapter: 'pgboss',
  pgboss: { connectionString: process.env.DATABASE_URL },
  config: { consumerGroup: `worker-${process.env.ECS_TASK_ID}` },
});

// ECS Task 2
QueueModule.forRoot({
  adapter: 'pgboss',
  pgboss: { connectionString: process.env.DATABASE_URL },
  config: { consumerGroup: `worker-${process.env.ECS_TASK_ID}` },
});
```

pg-boss uses PostgreSQL's row-level locking to ensure jobs are only processed once, making it safe for horizontal scaling.

---

## Dependencies

```json
{
  "dependencies": {
    "pg-boss": "^10.0.0"
  }
}
```

pg-boss is the only required dependency. BullMQ can be added later as an optional peer dependency if Redis support is needed.

---

## Critical Files to Modify

| File | Change |
|------|--------|
| `packages/claude-code-plugin-rest-api/src/services/agent.service.ts` | Add `getAgentNames()` method |
| `packages/claude-code-plugin-rest-api/src/index.ts` | Export queue types and module |
| `packages/claude-code-plugin-rest-api/package.json` | Add pg-boss dependency |
| `CLAUDE.md` | Document queue module usage |

---

## Why pg-boss for AWS ECS/RDS

1. **No additional infrastructure** - Uses your existing RDS PostgreSQL
2. **ACID guarantees** - PostgreSQL transactions ensure job delivery
3. **Native ECS compatibility** - Row-level locking works across ECS tasks
4. **Built-in job archival** - Automatic cleanup of completed jobs
5. **Simpler operations** - One fewer service to monitor and maintain
