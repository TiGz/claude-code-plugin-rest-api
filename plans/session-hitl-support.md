# Plan: Session Management & Human-in-the-Loop (HITL) Support

## Summary

Add persistent sessions, human-in-the-loop capabilities, multi-turn conversations, and webhook notifications to the REST API. HITL behavior is **configured in the agent definition** (not per-request), making it declarative and consistent.

## Design Philosophy

**HITL is an agent trait, not a request option.** When you define a deployment agent, you declare which tools need human approval. Every request to that agent automatically gets HITL behavior.

```typescript
// Agent definition controls HITL - not the request
ClaudePluginModule.forRoot({
  agents: {
    'deploy-agent': {
      systemPrompt: 'You deploy to production.',
      hitl: {
        requireApprovalFor: ['Bash:*deploy*', 'Bash:kubectl*'],
        webhook: { url: 'https://slack.webhook/deployments' },
      },
    },
  },
})
```

## Key Insight

The SDK's `canUseTool` callback is **currently omitted** from `AgentConfig` (line 95 in plugin.types.ts) with the comment "No interactive prompting in REST APIs." For HITL, we:
1. **Add `hitl` config** to `AgentConfig` for declarative HITL setup
2. **Internally inject** a `canUseTool` implementation when `hitl` is configured
3. **Sessions are created implicitly** when calling HITL-enabled agents

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    REST API Layer                           │
├─────────────────────────────────────────────────────────────┤
│  AgentController (existing, extended)                       │
│  POST /v1/agents/:name          → Execute (auto-detects HITL)│
│  POST /v1/agents/:name/stream   → Stream (auto-detects HITL) │
│                                                             │
│  SessionController (new)                                    │
│  GET  /v1/sessions/:id          → Get session state         │
│  GET  /v1/sessions/:id/approval → Get pending approval      │
│  POST /v1/sessions/:id/approval → Submit approval decision  │
│  POST /v1/sessions/:id/messages → Send follow-up (multi-turn)│
├─────────────────────────────────────────────────────────────┤
│  SessionStoreService                                        │
│  - In-memory (default) or Redis (horizontal scaling)        │
│  - Tracks session state, pending approvals, conversation    │
│  - Manages approval resolution (Promise + resolver pattern) │
├─────────────────────────────────────────────────────────────┤
│  AgentService (extended)                                    │
│  - Detects HITL config, injects canUseTool automatically    │
│  - Emits SSE events + webhook notifications                 │
│  - Supports multi-turn via SDK session resume               │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│           Claude Agent SDK                                  │
│  query() with canUseTool for HITL                          │
│  unstable_v2_resumeSession() for multi-turn                │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 1: Core Types & Session Store

**New file**: `src/types/session.types.ts`
```typescript
export type SessionState = 'running' | 'waiting_approval' | 'completed' | 'error' | 'expired';

export interface Session {
  id: string;
  agentName: string;
  sdkSessionId?: string;          // For multi-turn resume
  state: SessionState;
  pendingApproval?: PendingApproval;
  conversationHistory: Message[];  // For multi-turn
  createdAt: number;
  expiresAt: number;
}

export interface PendingApproval {
  id: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  description?: string;
  requestedAt: number;
  timeoutAt: number;
}

export interface ApprovalDecision {
  behavior: 'allow' | 'deny';
  message?: string;
  updatedInput?: Record<string, unknown>;
}
```

**New file**: `src/services/session-store.service.ts`
- Abstract `SessionStore` interface
- `InMemorySessionStore` implementation (default)
- `RedisSessionStore` implementation (optional, for horizontal scaling)
- Approval resolver pattern: `waitForApproval()` returns Promise, `resolveApproval()` fulfills it

### Phase 2: HITLConfig in AgentConfig

**Modify**: `src/types/plugin.types.ts`
```typescript
export interface HITLConfig {
  /** Tools requiring human approval. Patterns: 'Bash:*deploy*', 'Edit:*.env*' */
  requireApprovalFor?: string[];

  /** Tools that never need approval (override requireApprovalFor) */
  autoApprove?: string[];

  /** Timeout for approval requests. Default: 300000 (5 min) */
  approvalTimeoutMs?: number;

  /** Behavior on timeout. 'deny' continues without tool, 'abort' stops execution */
  onApprovalTimeout?: 'deny' | 'abort';

  /** Webhook for push notifications */
  webhook?: {
    url: string;
    secret?: string;
    events?: ('approval_required' | 'session_complete' | 'error')[];
  };

  /** Enable multi-turn conversations */
  multiTurn?: boolean;

  /** Max session duration. Default: 3600000 (1 hour) */
  maxSessionDurationMs?: number;
}

export type AgentConfig = Omit<Options, ...> & {
  requestSchema?: RequestSchema;
  hitl?: HITLConfig;  // NEW
};
```

