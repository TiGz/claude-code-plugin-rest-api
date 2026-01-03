# Async Agents with Human-in-the-Loop

## Overview

Unified design for queue-based async agent execution with optional human-in-the-loop (HITL) approval flows. PostgreSQL-only via pg-boss. Designed for Slack, NOSTR, and other async messaging platforms.

**Core Principle:** HITL is an agent trait that activates only for queue-based execution. REST endpoints remain unchanged—fast, synchronous, no sessions.

---

## The Elegant Abstraction: ReplyChannel

The key insight: decouple *where* responses go from *how* we process requests. A single `replyTo` URI determines the destination:

```
slack://hooks.slack.com/T00/B00/XXX         → Slack webhook
slack-socket://channel/C123?thread=ts       → Slack Socket Mode reply
nostr://relay.damus.io?pubkey=npub1...      → NOSTR event
webhook://api.example.com/callback           → HTTP POST
queue://claude.responses.{correlationId}    → pg-boss queue
```

This means:
- One worker implementation handles all platforms
- Adding new platforms = implementing one `ReplyChannel` adapter
- HITL approval requests route through the same channel as results

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        External Systems                              │
│                                                                      │
│   Slack Bot          NOSTR Client         Custom Producer           │
│       │                   │                     │                   │
│       └───────────────────┴─────────────────────┘                   │
│                           │                                         │
│                     Publish Request                                 │
│                           ▼                                         │
└─────────────────────────────────────────────────────────────────────┘
                            │
        ┌───────────────────┴───────────────────┐
        │     pg-boss Request Queue             │
        │     claude.agents.{name}.requests     │
        └───────────────────┬───────────────────┘
                            │
┌───────────────────────────┼───────────────────────────────────────────┐
│                           ▼                                           │
│   ┌─────────────────────────────────────────────────────────────┐    │
│   │              AsyncAgentWorker                                │    │
│   │                                                              │    │
│   │  1. Dequeue request                                         │    │
│   │  2. Resolve ReplyChannel from replyTo URI                   │    │
│   │  3. If agent has HITL config:                               │    │
│   │     - Create session in PostgreSQL                          │    │
│   │     - Inject canUseTool with approval flow                  │    │
│   │  4. Call AgentService.execute()                             │    │
│   │  5. Send result via ReplyChannel                            │    │
│   └─────────────────────────────────────────────────────────────┘    │
│                           │                                           │
│   ┌───────────────────────┼───────────────────────────────────┐      │
│   │                       ▼                                    │      │
│   │   ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐   │      │
│   │   │ Slack       │  │ NOSTR       │  │ Queue           │   │      │
│   │   │ Channel     │  │ Channel     │  │ Channel         │   │      │
│   │   └──────┬──────┘  └──────┬──────┘  └────────┬────────┘   │      │
│   │          │                │                   │            │      │
│   │   ReplyChannel Adapters (pluggable)                       │      │
│   └───────────────────────────────────────────────────────────┘      │
│                                                                       │
│   Claude Agent REST API Server                                        │
└───────────────────────────────────────────────────────────────────────┘
                            │
                            ▼
              ┌─────────────────────────┐
              │   PostgreSQL            │
              │                         │
              │   - pg-boss job queues  │
              │   - async_sessions      │
              │   - approval_requests   │
              └─────────────────────────┘
```

---

## Message Schema

### Request Message

```typescript
interface AsyncAgentRequest {
  // Which agent to invoke
  agentName: string;

  // The prompt (or custom body for requestSchema agents)
  payload: {
    prompt?: string;
    body?: Record<string, unknown>;
  };

  // Correlation and routing
  correlationId: string;

  // Where this request originated
  origin: {
    platform: 'slack' | 'nostr' | 'api' | string;
    userId?: string;           // Platform user ID
    userName?: string;         // Display name for logging
    channelId?: string;        // Slack channel, NOSTR relay
    threadId?: string;         // Slack thread_ts, NOSTR event ID
    metadata?: Record<string, unknown>;
  };

