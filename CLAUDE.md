# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A pnpm monorepo template for building REST APIs using NestJS that expose Claude agents as HTTP endpoints. Uses the Claude Agent SDK with Claude Max subscription support via terminal-based authentication.

**Primary Interface**: User-defined agents configured in code with full SDK options, exposed via `/v1/agents/:name` endpoints.

## Monorepo Structure

```
.
├── packages/
│   └── claude-code-plugin-rest-api/    # Core NestJS module library
│       └── src/
│           ├── auth/              # Basic auth guard and YAML provider
│           ├── controllers/       # Plugin, stream, and agent controllers
│           ├── queue/             # Async queue processing (QueueModule, HITL)
│           ├── services/          # Discovery, execution, agent, and session services
│           └── types/             # TypeScript interfaces
├── examples/
│   └── basic-server/              # Example NestJS application
│       ├── src/                   # App module, main entry, health controller
│       ├── test/                  # E2E, auth, and local integration tests
│       └── .claude/plugins/       # Example plugin with agents and commands
└── plans/                         # Implementation planning documents
```

## Development Commands

```bash
# Install dependencies
pnpm install

# Build
pnpm build                    # Build all packages
pnpm --filter @tigz/claude-code-plugin-rest-api build  # Build library only

# Development (in examples/basic-server)
pnpm dev                      # Start with hot reload
pnpm start:prod               # Run production build

# Testing
pnpm test                     # Run unit tests
pnpm test:e2e                 # Run e2e tests (CI-safe, no credentials required)
pnpm test:local               # Run local tests (requires Claude Max login)
```

## Architecture

### Core Stack
- **Runtime**: Node.js 20+ with TypeScript (ESM)
- **Package Manager**: pnpm with workspaces
- **Framework**: NestJS 10+
- **AI Integration**: @anthropic-ai/claude-agent-sdk ^0.1.67
- **Testing**: Vitest (native ESM support)
- **Authentication**: Basic auth with YAML config or custom providers

### Key Components

**ClaudePluginModule** - Dynamic NestJS module for REST API:
- `AgentService` - Executes user-defined agents with full SDK options (supports session resume/fork)
- `PluginDiscoveryService` - Discovers plugins from filesystem
- `PluginExecutionService` - Executes plugin agents/commands via Claude SDK
- `StreamSessionService` - Manages SSE streaming sessions
- Built-in controllers for `/v1/agents/*` and `/v1/plugins/*` endpoints
- Optional basic auth with YAML or custom providers

**QueueModule** - Dynamic NestJS module for async processing:
- `PgBossService` - PostgreSQL-backed job queue (pg-boss wrapper)
- `AsyncWorkerService` - Processes agent requests from queues
- `HITLService` - Human-in-the-Loop tool approval with pattern matching
- `ChannelResolverService` - Routes responses to queue or webhook channels

### User-Defined Agents (Primary Interface)

Define agents programmatically in code with full Claude Agent SDK options:

```typescript
ClaudePluginModule.forRoot({
  agents: {
    'code-assistant': {
      systemPrompt: 'You are a helpful coding assistant.',
      permissionMode: 'bypassPermissions',
      tools: { type: 'preset', preset: 'claude_code' },
      maxTurns: 20,
      maxBudgetUsd: 5.0,
    },
    'read-only-analyst': {
      systemPrompt: 'Analyze code without making changes.',
      allowedTools: ['Read', 'Glob', 'Grep'],
      permissionMode: 'default',
    },
  },
})
```

### Plugin Structure (Secondary Interface)

Plugins live in `.claude/plugins/<plugin-name>/` with:
- `.claude-plugin/plugin.json` - Manifest file
- `agents/*.md` - Agent definitions with frontmatter
- `commands/*.md` - Command definitions
- `skills/*/SKILL.md` - Skill definitions

## API Endpoints

