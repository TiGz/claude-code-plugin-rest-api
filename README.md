# Claude Code Plugin REST API

[![npm version](https://img.shields.io/npm/v/@tigz/claude-code-plugin-rest-api.svg)](https://www.npmjs.com/package/@tigz/claude-code-plugin-rest-api)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A NestJS module for building REST APIs powered by Claude agents. Define agents in code with full Claude Agent SDK options and expose them as HTTP endpoints.

## Features

- **User-Defined Agents**: Configure agents programmatically with full SDK options
- **Full SDK Passthrough**: `AgentConfig` extends SDK `Options` - all SDK features available automatically
- **REST API**: Each agent gets its own `/v1/agents/:name` endpoint
- **SSE Streaming**: Real-time streaming responses via Server-Sent Events
- **Custom Request Schemas**: Accept custom JSON bodies with validation (REST API extension)
- **Plugin Discovery**: Also supports file-based Claude Code plugins
- **Authentication**: Built-in basic auth with YAML config or custom providers
- **Claude Max Support**: Works with Claude Max subscription via terminal login

## Quick Start

### Prerequisites

- Node.js 20+
- NestJS application
- Claude Max subscription (run `claude login` to authenticate)

### Installation

```bash
npm install @tigz/claude-code-plugin-rest-api
# or
pnpm add @tigz/claude-code-plugin-rest-api
# or
yarn add @tigz/claude-code-plugin-rest-api
```

You'll also need NestJS peer dependencies if not already installed:

```bash
npm install @nestjs/common @nestjs/core rxjs
```

## User-Defined Agents (Primary Interface)

Define agents in your NestJS module with full Claude Agent SDK options:

```typescript
import { Module } from '@nestjs/common';
import { ClaudePluginModule } from '@tigz/claude-code-plugin-rest-api';

@Module({
  imports: [
    ClaudePluginModule.forRoot({
      agents: {
        // Full-access agent with all tools pre-approved
        'uber-agent': {
          systemPrompt: 'You are a powerful coding assistant with full access.',
          permissionMode: 'bypassPermissions',
          tools: { type: 'preset', preset: 'claude_code' },
          maxTurns: 50,
          maxBudgetUsd: 10.0,
        },

        // Read-only analyst - can only read, not modify
        'code-reviewer': {
          systemPrompt: 'Review code for quality, security, and best practices.',
          allowedTools: ['Read', 'Glob', 'Grep'],
          permissionMode: 'default',
          maxTurns: 20,
        },

        // Task executor with custom MCP servers
        'task-runner': {
          systemPrompt: 'Execute tasks autonomously.',
          permissionMode: 'bypassPermissions',
          tools: { type: 'preset', preset: 'claude_code' },
          mcpServers: {
            database: myDatabaseMcpServer,
            slack: mySlackMcpServer,
          },
        },
      },
    }),
  ],
})
export class AppModule {}
```

### Agent API Endpoints

Each agent is automatically exposed via REST endpoints:

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/agents` | List all user-defined agents |
| GET | `/v1/agents/:name` | Get agent configuration |
| POST | `/v1/agents/:name` | Execute agent (request/response) |
| POST | `/v1/agents/:name/stream` | Create SSE stream session |
| GET | `/v1/stream/:sessionId` | Consume SSE stream |

### Execute an Agent

```bash
# Request/Response mode
curl -X POST http://localhost:3000/v1/agents/uber-agent \
  -H "Content-Type: application/json" \
  -H "Authorization: Basic $(echo -n 'admin:password' | base64)" \
  -d '{"prompt": "Refactor the auth module to use JWT"}'

# Response
{
  "success": true,
  "result": "I've refactored the auth module...",
  "cost": 0.05,
  "turns": 3,
  "usage": { "inputTokens": 1234, "outputTokens": 567 }
}
```

### Stream Agent Responses

```bash
# 1. Create stream session
SESSION=$(curl -s -X POST http://localhost:3000/v1/agents/uber-agent/stream \
  -H "Content-Type: application/json" \
  -H "Authorization: Basic $(echo -n 'admin:password' | base64)" \
  -d '{"prompt": "Explain this codebase"}' \
  | jq -r '.sessionId')

# 2. Consume SSE stream
curl -N http://localhost:3000/v1/stream/$SESSION \
  -H "Authorization: Basic $(echo -n 'admin:password' | base64)"
```

## AgentConfig Options

`AgentConfig` extends the Claude Agent SDK's `Options` type, giving you full access to all SDK features plus our REST API extension (`requestSchema`).

### Commonly Used Options

| Option | Type | Description |
|--------|------|-------------|
| `systemPrompt` | `string` | Agent's system prompt (**required**) |
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

### Advanced SDK Options

Since `AgentConfig` extends the SDK's `Options` type, you also have access to:

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

### Key Options Explained

- **`permissionMode: 'bypassPermissions'`**: Pre-approves all tool uses - no confirmation needed
- **`tools: { type: 'preset', preset: 'claude_code' }`**: Enables all Claude Code built-in tools
- **`allowedTools`**: Restrict agent to specific tools only
- **`mcpServers`**: Add custom MCP servers for database, APIs, etc.
- **`settingSources`**: Load skills from user/project settings
- **`outputFormat`**: Enforce structured JSON output with schema validation
- **`hooks`**: Respond to events like `PreToolUse`, `PostToolUse`, `SessionStart`
- **`agents`**: Define custom subagents for the Task tool

### Re-exported SDK Types

For convenience, commonly used SDK types are re-exported from the package:

```typescript
import type {
  Options,              // Full SDK options type
  PermissionMode,       // 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk'
  OutputFormat,         // JSON schema output format
  McpServerConfig,      // MCP server configuration
  AgentDefinition,      // Subagent definitions
  SDKMessage,           // Union of all message types
  SDKResultMessage,     // Result message type
  Query,                // AsyncGenerator with control methods
} from '@tigz/claude-code-plugin-rest-api';
```

### Structured Output Example

Use `outputFormat` to get validated JSON responses:

```typescript
ClaudePluginModule.forRoot({
  agents: {
    'code-analyzer': {
      systemPrompt: 'Analyze code and return structured results.',
      outputFormat: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            summary: { type: 'string' },
            score: { type: 'number', minimum: 0, maximum: 10 },
            issues: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  severity: { type: 'string', enum: ['low', 'medium', 'high'] },
                  message: { type: 'string' },
                  line: { type: 'number' }
                },
                required: ['severity', 'message']
              }
            }
          },
          required: ['summary', 'score'],
          additionalProperties: false
        }
      }
    }
  }
})
```

The response includes `structuredOutput` with validated JSON:

```json
{
  "success": true,
  "result": "...",
  "structuredOutput": {
    "summary": "Well-structured code with minor issues",
    "score": 8,
    "issues": [
      { "severity": "low", "message": "Consider adding type annotations", "line": 42 }
    ]
  }
}
```

#### Raw Response Mode

For agents with `outputFormat`, the API automatically returns the structured JSON directly (raw response mode). You can override this behavior:

```bash
# Default behavior - returns structured JSON directly
curl -X POST http://localhost:3000/v1/agents/code-analyzer \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Analyze the number 42"}'

