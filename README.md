# Claude Code Plugin REST API

A NestJS module for exposing Claude Code plugins as REST API endpoints. Build HTTP services powered by Claude agents using the Claude Agent SDK.

## Features

- **Plugin Discovery**: Automatically discovers and loads Claude Code plugins from the filesystem
- **REST API**: Exposes plugins as HTTP endpoints with Swagger documentation
- **SSE Streaming**: Real-time streaming responses via Server-Sent Events
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

### Using the Module

```typescript
import { Module } from '@nestjs/common';
import { ClaudePluginModule } from '@tigz/claude-code-plugin-rest-api';

@Module({
  imports: [
    ClaudePluginModule.forRoot({
      pluginDirectory: '.claude/plugins',
      hotReload: process.env.NODE_ENV === 'development',
      // auth: { disabled: true }, // Disable auth for development
    }),
  ],
})
export class AppModule {}
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/plugins` | List all discovered plugins |
| GET | `/v1/plugins/:name` | Get plugin details with available agents/commands |
| POST | `/v1/plugins/:plugin/agents/:agent` | Execute an agent |
| POST | `/v1/plugins/:plugin/commands/:cmd` | Execute a command |
| POST | `/v1/plugins/stream` | Create an SSE stream session |
| GET | `/v1/stream/:sessionId` | Consume SSE stream |

### Example: Execute an Agent

```bash
curl -X POST http://localhost:3000/v1/plugins/example-plugin/agents/code-helper \
  -H "Content-Type: application/json" \
  -H "Authorization: Basic $(echo -n 'admin:password' | base64)" \
  -d '{"prompt": "What is 2 + 2?"}'
```

### Example: Stream Responses

```bash
# Create stream session
SESSION=$(curl -s -X POST http://localhost:3000/v1/plugins/stream \
  -H "Content-Type: application/json" \
  -d '{"pluginName": "example-plugin", "agentName": "code-helper", "prompt": "Hello"}' \
  | jq -r '.sessionId')

# Consume stream
curl -N http://localhost:3000/v1/stream/$SESSION
```

## Plugin Structure

Plugins are discovered from the configured `pluginDirectory` (default: `.claude/plugins`).

```
.claude/plugins/
└── my-plugin/
    ├── .claude-plugin/
    │   └── plugin.json        # Plugin manifest
    ├── agents/
    │   └── my-agent.md        # Agent definition
    ├── commands/
    │   └── my-command.md      # Command definition
    └── skills/
        └── my-skill/
            └── SKILL.md       # Skill definition
```

### Plugin Manifest (`plugin.json`)

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "My custom plugin"
}
```

### Agent Definition (`agents/my-agent.md`)

```markdown
---
name: my-agent
description: A helpful coding assistant
tools: Read,Write,Glob,Grep
model: claude-sonnet-4-20250514
---

You are a helpful coding assistant. Help users with their programming questions.
```

## Configuration

### Module Options

```typescript
ClaudePluginModule.forRoot({
  // Directory containing plugins (default: '.claude/plugins')
  pluginDirectory: '.claude/plugins',

  // Enable hot reload when plugin files change (default: false)
  hotReload: false,

  // Maximum agent turns (default: 50)
  maxTurns: 50,

  // Maximum budget per execution in USD (default: 10.0)
  maxBudgetUsd: 10.0,

  // Authentication options
  auth: {
    disabled: false,           // Set true to disable auth
    authFilePath: 'auth.yml',  // Path to YAML auth config
    excludePaths: ['/health'], // Paths to exclude from auth
    provider: customProvider,  // Custom auth provider
  },
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
│   └── basic-server/             # Example implementation
└── plans/                        # Design documents
```

## License

MIT