  // Where to send responses (results + approval requests)
  replyTo: string;  // URI: slack://..., nostr://..., webhook://..., queue://...

  // Request timing
  requestedAt: string;         // ISO timestamp
  timeoutMs?: number;          // Max execution time (default: from agent config)
}
```

### Response Message

```typescript
interface AsyncAgentResponse {
  correlationId: string;

  // Echoed from request for routing
  origin: AsyncAgentRequest['origin'];

  // Execution result
  result: {
    success: boolean;
    output?: string;
    structuredOutput?: unknown;
    error?: string;
  };

  // Execution metadata
  completedAt: string;
  durationMs: number;
  cost?: { inputTokens: number; outputTokens: number; usd: number };
}
```

### Approval Request (for HITL)

```typescript
interface ApprovalRequest {
  correlationId: string;
  approvalId: string;
  sessionId: string;

  // What needs approval
  tool: {
    name: string;
    input: Record<string, unknown>;
    description?: string;        // Why the agent wants to use this tool
  };

  // Echoed from request for routing
  origin: AsyncAgentRequest['origin'];

  // Timing
  requestedAt: string;
  expiresAt: string;

  // How to respond
  approvalQueueName: string;     // Queue to publish approval decision
}
```

### Approval Decision

```typescript
interface ApprovalDecision {
  correlationId: string;
  approvalId: string;
  decision: 'approve' | 'deny' | 'modify';
  modifiedInput?: Record<string, unknown>;  // If decision is 'modify'
  reason?: string;
  decidedBy?: string;           // User who approved/denied
  decidedAt: string;
}
```

---

## Agent Configuration

HITL is configured per-agent, not per-request:

```typescript
ClaudePluginModule.forRoot({
  agents: {
    // Standard agent - no HITL, queue-enabled
    'summarizer': {
      systemPrompt: 'You summarize documents.',
      permissionMode: 'bypassPermissions',
    },

    // HITL-enabled agent
    'deploy-bot': {
      systemPrompt: 'You deploy code to production environments.',
      permissionMode: 'bypassPermissions',

      // HITL configuration - only applies to queue execution
      hitl: {
        // Tools requiring approval (glob patterns)
        requireApproval: [
          'Bash:*deploy*',
          'Bash:kubectl*',
          'Bash:terraform*',
        ],

        // Optional: auto-approve safe operations
        autoApprove: [
          'Bash:kubectl get*',
          'Read:*',
        ],

        // Approval timeout (default: 5 minutes)
        approvalTimeoutMs: 300_000,

        // What happens on timeout
        onTimeout: 'deny',  // 'deny' | 'abort'
      },
    },
  },
})