### User-Defined Agents (Primary)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/agents` | List all user-defined agents |
| GET | `/v1/agents/:name` | Get agent config |
| POST | `/v1/agents/:name` | Execute agent (request/response) |
| POST | `/v1/agents/:name/stream` | Create SSE stream session |

**Raw Response Mode**: For agents with `outputFormat` defined, the API defaults to returning the structured JSON directly (`rawResponse: true`). This can be overridden by explicitly setting `rawResponse: false` in the request body. For agents without `outputFormat`, the default is to return wrapped responses with metadata.

### Plugin Discovery (Secondary)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/plugins` | List all discovered plugins |
| GET | `/v1/plugins/:name` | Get plugin details |
| POST | `/v1/plugins/:plugin/agents/:agent` | Execute plugin agent |
| POST | `/v1/plugins/:plugin/commands/:cmd` | Execute command |
| POST | `/v1/plugins/stream` | Create SSE stream session |

### Streaming

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/stream/:sessionId` | Consume SSE stream |

### Webhooks

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/webhook/reload` | Trigger plugin reload (for GitOps) |

## SDK Session Support

The REST API supports Claude Agent SDK sessions for multi-turn conversations. Sessions allow you to resume previous conversations or fork them into new branches.

### Using Sessions

**Initial request** - capture the sessionId from the response:
```bash
curl -X POST http://localhost:3000/v1/agents/my-agent \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Hello, help me with a project"}'

# Response includes sessionId:
# {
#   "success": true,
#   "result": "Hello! I'd be happy to help...",
#   "sessionId": "sess_abc123..."
# }
```

**Resume a session** - continue the conversation:
```bash
curl -X POST http://localhost:3000/v1/agents/my-agent \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Now add tests", "sessionId": "sess_abc123..."}'
```

**Fork a session** - create a new branch from an existing conversation:
```bash
curl -X POST http://localhost:3000/v1/agents/my-agent \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Try a different approach", "sessionId": "sess_abc123...", "forkSession": true}'
```

### Streaming with Sessions

SSE streams include session information:
```javascript
const eventSource = new EventSource('/v1/stream/session-id');
eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === 'system' && data.subtype === 'init') {
    console.log('Session ID:', data.sessionId);
  }
  if (data.type === 'complete') {
    console.log('Final session ID:', data.sessionId);
  }
};
```

## Claude Max Authentication

The project uses terminal-based authentication for Claude Max subscription:
1. Run `claude login` in terminal to authenticate
2. Credentials are stored locally and reused by the Agent SDK
3. No browser-based OAuth or API keys required

### Headless Server Authentication

On servers without a browser, use one of these methods:

**SSH Port Forwarding (Recommended)**:
```bash
# SSH to server with port forwarding
ssh -L 8080:localhost:8080 user@your-server

# On the server, run login
claude login
```

**Copy Credentials**:
```bash
# Authenticate locally, then copy to server
scp ~/.config/claude-code/auth.json user@server:~/.config/claude-code/
```

**Docker Volume Mount**:
```bash
docker run -v ~/.config/claude-code/auth.json:/root/.config/claude-code/auth.json:ro your-image
```

## Testing Strategy

- **Unit tests** (`pnpm test` in packages): Test services and providers in isolation
- **E2E tests** (`test:e2e`): Test API endpoints without requiring Claude credentials. Safe for CI.
- **Queue tests** (`test:e2e` with Docker): Test QueueModule with real PostgreSQL via testcontainers
- **Auth tests**: Verify authentication guard and excluded paths
- **Local tests** (`test:local`): Full integration tests that execute real Claude agents. Requires `claude login`.

**IMPORTANT**: When making changes to agent execution, SDK options, or API responses, you MUST run the local tests to verify the changes work with real Claude API calls:

```bash
cd examples/basic-server
pnpm test:local
```

Local tests cover:
- User-defined agent execution (request/response and streaming)
- `permissionMode: 'bypassPermissions'` with full tool access
- Structured output with `outputFormat` JSON schema validation
- Custom MCP tools with in-process servers
- Plugin agent and command execution

