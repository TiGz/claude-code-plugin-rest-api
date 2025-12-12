# Claude Code Plugin REST API

A NestJS module for building REST APIs powered by Claude agents. Define agents in code with full Claude Agent SDK options and expose them as HTTP endpoints.

## Features

- **User-Defined Agents**: Configure agents programmatically with full SDK options
- **Full SDK Support**: permissionMode, tools presets, MCP servers, plugins, and more
- **REST API**: Each agent gets its own `/v1/agents/:name` endpoint
- **SSE Streaming**: Real-time streaming responses via Server-Sent Events
- **Plugin Discovery**: Also supports file-based Claude Code plugins
- **Authentication**: Built-in basic auth with YAML config or custom providers
- **Claude Max Support**: Works with Claude Max subscription via terminal login

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm
- Claude Max subscription (run `claude login` to authenticate)

### Installation

```bash
# Clone and install
git clone https://github.com/tigz/claude-code-plugin-rest-api.git
cd claude-code-plugin-rest-api
pnpm install

# Build the library
pnpm build

# Run the example server
cd examples/basic-server
pnpm dev
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

Full Claude Agent SDK options available:

```typescript
interface AgentConfig {
  // Required
  systemPrompt: string;              // Agent's system prompt

  // Model & Directory
  model?: string;                    // Model (default: claude-sonnet-4-5)
  workingDirectory?: string;         // Agent's working directory

  // Tools Configuration
  tools?: ToolsConfig;               // Preset or explicit list
  allowedTools?: string[];           // Tool allowlist (alternative to tools)
  disallowedTools?: string[];        // Tools to block

  // Permissions
  permissionMode?: PermissionMode;   // 'default' | 'acceptEdits' | 'bypassPermissions'

  // Extensions
  plugins?: PluginPath[];            // Additional plugins to load
  mcpServers?: Record<string, any>;  // Custom MCP servers
  settingSources?: ('user' | 'project' | 'local')[];

  // Limits
  maxTurns?: number;                 // Max conversation turns
  maxBudgetUsd?: number;             // Max budget in USD

  // Structured Output
  outputFormat?: OutputFormat;       // JSON schema for validated output

  // Beta Features
  betas?: string[];                  // e.g., ['context-1m-2025-08-07']
}

// Tools can be a preset or explicit list
type ToolsConfig = string[] | { type: 'preset'; preset: 'claude_code' };

// Permission modes
type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions';

// Structured output format
interface OutputFormat {
  type: 'json_schema';
  schema: Record<string, unknown>;   // JSON Schema object
}
```

### Key Options Explained

- **`permissionMode: 'bypassPermissions'`**: Pre-approves all tool uses - no confirmation needed
- **`tools: { type: 'preset', preset: 'claude_code' }`**: Enables all Claude Code built-in tools
- **`allowedTools`**: Restrict agent to specific tools only
- **`mcpServers`**: Add custom MCP servers for database, APIs, etc.
- **`settingSources`**: Load skills from user/project settings
- **`outputFormat`**: Enforce structured JSON output with schema validation

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

## Plugin Discovery (Secondary Interface)

The module also discovers file-based plugins from the filesystem:

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

  // Plugin discovery (secondary interface)
  pluginDirectory: '.claude/plugins',  // Default
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