// Separate QueueModule for async processing
QueueModule.forRoot({
  connectionString: process.env.DATABASE_URL,

  // Which agents to enable for queue processing
  agents: ['summarizer', 'deploy-bot'],

  // Horizontal scaling identifier
  workerId: process.env.ECS_TASK_ID || 'worker-1',

  // Reply channel adapters to register
  replyChannels: {
    slack: new SlackReplyChannel({ /* config */ }),
    nostr: new NostrReplyChannel({ /* config */ }),
    webhook: new WebhookReplyChannel(),
    queue: new QueueReplyChannel(),  // Built-in, always available
  },
})
```

---

## HITL Flow

### Sequence Diagram

```
Producer          pg-boss              Worker            ReplyChannel       Approver
   │                 │                    │                   │                │
   │ publish request │                    │                   │                │
   │────────────────>│                    │                   │                │
   │                 │  dequeue job       │                   │                │
   │                 │───────────────────>│                   │                │
   │                 │                    │                   │                │
   │                 │                    │ execute agent     │                │
   │                 │                    │ (hits tool        │                │
   │                 │                    │  needing approval)│                │
   │                 │                    │                   │                │
   │                 │                    │ create session    │                │
   │                 │                    │ (PostgreSQL)      │                │
   │                 │                    │                   │                │
   │                 │                    │ send approval req │                │
   │                 │                    │──────────────────>│                │
   │                 │                    │                   │ (e.g., Slack   │
   │                 │                    │                   │  interactive   │
   │                 │                    │                   │  message)      │
   │                 │                    │                   │───────────────>│
   │                 │                    │                   │                │
   │                 │                    │   [worker blocks, │                │
   │                 │                    │    polling for    │                │
   │                 │                    │    approval]      │                │
   │                 │                    │                   │                │
   │                 │                    │                   │  user clicks   │
   │                 │                    │                   │<───────────────│
   │                 │                    │                   │  "Approve"     │
   │                 │                    │                   │                │
   │                 │ publish approval   │                   │                │
   │                 │<──────────────────────────────────────│                │
   │                 │                    │                   │                │
   │                 │ approval received  │                   │                │
   │                 │───────────────────>│                   │                │
   │                 │                    │                   │                │
   │                 │                    │ resume execution  │                │
   │                 │                    │ ...               │                │
   │                 │                    │ execution complete│                │
   │                 │                    │                   │                │
   │                 │                    │ send result       │                │
   │                 │                    │──────────────────>│                │
   │                 │                    │                   │ (e.g., Slack   │
   │                 │                    │                   │  thread reply) │
```

### Session State Machine

```
         ┌───────────────────────────────────────────────────┐
         │                                                   │
         │                    created                        │
         │                       │                           │
         │                       ▼                           │
         │                  ┌─────────┐                      │
         │                  │ running │◄────────┐            │
         │                  └────┬────┘         │            │
         │                       │              │            │
         │         tool needs approval?         │            │
         │            yes /        \ no         │            │
         │               /          \           │            │
         │              ▼            ▼          │            │
         │    ┌──────────────┐   execution      │            │
         │    │   waiting    │   continues      │            │
         │    │   approval   │                  │            │
         │    └──────┬───────┘                  │            │
         │           │                          │            │
         │    approved / denied / timeout       │            │
         │        │        │         │          │            │
         │        │        │         │          │            │
         │        ▼        │         │          │            │
         │    resume ──────│─────────│──────────┘            │
         │                 │         │                       │
         │                 ▼         ▼                       │
         │           ┌───────────────────┐                   │
         │           │     completed     │                   │
         │           │  (success/error)  │                   │
         │           └───────────────────┘                   │
         │                                                   │
         └───────────────────────────────────────────────────┘
```

---

## PostgreSQL Schema

```sql
-- Sessions table (for HITL state)
CREATE TABLE async_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id VARCHAR(255) UNIQUE NOT NULL,
  agent_name VARCHAR(255) NOT NULL,
  state VARCHAR(50) NOT NULL DEFAULT 'running',

  -- Original request (for resume)
  request JSONB NOT NULL,

  -- Current approval if waiting
  pending_approval JSONB,

  -- Execution context (for SDK resume)
  sdk_session_id VARCHAR(255),

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,

  -- Indexes
  INDEX idx_sessions_correlation (correlation_id),
  INDEX idx_sessions_state (state),
  INDEX idx_sessions_expires (expires_at)
);

-- Approval requests table (optional, for auditing)
CREATE TABLE approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES async_sessions(id),
  tool_name VARCHAR(255) NOT NULL,
  tool_input JSONB NOT NULL,

  -- Decision
  decision VARCHAR(50),
  decided_by VARCHAR(255),
  decided_at TIMESTAMPTZ,

  -- Timestamps
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);
```

---

## ReplyChannel Interface

```typescript
interface ReplyChannel {
  /**
   * Send a message through this channel.
   * The implementation handles platform-specific formatting.
   */
  send(message: ReplyMessage): Promise<void>;

  /**
   * Check if this channel can handle the given URI.
   */
  matches(uri: string): boolean;
}