### Queue E2E Tests

The queue e2e tests use testcontainers to spin up a real PostgreSQL instance. They require Docker to be running:

```bash
# Start Docker, then run tests
pnpm test:e2e
```

If Docker is not available, queue tests are gracefully skipped with a message. The tests verify:
- `PgBossService` initialization and queue registration
- Job enqueueing, fetching, completing, and failing
- Reply channel factory integration
- Multi-job batch processing

## AgentConfig Options

`AgentConfig` extends the Claude Agent SDK's `Options` type, giving you access to all SDK features plus our REST API extension (`requestSchema`).

**Commonly used options:**

| Option | Type | Description |
|--------|------|-------------|
| `systemPrompt` | `string` | Agent's system prompt (required) |
| `model` | `string` | Model to use (default: claude-sonnet-4-5) |
| `cwd` | `string` | Working directory for file operations |
| `permissionMode` | `PermissionMode` | `'default'` \| `'acceptEdits'` \| `'bypassPermissions'` |
| `tools` | `ToolsConfig` | `{ type: 'preset', preset: 'claude_code' }` or tool array |
| `allowedTools` | `string[]` | Tool allowlist |
| `disallowedTools` | `string[]` | Tools to block |
| `mcpServers` | `Record<string, McpServerConfig>` | Custom MCP servers |
| `plugins` | `SdkPluginConfig[]` | Additional plugins to load |
| `maxTurns` | `number` | Max conversation turns |
| `maxBudgetUsd` | `number` | Max budget in USD |
| `outputFormat` | `OutputFormat` | JSON schema for structured output |
| `requestSchema` | `RequestSchema` | Custom request body schema (REST API extension) |

**Advanced SDK options also available:**

| Option | Type | Description |
|--------|------|-------------|
| `hooks` | `Record<HookEvent, HookCallbackMatcher[]>` | Hook callbacks for events |
| `agents` | `Record<string, AgentDefinition>` | Custom subagent definitions |
| `sandbox` | `SandboxSettings` | Sandbox configuration |
| `settingSources` | `SettingSource[]` | Load settings from filesystem |
| `betas` | `SdkBeta[]` | Beta features (e.g., `'context-1m-2025-08-07'`) |
| `maxThinkingTokens` | `number` | Limit model thinking tokens |
| `fallbackModel` | `string` | Fallback if primary model fails |
| `enableFileCheckpointing` | `boolean` | Track file changes for rewind |

