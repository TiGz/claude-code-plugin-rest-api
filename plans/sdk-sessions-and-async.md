# SDK Sessions, Async Agents, and HITL

## Philosophy

Build incrementally. SDK Sessions are the foundation—they unlock multi-turn conversations, resume/fork capabilities, and provide the state management needed for HITL. Only then do we add async queue processing as a transport layer.

**Build Order:**
1. **Phase A**: SDK Session support in REST API (foundation)
2. **Phase B**: Async queue processing with pg-boss
3. **Phase C**: HITL via `canUseTool` callback

---

## Module Architecture

Agents are defined once, then registered with whichever transport modules you need:

```typescript
import { ClaudePluginModule, QueueModule, defineAgent } from '@tigz/claude-code-plugin-rest-api';

// Define agents once
const agents = {
  summarizer: defineAgent({
    systemPrompt: 'You summarize documents.',
    permissionMode: 'bypassPermissions',
  }),

  'deploy-bot': defineAgent({
    systemPrompt: 'You deploy to production.',
    permissionMode: 'bypassPermissions',
    // HITL only applies when used via QueueModule
    hitl: {
      requireApproval: ['Bash:*deploy*'],
      approvalTimeoutMs: 300_000,
    },
  }),
};

@Module({
  imports: [
    // REST API: exposes /v1/agents/:name endpoints
    ClaudePluginModule.forRoot({
      agents: {
        summarizer: agents.summarizer,
        'deploy-bot': agents['deploy-bot'],
      },
      auth: { ... },
    }),

    // Queue processing: subscribes to pg-boss queues
    QueueModule.forRoot({
      connectionString: process.env.DATABASE_URL,
      agents: {
        summarizer: agents.summarizer,
        // deploy-bot only available via queue (has HITL)
        'deploy-bot': agents['deploy-bot'],
      },
      replyChannels: {
        slack: new SlackReplyChannel({ ... }),
      },
    }),
  ],
})
export class AppModule {}
```

**Key Points:**
- `defineAgent()` creates a reusable agent configuration
- Same agent can be registered with both `ClaudePluginModule` and `QueueModule`
- HITL config is ignored by `ClaudePluginModule` (REST is synchronous)
- You can have REST-only agents, queue-only agents, or both

---

## Phase A: SDK Session Support

### What the SDK Gives Us

The SDK already handles session state internally. When you call `query()`:

```typescript
for await (const message of query({ prompt, options })) {
  if (message.type === 'system' && message.subtype === 'init') {
    console.log(message.session_id);  // e.g., "session-abc123"
  }
}
```

To resume:
```typescript
query({
  prompt: "Continue...",
  options: {
    resume: "session-abc123",
    forkSession: false  // true = create new branch
  }
})
```

**The SDK manages all conversation history internally.** We just need to:
1. Capture and return the `session_id` from the init message
2. Accept `sessionId` and `forkSession` in requests
3. Pass them through to the SDK

### API Design

#### Execute with Session Support

```http
POST /v1/agents/:name
Content-Type: application/json

{
  "prompt": "Help me build a REST API",
  "sessionId": null,           // Optional: resume existing session
  "forkSession": false         // Optional: fork instead of continue
}
```

**Response:**
```json
{
  "success": true,
  "result": "I'll help you build a REST API...",
  "sessionId": "session-abc123",
  "cost": 0.003,
  "turns": 1
}
```

#### Resume a Session

```http
POST /v1/agents/:name
Content-Type: application/json

{
  "prompt": "Add authentication to the API",
  "sessionId": "session-abc123"
}
```

**Response:**
```json
{
  "success": true,
  "result": "I'll add JWT authentication...",
  "sessionId": "session-abc123",
  "cost": 0.002,
  "turns": 2
}
```

#### Fork a Session

```http
POST /v1/agents/:name
Content-Type: application/json

{
  "prompt": "Actually, let's try GraphQL instead",
  "sessionId": "session-abc123",
  "forkSession": true
}
```

**Response:**
```json
{
  "success": true,
  "result": "Let's redesign this as a GraphQL API...",
  "sessionId": "session-def456",
  "cost": 0.003,
  "turns": 1
}
```

#### Streaming with Sessions

```http
POST /v1/agents/:name/stream
Content-Type: application/json

{
  "prompt": "Help me build a REST API",
  "sessionId": null
}
```

**Response:**
```json
{
  "streamSessionId": "stream-xyz789",
  "streamUrl": "/v1/stream/stream-xyz789",
  "expiresIn": 300
}
```