interface ReplyMessage {
  type: 'result' | 'approval_request' | 'status_update' | 'error';
  correlationId: string;
  origin: AsyncAgentRequest['origin'];
  payload: unknown;  // Type depends on message type
}
```

### Built-in Implementations

#### SlackReplyChannel

```typescript
class SlackReplyChannel implements ReplyChannel {
  matches(uri: string): boolean {
    return uri.startsWith('slack://') || uri.startsWith('slack-socket://');
  }

  async send(message: ReplyMessage): Promise<void> {
    const { origin } = message;

    if (message.type === 'approval_request') {
      // Send interactive message with Approve/Deny buttons
      await this.slack.chat.postMessage({
        channel: origin.channelId,
        thread_ts: origin.threadId,
        blocks: this.buildApprovalBlocks(message.payload),
      });
    } else if (message.type === 'result') {
      // Send result as thread reply
      await this.slack.chat.postMessage({
        channel: origin.channelId,
        thread_ts: origin.threadId,
        text: this.formatResult(message.payload),
      });
    }
  }
}
```

#### NostrReplyChannel

```typescript
class NostrReplyChannel implements ReplyChannel {
  matches(uri: string): boolean {
    return uri.startsWith('nostr://');
  }

  async send(message: ReplyMessage): Promise<void> {
    const relayUrl = this.parseRelayUrl(message.origin);
    const pubkey = this.parsePubkey(message.origin);

    // Create encrypted DM event
    const event = await this.createEncryptedDM(pubkey, message);

    // Publish to relay
    await this.relay.publish(relayUrl, event);
  }
}
```

#### WebhookReplyChannel

```typescript
class WebhookReplyChannel implements ReplyChannel {
  matches(uri: string): boolean {
    return uri.startsWith('webhook://') || uri.startsWith('https://');
  }

  async send(message: ReplyMessage): Promise<void> {
    const url = this.parseWebhookUrl(message);

    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-ID': message.correlationId,
      },
      body: JSON.stringify(message),
    });
  }
}
```

#### QueueReplyChannel (Built-in)

```typescript
class QueueReplyChannel implements ReplyChannel {
  matches(uri: string): boolean {
    return uri.startsWith('queue://');
  }

