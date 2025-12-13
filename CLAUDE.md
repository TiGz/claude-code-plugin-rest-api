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

**ClaudePluginModule** - Dynamic NestJS module that provides:
- `AgentService` - Executes user-defined agents with full SDK options
- `PluginDiscoveryService` - Discovers plugins from filesystem
- `PluginExecutionService` - Executes plugin agents/commands via Claude SDK
- `StreamSessionService` - Manages SSE streaming sessions
- Built-in controllers for `/v1/agents/*` and `/v1/plugins/*` endpoints
- Optional basic auth with YAML or custom providers

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

## Claude Max Authentication

The project uses terminal-based authentication for Claude Max subscription:
1. Run `claude login` in terminal to authenticate
2. Credentials are stored locally and reused by the Agent SDK
3. No browser-based OAuth or API keys required

## Testing Strategy

- **Unit tests** (`pnpm test` in packages): Test services and providers in isolation
- **E2E tests** (`test:e2e`): Test API endpoints without requiring Claude credentials. Safe for CI.
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

## AgentConfig Options

Full SDK options available for user-defined agents:

```typescript
interface AgentConfig {
  systemPrompt: string;                    // Required: Agent's system prompt
  model?: string;                          // Model to use (default: claude-sonnet-4-5)
  workingDirectory?: string;               // Agent's working directory
  plugins?: PluginPath[];                  // Additional plugins to load
  mcpServers?: Record<string, any>;        // Custom MCP servers
  tools?: ToolsConfig;                     // Tools preset or explicit list
  allowedTools?: string[];                 // Tool allowlist
  disallowedTools?: string[];              // Tools to block
  permissionMode?: PermissionMode;         // 'default' | 'acceptEdits' | 'bypassPermissions'
  settingSources?: ('user'|'project'|'local')[];  // Load settings from filesystem
  maxTurns?: number;                       // Max conversation turns
  maxBudgetUsd?: number;                   // Max budget in USD
  outputFormat?: OutputFormat;             // JSON schema for structured output
  betas?: string[];                        // Beta features to enable
}

interface OutputFormat {
  type: 'json_schema';
  schema: Record<string, unknown>;         // JSON Schema object
}
```

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