# Returns:
{
  "summary": "Well-structured code with minor issues",
  "score": 8,
  "issues": [...]
}

# Get wrapped response with metadata instead
curl -X POST http://localhost:3000/v1/agents/code-analyzer \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Analyze the number 42", "rawResponse": false}'

# Returns:
{
  "success": true,
  "result": "...",
  "structuredOutput": { "summary": "...", "score": 8, ... },
  "cost": 0.02,
  "turns": 1,
  "usage": { "inputTokens": 123, "outputTokens": 45 }
}
```

For agents without `outputFormat`, you can still enable raw response mode:

```bash
curl -X POST http://localhost:3000/v1/agents/math-helper \
  -H "Content-Type: application/json" \
  -d '{"prompt": "What is 2+2?", "rawResponse": true}'

# Returns just the text response:
The answer is 4.
```

### Custom Request Schema (REST API Extension)

The `requestSchema` option lets agents accept custom JSON bodies instead of the standard `{prompt: string}` format:

```typescript
ClaudePluginModule.forRoot({
  agents: {
    'order-processor': {
      systemPrompt: 'Process orders and return confirmation.',
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
        schema: {
          type: 'object',
          properties: {
            confirmed: { type: 'boolean' },
            total: { type: 'number' },
          },
          required: ['confirmed', 'total'],
        },
      },
      permissionMode: 'bypassPermissions',
    },
  },
})
```

Now the agent accepts custom JSON directly:

```bash
curl -X POST http://localhost:3000/v1/agents/order-processor \
  -H "Content-Type: application/json" \
  -d '{"orderId": "123", "items": [{"sku": "ABC", "qty": 2}]}'

# Returns:
{"confirmed": true, "total": 49.99}
```

### Custom MCP Tools Example

Create in-process MCP servers with custom tools using `createSdkMcpServer` and `tool`:

```typescript
import { ClaudePluginModule, createSdkMcpServer, tool, z } from '@tigz/claude-code-plugin-rest-api';