  async send(message: ReplyMessage): Promise<void> {
    const queueName = this.parseQueueName(uri);
    await this.pgBoss.send(queueName, message);
  }
}
```

---

## Implementation Plan

### Phase 1: Core Types & Queue Infrastructure

**Files to create:**
- `src/queue/types.ts` - All message interfaces
- `src/queue/queue.module.ts` - NestJS dynamic module
- `src/queue/queue.tokens.ts` - DI tokens

**Tasks:**
1. Define `AsyncAgentRequest`, `AsyncAgentResponse`, `ApprovalRequest`, `ApprovalDecision`
2. Define `ReplyChannel` interface
3. Define `QueueModuleOptions` interface
4. Create DI tokens for adapter and config

### Phase 2: pg-boss Integration

**Files to create:**
- `src/queue/pgboss.service.ts` - pg-boss wrapper

**Tasks:**
1. Implement connection management (connect on module init, disconnect on destroy)
2. Implement `subscribeToAgent(agentName, handler)` for consuming requests
3. Implement `publishApproval(queueName, decision)` for approval flow
4. Implement health check endpoint

### Phase 3: ReplyChannel System

**Files to create:**
- `src/queue/reply-channels/reply-channel.interface.ts`
- `src/queue/reply-channels/queue.channel.ts` (built-in)
- `src/queue/reply-channels/webhook.channel.ts` (built-in)
- `src/queue/reply-channels/channel-resolver.service.ts`

**Tasks:**
1. Implement `QueueReplyChannel` (always available)
2. Implement `WebhookReplyChannel` for HTTP callbacks
3. Create `ChannelResolverService` that matches URI to channel
4. Document how to create custom channels (Slack, NOSTR)

### Phase 4: Session Store

**Files to create:**
- `src/queue/session/session.types.ts`
- `src/queue/session/session-store.service.ts`

**Tasks:**
1. Implement PostgreSQL-based session store
2. Create session table migration
3. Implement `create`, `get`, `update`, `waitForApproval`, `resolveApproval`
4. Approval waiting uses pg-boss job completion or LISTEN/NOTIFY

### Phase 5: Async Worker Service

**Files to create:**
- `src/queue/async-worker.service.ts`

**Tasks:**
1. On module init: subscribe to configured agent queues
2. For each request:
   - Resolve ReplyChannel from `replyTo` URI
   - If agent has HITL: create session, inject `canUseTool`
   - Call `AgentService.execute()`
   - Send result via ReplyChannel
3. Handle errors gracefully (send error response, don't crash)
4. Clean up sessions on completion

### Phase 6: HITL canUseTool Implementation

**Modify:** `src/queue/async-worker.service.ts`

**Tasks:**
1. Create `canUseTool` handler that:
   - Checks if tool matches `hitl.requireApproval` patterns
   - If match: update session, send approval request via ReplyChannel
   - Wait for approval via session store
   - Return decision to SDK
2. Handle approval timeout based on `hitl.onTimeout`

### Phase 7: Testing

**Files to create:**
- `test/queue.e2e-spec.ts` - Queue processing tests
- `test/hitl.e2e-spec.ts` - HITL flow tests
- `test/queue.local-spec.ts` - Integration tests with real PostgreSQL

**Tasks:**
1. Unit tests with mocked pg-boss
2. E2E tests with testcontainers PostgreSQL
3. Local integration tests with real Claude API

### Phase 8: Slack Channel (Example Integration)

**Files to create:**
- `src/queue/reply-channels/slack.channel.ts`

**Tasks:**
1. Implement `SlackReplyChannel` with @slack/web-api
2. Format approval requests as interactive messages
3. Handle approval button callbacks
4. Document Slack app setup

---

## Usage Examples

### Basic Queue Processing (No HITL)

```typescript
// Producer (external system)
await pgBoss.send('claude.agents.summarizer.requests', {
  agentName: 'summarizer',
  payload: { prompt: 'Summarize this article: ...' },
  correlationId: 'req-123',
  origin: {
    platform: 'slack',
    userId: 'U12345',
    channelId: 'C67890',
    threadId: '1234567890.123456',
  },
  replyTo: 'slack://hooks.slack.com/services/T00/B00/XXX',
  requestedAt: new Date().toISOString(),
});

// Response sent to Slack thread automatically
```

### HITL with Slack Approval

```typescript
// Agent config
agents: {
  'deploy-bot': {
    systemPrompt: 'You deploy to production.',
    hitl: {
      requireApproval: ['Bash:*deploy*'],
      approvalTimeoutMs: 300_000,
    },
  },
}

// Request
await pgBoss.send('claude.agents.deploy-bot.requests', {
  agentName: 'deploy-bot',
  payload: { prompt: 'Deploy v2.0 to production' },
  correlationId: 'deploy-456',
  origin: {
    platform: 'slack',
    userId: 'U12345',
    userName: 'alice',
    channelId: 'C67890',
  },
  replyTo: 'slack-socket://channel/C67890',
  requestedAt: new Date().toISOString(),
});

// 1. Agent starts executing
// 2. Agent wants to run: Bash { command: 'kubectl apply -f deployment.yaml' }
// 3. Worker sends to Slack:
//    "🔔 @alice Deploy Bot needs approval
//     Tool: Bash
//     Command: kubectl apply -f deployment.yaml
//     [Approve] [Deny]"
// 4. User clicks Approve
// 5. Slack sends callback to our API
// 6. We publish approval to pg-boss
// 7. Worker resumes, completes deployment
// 8. Result posted to Slack thread
```

### NOSTR Integration

```typescript
// Request from NOSTR client
{
  agentName: 'assistant',
  payload: { prompt: 'What is the weather in Tokyo?' },
  correlationId: 'nostr-789',
  origin: {
    platform: 'nostr',
    pubkey: 'npub1abc...',
  },
  replyTo: 'nostr://relay.damus.io?pubkey=npub1abc...',
  requestedAt: new Date().toISOString(),
}