**SSE Stream includes session_id in init event:**
```
event: system
data: {"type":"system","subtype":"init","session_id":"session-abc123"}

event: assistant
data: {"type":"assistant","message":"I'll help you..."}

event: result
data: {"type":"result","success":true,"sessionId":"session-abc123"}
```

### Implementation

#### Types

```typescript
// src/types/plugin.types.ts

export interface ExecuteAgentDto {
  prompt: string;
  sessionId?: string;      // Resume existing SDK session
  forkSession?: boolean;   // Fork instead of continue (default: false)
  rawResponse?: boolean;   // Return raw output (auto-true for outputFormat agents)
}

export interface AgentExecutionResult {
  success: boolean;
  result?: string;
  structuredOutput?: unknown;
  sessionId?: string;      // SDK session ID for resumption
  error?: string;
  cost?: number;
  turns?: number;
  usage?: { inputTokens: number; outputTokens: number };
}
```

#### AgentService Changes

```typescript
// src/services/agent.service.ts

async execute(
  agentName: string,
  prompt: string,
  sessionOptions?: { sessionId?: string; forkSession?: boolean }
): Promise<AgentExecutionResult> {
  const config = this.agents[agentName];
  if (!config) {
    throw new NotFoundException(`Agent '${agentName}' not found`);
  }

  const queryOptions = this.buildQueryOptions(config);

  // Add session options if provided
  if (sessionOptions?.sessionId) {
    queryOptions.resume = sessionOptions.sessionId;
    queryOptions.forkSession = sessionOptions.forkSession ?? false;
  }

  let sessionId: string | undefined;
  let finalResult: AgentExecutionResult = { success: false };

  for await (const message of query({ prompt, options: queryOptions })) {
    // Capture session ID from init message
    if (message.type === 'system' && message.subtype === 'init') {
      sessionId = message.session_id;
    }

    if (message.type === 'result') {
      finalResult = {
        success: !message.is_error,
        result: message.result,
        structuredOutput: message.structured_output,
        sessionId,
        cost: message.total_cost_usd,
        turns: message.num_turns,
        usage: message.usage ? {
          inputTokens: message.usage.input_tokens || 0,
          outputTokens: message.usage.output_tokens || 0,
        } : undefined,
      };
    }
  }

  return finalResult;
}

stream(
  agentName: string,
  prompt: string,
  sessionOptions?: { sessionId?: string; forkSession?: boolean }
): Observable<SDKMessage> {
  // Similar changes - pass session options through
}
```

#### Controller Changes

```typescript
// src/controllers/agent.controller.ts

@Post(':name')
async executeAgent(
  @Param('name') name: string,
  @Body() body: ExecuteAgentDto,
  @Res({ passthrough: true }) res: Response,
) {
  const result = await this.agentService.execute(
    name,
    body.prompt,
    {
      sessionId: body.sessionId,
      forkSession: body.forkSession
    }
  );

  // Include sessionId in response
  if (body.rawResponse && result.structuredOutput) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('X-Session-ID', result.sessionId || '');
    return result.structuredOutput;
  }

  return result; // Already includes sessionId
}
```

### Phase A Summary

| File | Changes |
|------|---------|
| `src/types/plugin.types.ts` | Add `sessionId`, `forkSession` to DTOs |
| `src/services/agent.service.ts` | Capture `session_id`, pass `resume`/`forkSession` to SDK |
| `src/controllers/agent.controller.ts` | Accept and return session options |
| `src/services/stream-session.service.ts` | Include session options in stream context |
| `src/controllers/stream.controller.ts` | Emit `sessionId` in result event |

**Tests to add:**
- Resume session continues conversation
- Fork creates new session ID
- Session ID returned in execute response
- Session ID included in stream events

---

## Phase B: Async Queue Processing

With SDK sessions as our foundation, async processing becomes straightforward. The queue just carries the request with session context.

### Message Schema

```typescript
interface AsyncAgentRequest {
  agentName: string;
  prompt: string;
  correlationId: string;

  // Session options (same as REST API)
  sessionId?: string;
  forkSession?: boolean;

  // Origin - where this request came from
  origin: {
    platform: 'slack' | 'nostr' | 'api' | string;
    userId?: string;
    channelId?: string;
    threadId?: string;
    metadata?: Record<string, unknown>;
  };

  // Where to send the response
  replyTo: string;  // URI: slack://, nostr://, webhook://, queue://
}

interface AsyncAgentResponse {
  correlationId: string;
  sessionId?: string;      // SDK session ID for future resume
  origin: AsyncAgentRequest['origin'];

  result: {
    success: boolean;
    output?: string;
    structuredOutput?: unknown;
    error?: string;
  };

  completedAt: string;
  durationMs: number;
}
```