### Phase 3: HITL Execution in AgentService

**Modify**: `src/services/agent.service.ts`

The key change: when `config.hitl` exists, inject `canUseTool`:

```typescript
private buildQueryOptions(config: AgentConfig, session?: Session, emitter?: EventEmitter) {
  const { requestSchema: _, hitl, ...sdkOptions } = config;

  const baseOptions = {
    ...sdkOptions,
    cwd: sdkOptions.cwd ?? process.cwd(),
    permissionMode: sdkOptions.permissionMode ?? 'default',
  };

  // If no HITL config, return base options (existing behavior)
  if (!hitl) return baseOptions;

  // Inject canUseTool for HITL
  return {
    ...baseOptions,
    canUseTool: this.createApprovalHandler(hitl, session!, emitter!),
  };
}

private createApprovalHandler(hitl: HITLConfig, session: Session, emitter: EventEmitter) {
  return async (toolName: string, input: Record<string, unknown>, ctx: CanUseToolContext) => {
    // Check if tool matches requireApprovalFor patterns
    if (!this.matchesPattern(toolName, hitl.requireApprovalFor)) {
      return { behavior: 'allow', updatedInput: input };
    }

    // Check autoApprove override
    if (this.matchesPattern(toolName, hitl.autoApprove)) {
      return { behavior: 'allow', updatedInput: input };
    }

    // Create pending approval
    const approval: PendingApproval = {
      id: uuidv4(),
      toolName,
      toolInput: input,
      description: ctx.decisionReason,
      requestedAt: Date.now(),
      timeoutAt: Date.now() + (hitl.approvalTimeoutMs ?? 300000),
    };

    session.state = 'waiting_approval';
    session.pendingApproval = approval;
    await this.sessionStore.update(session);

    // Emit SSE event
    emitter.emit('approval_required', approval);

    // Send webhook
    if (hitl.webhook?.url) {
      await this.sendWebhook(hitl.webhook, 'approval_required', { session, approval });
    }

    // Wait for approval (blocks until HTTP POST or timeout)
    try {
      const decision = await this.sessionStore.waitForApproval(session.id, approval.timeoutAt);

      session.state = 'running';
      session.pendingApproval = undefined;
      emitter.emit('approval_resolved', decision);

      return decision;
    } catch (timeoutError) {
      if (hitl.onApprovalTimeout === 'deny') {
        return { behavior: 'deny', message: 'Approval timed out' };
      }
      throw new ApprovalTimeoutError('Approval request timed out');
    }
  };
}
```

### Phase 4: Session Controller & Endpoints

**New file**: `src/controllers/session.controller.ts`

| Endpoint | Method | Description |
|----------|--------|-------------|
| `GET /v1/sessions/:id` | GET | Get session state, pending approval |
| `GET /v1/sessions/:id/approval` | GET | Get pending approval details |
| `POST /v1/sessions/:id/approval` | POST | Submit approval decision |
| `POST /v1/sessions/:id/messages` | POST | Send follow-up message (multi-turn) |

**Note**: Sessions are created implicitly when calling HITL-enabled agents via existing `/v1/agents/:name` endpoints.

### Phase 5: Response Format Changes

When agent has `hitl` config, responses include session info:

```typescript
// POST /v1/agents/deploy-agent
// Request: { "prompt": "Deploy to production" }
// Response (HITL-enabled agent):
{
  "sessionId": "sess-abc123",
  "streamUrl": "/v1/sessions/sess-abc123/stream",  // If streaming
  "result": "...",    // If completed immediately
  "state": "running"  // or 'waiting_approval', 'completed'
}
```

### Phase 6: Multi-Turn via SDK Session Resume

For agents with `hitl.multiTurn: true`:

```typescript
// In AgentService
async continueSession(sessionId: string, message: string): Promise<Observable<SDKMessage>> {
  const session = await this.sessionStore.get(sessionId);

  // Use SDK V2 session resume
  const resumed = unstable_v2_resumeSession(session.sdkSessionId, {
    ...this.buildQueryOptions(config, session, emitter),
  });

  // Capture new SDK session ID if changed
  // Stream messages back
}
```