See the [Claude Agent SDK documentation](https://docs.anthropic.com/en/docs/claude-code/sdk) for the complete list of options.

**REST API extension:**

```typescript
interface RequestSchema {
  schema: Record<string, unknown>;         // JSON Schema for request validation
  promptTemplate?: string;                 // Template with {{json}} placeholder (default: "{{json}}")
}
```

### Custom Request Schema

Agents can be configured to accept custom JSON request bodies instead of the standard `{prompt: string}` format. The request body is validated against a JSON schema and converted to a prompt using a customizable template.

```typescript
ClaudePluginModule.forRoot({
  agents: {
    'order-processor': {
      systemPrompt: 'You process orders and return confirmation...',
      requestSchema: {
        schema: {
          type: 'object',
          properties: {
            orderId: { type: 'string' },
            items: { type: 'array', items: { type: 'object' } },
          },
          required: ['orderId', 'items'],
        },
        promptTemplate: 'Process this order:\n{{json}}',
      },
      outputFormat: {
        type: 'json_schema',
        schema: { /* response schema */ },
      },
      permissionMode: 'bypassPermissions',
    },
  },
})
```

**API call example**:
```bash
curl -X POST http://localhost:3000/v1/agents/order-processor \
  -H "Content-Type: application/json" \
  -d '{"orderId": "123", "items": [{"sku": "ABC", "qty": 2}]}'
```

**Behavior**:
- Request body is validated against the JSON schema; returns 400 on validation failure
- Body is converted to prompt using the template (default: just the prettified JSON)
- When `requestSchema` is set, the standard `{prompt: string}` format is not accepted
- `rawResponse` defaults to true if `outputFormat` is also defined

## Custom MCP Tools

Create in-process MCP servers with custom tools using the re-exported SDK functions:

```typescript
import { createSdkMcpServer, tool, z } from '@tigz/claude-code-plugin-rest-api';

const myServer = createSdkMcpServer({
  name: 'my-tools',
  version: '1.0.0',
  tools: [
    tool(
      'my_tool',
      'Description of what this tool does',
      { param: z.string().describe('Parameter description') },
      async (args) => ({
        content: [{ type: 'text', text: `Result: ${args.param}` }],
      }),
    ),
  ],
});

// Use in agent config
ClaudePluginModule.forRoot({
  agents: {
    'my-agent': {
      systemPrompt: 'Use the my_tool to help users.',
      mcpServers: { 'my-tools': myServer },
      allowedTools: ['mcp__my-tools__my_tool'],
      permissionMode: 'bypassPermissions',
    },
  },
})
```

MCP tool naming convention: `mcp__<server-name>__<tool-name>`

## Module Configuration Options

```typescript
ClaudePluginModule.forRoot({
  // User-defined agents (primary interface)
  agents: { ... },

  // Plugin discovery (disabled by default)
  enablePluginEndpoints: false,        // Set true to enable /v1/plugins/* endpoints
  pluginDirectory: '.claude/plugins',  // Directory for file-based plugins
  hotReload: false,                    // Enable in development

  // Global limits
  maxTurns: 50,                        // Default max turns
  maxBudgetUsd: 10.0,                  // Default budget

  // Authentication
  auth: {
    disabled: false,                   // Set true to disable auth
    authFilePath: 'auth.yml',          // Path to YAML auth config
    excludePaths: ['/health'],         // Paths to exclude from auth
    provider: customProvider,          // Custom auth provider
  },
})
```

## Self-Improving Agents

Agents can modify their own plugin files and submit changes for human review via GitOps. This enables autonomous self-improvement while maintaining human oversight.

### Architecture

1. **Git Worktrees**: Agents use `git worktree` to make changes in isolation without affecting the running server
2. **PR-based Review**: All changes go through pull requests for human approval
3. **Hot Reload**: After PR merge, plugins are reloaded via webhook or file watcher
4. **Rollback on Failure**: Plugin discovery preserves previous state if reload fails

### Example Self-Improving Agent

```typescript
ClaudePluginModule.forRoot({
  enablePluginEndpoints: true,
  pluginDirectory: '.claude/plugins',
  hotReload: process.env.NODE_ENV === 'development',
  agents: {
    'self-improver': {
      systemPrompt: `You are a self-improving agent. When you identify improvements to your skills:
        1. Create a git worktree: git worktree add ../$NAME -b improve/$NAME
        2. Make changes in the worktree
        3. Commit and create a PR for human review
        4. Clean up: git worktree remove ../$NAME`,
      permissionMode: 'bypassPermissions',
      allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
      maxTurns: 30,
    },
  },
})
```

### Webhook Endpoint for GitOps

After merging a PR that modifies plugin files, trigger a reload:

```bash
curl -X POST http://localhost:3000/webhook/reload \
  -H "Authorization: Basic $(echo -n 'admin:password' | base64)"

# Response: { "reloaded": true, "pluginCount": 3 }
```

This endpoint is useful for GitHub Actions or other CI/CD systems.

### Graceful Shutdown

Enable graceful shutdown to wait for in-flight agent requests during restarts:

```typescript
// main.ts
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  await app.listen(3000);
}
```

## Async Queue Processing (QueueModule)

For long-running agents or integrations that need asynchronous processing (e.g., Slack bots, webhooks), the library provides a `QueueModule` that uses PostgreSQL-backed job queues via pg-boss.

### Basic Setup

```typescript
import { Module } from '@nestjs/common';
import { QueueModule, defineAgent } from '@tigz/claude-code-plugin-rest-api';

@Module({
  imports: [
    QueueModule.forRoot({
      connectionString: 'postgresql://localhost:5432/mydb',
      agents: {
        'slack-responder': defineAgent({
          systemPrompt: 'You respond to Slack messages helpfully.',
          permissionMode: 'bypassPermissions',
          maxTurns: 10,
        }),
      },
    }),
  ],
})
export class AppModule {}
```

### Sending Async Requests

Publish jobs to agent-specific queues:

```typescript
import { Injectable } from '@nestjs/common';
import { PgBossService } from '@tigz/claude-code-plugin-rest-api';

@Injectable()
export class SlackService {
  constructor(private readonly pgBoss: PgBossService) {}

  async handleSlackMessage(message: string, channelId: string) {
    await this.pgBoss.send('claude.agents.slack-responder.requests', {
      correlationId: `slack-${channelId}-${Date.now()}`,
      agentName: 'slack-responder',
      prompt: message,
      replyTo: 'webhook://https://slack.com/api/chat.postMessage',
      origin: {
        platform: 'slack',
        channelId,
        metadata: { webhookUrl: 'https://slack.com/api/chat.postMessage' },
      },
    });
  }
}
```

### Reply Channels

Responses are delivered via reply channels. Built-in channels:

- **Queue**: `queue://response-queue-name` - Publishes response to another pg-boss queue
- **Webhook**: `webhook://https://example.com/callback` - POSTs response to a URL

### Human-in-the-Loop (HITL) Approval

Configure agents to require approval for specific tools:

```typescript
QueueModule.forRoot({
  connectionString: process.env.DATABASE_URL,
  agents: {
    'deploy-assistant': defineAgent({
      systemPrompt: 'You help deploy applications.',
      permissionMode: 'bypassPermissions',
      hitl: {
        requireApproval: ['Bash:kubectl*', 'Bash:*deploy*', 'Bash:*production*'],
        autoApprove: ['Read:*', 'Glob:*', 'Grep:*'],
        approvalTimeoutMs: 300_000, // 5 minutes
        onTimeout: 'deny', // or 'abort'
      },
    }),
  },
  defaultHitl: {
    approvalTimeoutMs: 600_000, // Global default: 10 minutes
    onTimeout: 'abort',
  },
});
```

When a tool matches `requireApproval` patterns:
1. An approval request is sent via the reply channel
2. Agent execution pauses, waiting for approval
3. Approval decisions are submitted to a queue: `claude.approvals.{correlationId}`

**Pattern syntax:**
- `Bash:*` - Matches any Bash command
- `Bash:kubectl*` - Matches Bash commands starting with kubectl
- `*production*` - Matches anything containing "production"

### Submitting Approval Decisions

```typescript
import { HITLService } from '@tigz/claude-code-plugin-rest-api';

@Injectable()
export class ApprovalHandler {
  constructor(private readonly hitlService: HITLService) {}

  async handleSlackButton(approvalQueueName: string, approved: boolean, user: string) {
    await this.hitlService.submitApproval(approvalQueueName, {
      decision: approved ? 'approve' : 'deny',
      approvedBy: user,
      reason: approved ? undefined : 'Rejected by operator',
    });
  }
}
```

## Release Process

The project uses automated releases via GitHub Actions:

1. **Manual release** using the release script:
   ```bash
   ./scripts/release.sh 1.2.3
   ```
   This updates `package.json`, commits, creates a tag, and pushes to trigger the publish workflow.

2. **Auto-release** via commit message: Any push to `main` with "release" (case insensitive) in the commit message will:
   - Extract version from `package.json`
   - Create a git tag if it doesn't exist
   - Trigger the npm publish workflow

The npm package is published as `@tigz/claude-code-plugin-rest-api`.