### Module Configuration

See the Module Architecture section at the top. Each module manages its own agents:

```typescript
// Queue-only setup (no REST)
QueueModule.forRoot({
  connectionString: process.env.DATABASE_URL,
  agents: {
    summarizer: defineAgent({ systemPrompt: '...' }),
  },
  replyChannels: {
    slack: new SlackReplyChannel({ ... }),
  },
})
```

### Queue Worker

The worker is simple because it just calls `AgentService.execute()`:

```typescript
@Injectable()
export class AsyncWorkerService implements OnModuleInit, OnModuleDestroy {
  constructor(
    private readonly pgBoss: PgBossService,
    private readonly agentService: AgentService,
    private readonly channelResolver: ChannelResolverService,
  ) {}

  async onModuleInit() {
    for (const agentName of this.configuredAgents) {
      await this.pgBoss.work(
        `claude.agents.${agentName}.requests`,
        async (job: Job<AsyncAgentRequest>) => this.processRequest(job.data)
      );
    }
  }

  private async processRequest(request: AsyncAgentRequest) {
    const startTime = Date.now();
    const channel = this.channelResolver.resolve(request.replyTo);

    try {
      const result = await this.agentService.execute(
        request.agentName,
        request.prompt,
        { sessionId: request.sessionId, forkSession: request.forkSession }
      );

      await channel.send({
        type: 'result',
        correlationId: request.correlationId,
        sessionId: result.sessionId,
        origin: request.origin,
        payload: {
          success: result.success,
          output: result.result,
          structuredOutput: result.structuredOutput,
        },
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
      });
    } catch (error) {
      await channel.send({
        type: 'error',
        correlationId: request.correlationId,
        origin: request.origin,
        payload: { error: error.message },
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
      });
    }
  }
}
```

### Reply Channels

```typescript
interface ReplyChannel {
  send(message: ReplyMessage): Promise<void>;
  matches(uri: string): boolean;
}

// Built-in
class QueueReplyChannel implements ReplyChannel { ... }
class WebhookReplyChannel implements ReplyChannel { ... }

// User-provided
class SlackReplyChannel implements ReplyChannel { ... }
class NostrReplyChannel implements ReplyChannel { ... }
```

### Phase B Summary

| File | Purpose |
|------|---------|
| `src/queue/types.ts` | Request/response message schemas |
| `src/queue/queue.module.ts` | NestJS dynamic module |
| `src/queue/pgboss.service.ts` | pg-boss wrapper |
| `src/queue/async-worker.service.ts` | Job processor |
| `src/queue/reply-channels/*.ts` | Channel implementations |

---

## Phase C: Human-in-the-Loop (HITL)

HITL leverages both SDK sessions and async queues. When a tool needs approval:

1. Worker pauses execution (using SDK's `canUseTool` callback)
2. Sends approval request via reply channel
3. Waits for approval on dedicated queue
4. Resumes execution

### Agent Configuration

HITL is a per-agent trait (only activated when used via QueueModule):

```typescript
const deployBot = defineAgent({
  systemPrompt: 'You deploy to production.',
  permissionMode: 'bypassPermissions',

  // HITL configuration - only applies via QueueModule
  hitl: {
    requireApproval: ['Bash:*deploy*', 'Bash:kubectl*'],
    autoApprove: ['Read:*', 'Glob:*'],
    approvalTimeoutMs: 300_000,  // 5 min
    onTimeout: 'deny',
  },
});

// Register with QueueModule for HITL support
QueueModule.forRoot({
  connectionString: process.env.DATABASE_URL,
  agents: { 'deploy-bot': deployBot },
  replyChannels: { slack: new SlackReplyChannel({ ... }) },
})

// If also registered with ClaudePluginModule, HITL is ignored (REST is sync)
ClaudePluginModule.forRoot({
  agents: { 'deploy-bot': deployBot },
})
```

### HITL Only for Async

**Key insight:** HITL only makes sense for async requests. REST API users want immediate responses—they can't wait around for approvals.

```typescript
// In AsyncWorkerService.processRequest()

private async processRequest(request: AsyncAgentRequest) {
  const config = this.agentService.getAgentConfig(request.agentName);
  const channel = this.channelResolver.resolve(request.replyTo);

  // Build options with HITL callback if configured
  const queryOptions = this.buildQueryOptions(config, request, channel);

  // Execute with HITL support
  for await (const message of query({ prompt: request.prompt, options: queryOptions })) {
    // Handle messages...
  }
}

private buildQueryOptions(config: AgentConfig, request: AsyncAgentRequest, channel: ReplyChannel) {
  const { hitl, ...sdkOptions } = config;

  if (!hitl) {
    return sdkOptions;  // No HITL, standard execution
  }

  return {
    ...sdkOptions,
    canUseTool: this.createApprovalHandler(hitl, request, channel),
  };
}

private createApprovalHandler(hitl: HITLConfig, request: AsyncAgentRequest, channel: ReplyChannel) {
  return async (toolName: string, input: unknown) => {
    // Check if tool needs approval
    if (!this.matchesPattern(toolName, hitl.requireApproval)) {
      return { behavior: 'allow', updatedInput: input };
    }
    if (this.matchesPattern(toolName, hitl.autoApprove)) {
      return { behavior: 'allow', updatedInput: input };
    }

    const approvalId = crypto.randomUUID();
    const approvalQueueName = `claude.approvals.${request.correlationId}`;

    // Send approval request via reply channel
    await channel.send({
      type: 'approval_request',
      correlationId: request.correlationId,
      origin: request.origin,
      payload: {
        approvalId,
        tool: { name: toolName, input },
        expiresAt: new Date(Date.now() + hitl.approvalTimeoutMs).toISOString(),
        approvalQueueName,
      },
    });

    // Wait for approval decision on dedicated queue
    try {
      const decision = await this.waitForApproval(approvalQueueName, hitl.approvalTimeoutMs);
      return decision;
    } catch (timeout) {
      return hitl.onTimeout === 'deny'
        ? { behavior: 'deny', message: 'Approval timed out' }
        : { behavior: 'abort' };
    }
  };
}

private async waitForApproval(queueName: string, timeoutMs: number): Promise<ApprovalDecision> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout')), timeoutMs);

    // Subscribe to approval queue
    this.pgBoss.work(queueName, { newJobCheckInterval: 1000 }, async (job) => {
      clearTimeout(timeout);
      resolve(job.data);
    });
  });
}
```

### Approval Flow

```
Producer                Queue                  Worker               ReplyChannel           Approver
   │                      │                      │                       │                    │
   │  send request        │                      │                       │                    │
   │─────────────────────>│                      │                       │                    │
   │                      │  dequeue             │                       │                    │
   │                      │─────────────────────>│                       │                    │
   │                      │                      │                       │                    │
   │                      │                      │  execute agent        │                    │
   │                      │                      │  (tool needs approval)│                    │
   │                      │                      │                       │                    │
   │                      │                      │  send approval_request│                    │
   │                      │                      │──────────────────────>│                    │
   │                      │                      │                       │  (Slack button)    │
   │                      │                      │                       │───────────────────>│
   │                      │                      │                       │                    │
   │                      │                      │  [blocks waiting]     │                    │
   │                      │                      │                       │                    │
   │                      │                      │                       │  user approves     │
   │                      │                      │                       │<───────────────────│
   │                      │                      │                       │                    │
   │                      │  publish approval    │                       │                    │
   │                      │<─────────────────────────────────────────────│                    │
   │                      │                      │                       │                    │
   │                      │  approval received   │                       │                    │
   │                      │─────────────────────>│                       │                    │
   │                      │                      │                       │                    │
   │                      │                      │  resume execution     │                    │
   │                      │                      │  ...                  │                    │
   │                      │                      │  send result          │                    │
   │                      │                      │──────────────────────>│                    │
```

### Phase C Summary

| File | Purpose |
|------|---------|
| `src/types/plugin.types.ts` | Add `HITLConfig` interface |
| `src/queue/async-worker.service.ts` | Add `canUseTool` injection |
| `src/queue/hitl.service.ts` | Pattern matching, approval waiting |

---

## Complete File Structure

```
packages/claude-code-plugin-rest-api/src/
├── controllers/
│   ├── agent.controller.ts          # Modified: session support
│   ├── stream.controller.ts         # Modified: session in events
│   └── plugin.controller.ts         # Unchanged
├── services/
│   ├── agent.service.ts             # Modified: session support
│   ├── stream-session.service.ts    # Unchanged
│   └── plugin-*.service.ts          # Unchanged
├── types/
│   ├── plugin.types.ts              # Add HITLConfig, update AgentConfig
│   └── queue.types.ts               # NEW: queue message schemas
├── queue/                           # NEW: QueueModule (Phase B & C)
│   ├── queue.module.ts
│   ├── queue.tokens.ts
│   ├── pgboss.service.ts
│   ├── async-worker.service.ts
│   ├── hitl.service.ts
│   └── reply-channels/
│       ├── reply-channel.interface.ts
│       ├── channel-resolver.service.ts
│       ├── queue.channel.ts
│       ├── webhook.channel.ts
│       └── slack.channel.ts
├── claude-plugin.module.ts          # Unchanged (REST)
├── helpers.ts                       # NEW: defineAgent() helper
└── index.ts                         # Export QueueModule, defineAgent
```

---

## Implementation Order

### Phase A: SDK Sessions (REST API)
1. Add `defineAgent()` helper function in `helpers.ts`
2. Add session fields to DTOs (`sessionId`, `forkSession`)
3. Modify `AgentService.execute()` to capture `session_id` from init message
4. Modify `AgentService.execute()` to pass `resume` and `forkSession` to SDK
5. Modify `AgentService.stream()` similarly
6. Update controllers to accept/return session info
7. Add tests for resume and fork
8. Update CLAUDE.md docs

### Phase B: Async Queues
1. Create queue types in `types/queue.types.ts`
2. Create `QueueModule` with `forRoot()` and `forRootAsync()`
3. Implement pg-boss service
4. Implement async worker (calls `AgentService.execute()`)
5. Implement built-in reply channels (queue, webhook)
6. Add Slack reply channel as example
7. Add tests with mock pg-boss
8. Add local tests with real PostgreSQL

### Phase C: HITL
1. Add `HITLConfig` to `AgentConfig` in `plugin.types.ts`
2. Implement pattern matching for tool names
3. Add `canUseTool` callback injection in async worker
4. Implement approval queue waiting
5. Add tests for approval flow
6. Document Slack approval button setup

---

## Usage Examples

### REST API with Sessions

```bash
# Start new conversation
curl -X POST http://localhost:3000/v1/agents/assistant \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Help me design a REST API"}'

# Response
{
  "success": true,
  "result": "I'll help you design a REST API...",
  "sessionId": "session-abc123"
}

# Continue conversation
curl -X POST http://localhost:3000/v1/agents/assistant \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Add authentication", "sessionId": "session-abc123"}'

# Fork to try different approach
curl -X POST http://localhost:3000/v1/agents/assistant \
  -H "Content-Type: application/json" \
  -d '{"prompt": "What about GraphQL?", "sessionId": "session-abc123", "forkSession": true}'
```

### Async via Slack

```typescript
// Slack bot receives message
app.message(async ({ message, say }) => {
  await pgBoss.send('claude.agents.assistant.requests', {
    agentName: 'assistant',
    prompt: message.text,
    correlationId: crypto.randomUUID(),
    origin: {
      platform: 'slack',
      userId: message.user,
      channelId: message.channel,
      threadId: message.thread_ts || message.ts,
    },
    replyTo: `slack-socket://channel/${message.channel}?thread=${message.ts}`,
  });
});