// Create an in-process MCP server with custom tools
const calculatorServer = createSdkMcpServer({
  name: 'calculator',
  version: '1.0.0',
  tools: [
    tool(
      'add',
      'Add two numbers together',
      { a: z.number(), b: z.number() },
      async (args) => ({
        content: [{ type: 'text', text: `${args.a + args.b}` }],
      }),
    ),
    tool(
      'multiply',
      'Multiply two numbers together',
      { a: z.number(), b: z.number() },
      async (args) => ({
        content: [{ type: 'text', text: `${args.a * args.b}` }],
      }),
    ),
  ],
});

@Module({
  imports: [
    ClaudePluginModule.forRoot({
      agents: {
        'calculator-agent': {
          systemPrompt: 'Use the calculator tools to perform calculations.',
          permissionMode: 'bypassPermissions',
          mcpServers: {
            calculator: calculatorServer,
          },
          // MCP tools follow the pattern: mcp__<server-name>__<tool-name>
          allowedTools: ['mcp__calculator__add', 'mcp__calculator__multiply'],
        },
      },
    }),
  ],
})
export class AppModule {}
```

MCP tools run in the same process as your NestJS application, enabling:
- Custom business logic tools
- Database access tools
- External API integrations
- Any async operation

## Plugin Discovery (Optional)

The module can also discover file-based plugins from the filesystem. Plugin endpoints are disabled by default - enable them with `enablePluginEndpoints: true`:

```
.claude/plugins/
└── my-plugin/
    ├── .claude-plugin/
    │   └── plugin.json        # Plugin manifest
    ├── agents/
    │   └── my-agent.md        # Agent definition
    └── commands/
        └── my-command.md      # Command definition
```

### Plugin API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/plugins` | List all discovered plugins |
| GET | `/v1/plugins/:name` | Get plugin details |
| POST | `/v1/plugins/:plugin/agents/:agent` | Execute plugin agent |
| POST | `/v1/plugins/:plugin/commands/:cmd` | Execute command |
| POST | `/v1/plugins/stream` | Create SSE stream session |

## Configuration

### Module Options

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

### Async Configuration

```typescript
ClaudePluginModule.forRootAsync({
  useFactory: (config: ConfigService) => ({
    agents: {
      'my-agent': {
        systemPrompt: config.get('AGENT_PROMPT'),
        permissionMode: 'bypassPermissions',
      },
    },
    auth: { disabled: config.get('DISABLE_AUTH') === 'true' },
  }),
  inject: [ConfigService],
})
```

### Authentication

By default, the module uses basic auth with credentials from `auth.yml`:

```yaml
users:
  - username: admin
    password: $2b$10$...  # bcrypt hash
  - username: dev
    password: plaintext   # Plain text (dev only!)
```

To disable authentication:

```typescript
ClaudePluginModule.forRoot({
  auth: { disabled: true },
})
```

## Testing

```bash
# Run e2e tests (CI-safe, no credentials needed)
pnpm test:e2e

# Run local integration tests (requires `claude login`)
pnpm test:local
```

## Headless Server Authentication

Claude Code requires browser-based OAuth for initial login. On headless servers/VPS without a browser, use one of these methods:

### Method 1: SSH Port Forwarding (Recommended)

Forward the OAuth callback port from your local machine:

```bash
# On your local machine, SSH to server with port forwarding
ssh -L 8080:localhost:8080 user@your-server

# On the server, run login
claude login
```

The OAuth flow will open in your local browser, but the callback reaches the server through the tunnel.

### Method 2: Copy Credentials

Authenticate locally and transfer the credentials file:

```bash
# On your local machine
claude login

# Copy credentials to server
scp ~/.config/claude-code/auth.json user@server:~/.config/claude-code/
```

### Method 3: Docker Volume Mount

For containerized deployments, mount your local credentials:

```bash
docker run -v ~/.config/claude-code/auth.json:/root/.config/claude-code/auth.json:ro your-image
```

Or in docker-compose:

```yaml
volumes:
  - ~/.config/claude-code/auth.json:/root/.config/claude-code/auth.json:ro
```

## Docker

```bash
cd examples/basic-server
docker-compose up
```

## Project Structure

```
.
├── packages/
│   └── claude-code-plugin-rest-api/   # Core NestJS module
├── examples/
│   └── basic-server/                  # Example implementation
└── plans/                             # Design documents
```

## License

MIT