// Response sent as encrypted DM to user's pubkey
```

---

## Queue Naming Convention

| Purpose | Queue Name |
|---------|------------|
| Agent requests | `claude.agents.{agentName}.requests` |
| Approval decisions | `claude.approvals.{correlationId}` |
| Internal responses | `claude.responses.{correlationId}` |

---

## Configuration Reference

```typescript
interface QueueModuleOptions {
  // PostgreSQL connection
  connectionString: string;

  // Which agents to process (default: all registered agents)
  agents?: string[];

  // Worker identification for horizontal scaling
  workerId?: string;

  // Job processing options
  jobOptions?: {
    retryLimit?: number;       // Default: 3
    retryDelay?: number;       // Default: 5000ms
    expireInMinutes?: number;  // Default: 60
  };

  // Custom reply channels
  replyChannels?: Record<string, ReplyChannel>;
}

interface HITLConfig {
  // Tool patterns requiring approval
  requireApproval: string[];

  // Tool patterns to auto-approve (override requireApproval)
  autoApprove?: string[];

  // Approval request timeout
  approvalTimeoutMs?: number;  // Default: 300_000 (5 min)

  // Behavior on timeout
  onTimeout?: 'deny' | 'abort';  // Default: 'deny'
}
```

---

## File Structure

```
packages/claude-code-plugin-rest-api/src/
├── queue/
│   ├── index.ts                           # Public exports
│   ├── types.ts                           # Message interfaces
│   ├── queue.module.ts                    # NestJS module
│   ├── queue.tokens.ts                    # DI tokens
│   ├── pgboss.service.ts                  # pg-boss wrapper
│   ├── async-worker.service.ts            # Main worker
│   ├── session/
│   │   ├── session.types.ts               # Session interfaces
│   │   └── session-store.service.ts       # PostgreSQL session store
│   └── reply-channels/
│       ├── reply-channel.interface.ts     # Channel interface
│       ├── channel-resolver.service.ts    # URI → Channel resolver
│       ├── queue.channel.ts               # Built-in queue channel
│       ├── webhook.channel.ts             # Built-in webhook channel
│       └── slack.channel.ts               # Optional Slack channel
└── index.ts                               # Add queue exports
```

---

## Why This Design

1. **PostgreSQL-only** - No Redis required. pg-boss handles queuing, PostgreSQL handles sessions.

2. **HITL only for queues** - REST endpoints stay simple and fast. HITL makes sense for async workflows where humans have time to review.

3. **ReplyChannel abstraction** - One implementation handles all platforms. Adding Slack/NOSTR/Discord is just implementing one interface.

4. **Platform-agnostic origin tracking** - The `origin` object captures enough context to reply appropriately on any platform.

5. **Correlation-based architecture** - Everything links via `correlationId`, making debugging and auditing straightforward.

6. **Horizontal scaling built-in** - pg-boss handles competing consumers automatically. Multiple ECS tasks just work.

---

## Dependencies

```json
{
  "dependencies": {
    "pg-boss": "^10.0.0"
  },
  "optionalDependencies": {
    "@slack/web-api": "^7.0.0",
    "nostr-tools": "^2.0.0"
  }
}
```

---

## Migration Path

1. **Existing REST users** - No changes. REST endpoints work exactly as before.

2. **Adding queue support** - Import `QueueModule`, configure agents. Done.

3. **Adding HITL** - Add `hitl` config to agents. Only affects queue execution.

4. **Adding Slack** - Implement `SlackReplyChannel`, register in module config.