### Phase 7: Redis Store (Horizontal Scaling)

**New file**: `src/services/redis-session-store.service.ts`
- Implements `SessionStore` interface
- Uses Redis for session storage
- Uses Redis pub/sub for approval notifications across instances

**Modify**: `src/claude-plugin.module.ts`
```typescript
ClaudePluginModule.forRoot({
  sessionStore: 'redis',  // or 'memory' (default)
  redis: { host: 'localhost', port: 6379 },
  // ...
})
```

### Phase 8: Webhook Notifications

**New file**: `src/services/webhook.service.ts`
- `sendWebhook(config, event, payload)`
- Retry with exponential backoff
- HMAC signature for security

---

## Files Summary

### New Files
| File | Purpose |
|------|---------|
| `src/types/session.types.ts` | Session, PendingApproval, ApprovalDecision types |
| `src/services/session-store.service.ts` | Abstract store + InMemorySessionStore |
| `src/services/redis-session-store.service.ts` | Redis implementation |
| `src/services/webhook.service.ts` | Webhook delivery with retry |
| `src/controllers/session.controller.ts` | Session & approval endpoints |
| `src/dto/session.dto.ts` | Request/response DTOs |

### Modified Files
| File | Changes |
|------|---------|
| `src/types/plugin.types.ts` | Add `HITLConfig`, add `hitl` to `AgentConfig` |
| `src/services/agent.service.ts` | Add `canUseTool` injection, session creation |
| `src/controllers/agent.controller.ts` | Return sessionId for HITL agents |
| `src/claude-plugin.module.ts` | Register session store, session controller |
| `src/index.ts` | Export new types |

### New Tests
| File | Coverage |
|------|----------|
| `test/hitl.local-spec.ts` | HITL approval flow with real Claude API |
| `test/multi-turn.local-spec.ts` | Multi-turn conversation tests |
| `test/webhook.spec.ts` | Webhook delivery tests |

---

## API Usage Examples

### One-Shot Agent (No HITL - Unchanged Behavior)
```typescript
// Agent config (no hitl)
agents: {
  'helper': { systemPrompt: '...' }
}

// Request
POST /v1/agents/helper
{"prompt": "Hello"}

// Response (immediate)
{"result": "...", "success": true}
```

### HITL-Enabled Agent
```typescript
// Agent config
agents: {
  'deploy-agent': {
    systemPrompt: 'You deploy to production.',
    hitl: {
      requireApprovalFor: ['Bash:*deploy*', 'Bash:kubectl*'],
      approvalTimeoutMs: 600000,  // 10 min
      webhook: { url: 'https://slack.webhook/deployments' },
    },
  },
}

// Request
POST /v1/agents/deploy-agent/stream
{"prompt": "Deploy v2.0 to production"}

// Response
{"sessionId": "sess-123", "streamUrl": "/v1/stream/sess-123"}

// SSE Stream
GET /v1/stream/sess-123
← event: delta
← data: {"content": "I'll deploy v2.0..."}
← event: approval_required
← data: {"approval": {"id": "appr-456", "toolName": "Bash", "toolInput": {"command": "kubectl apply -f deployment.yaml"}}}

// Webhook sent to https://slack.webhook/deployments
POST {"event": "approval_required", "session": {...}, "approval": {...}}

// Human approves
POST /v1/sessions/sess-123/approval
{"approvalId": "appr-456", "decision": "allow"}

// Stream continues
← event: approval_resolved
← data: {"decision": "allow"}
← event: tool_result
← data: {"toolName": "Bash", "result": "deployment.apps/my-app configured"}
← event: complete
← data: {"result": "Deployed successfully", "success": true}
```

### Multi-Turn Conversation
```typescript
// Agent config
agents: {
  'assistant': {
    systemPrompt: '...',
    hitl: { multiTurn: true },
  },
}

// First message
POST /v1/agents/assistant
{"prompt": "What files are in src/?"}
→ {"sessionId": "sess-789", "result": "The src/ directory contains...", "state": "completed"}

// Follow-up message
POST /v1/sessions/sess-789/messages
{"content": "Tell me more about agent.service.ts"}
→ {"result": "The agent.service.ts file...", "state": "completed"}
```

---

## Backward Compatibility

✅ All existing endpoints work identically for agents without `hitl` config
✅ No changes to request/response format for non-HITL agents
✅ New session endpoints are additive
✅ Existing tests continue to pass