// SlackReplyChannel sends result back as thread reply
```

### Async with HITL

```typescript
// Agent config
agents: {
  'deploy-bot': {
    systemPrompt: 'Deploy to production.',
    hitl: {
      requireApproval: ['Bash:*deploy*'],
      approvalTimeoutMs: 300_000,
    },
  },
}

// When tool needs approval, Slack gets interactive message:
// "🔔 Deploy Bot wants to run: kubectl apply -f deployment.yaml"
// [Approve] [Deny]

// User clicks Approve → published to claude.approvals.{correlationId}
// Worker resumes → result sent to Slack thread
```

---

## Why This Design

1. **SDK-Native Sessions** - We don't reinvent session state. The SDK handles it; we just pass IDs through.

2. **Incremental Value** - Phase A delivers value immediately. Users get multi-turn conversations via REST API without needing queues.

3. **Clean Module Separation** - `ClaudePluginModule` for HTTP, `QueueModule` for async. Same agent definition works in both.

4. **Define Once, Use Anywhere** - `defineAgent()` creates a reusable config. Register with whichever transports you need.

5. **HITL Where It Makes Sense** - Only async requests support HITL. REST users want immediate responses.

6. **PostgreSQL-Only** - pg-boss for queuing, standard tables for any metadata. No Redis complexity.

7. **Extensible Channels** - Reply channels abstract the destination. Adding NOSTR or Discord is just implementing one interface.
