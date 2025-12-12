# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A pnpm monorepo template for building REST APIs using NestJS that expose Claude Code plugins as HTTP endpoints. Uses the Claude Agent SDK with Claude Max subscription support via terminal-based authentication.

## Monorepo Structure

```
.
├── packages/
│   └── claude-code-plugin-rest-api/    # Core NestJS module library
│       └── src/
│           ├── auth/              # Basic auth guard and YAML provider
│           ├── controllers/       # Plugin, stream, and files controllers
│           ├── services/          # Discovery, execution, and session services
│           └── types/             # TypeScript interfaces
├── examples/
│   └── basic-server/              # Example NestJS application
│       ├── src/                   # App module, main entry, health controller
│       ├── test/                  # E2E and local integration tests
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
- `PluginDiscoveryService` - Discovers plugins from filesystem
- `PluginExecutionService` - Executes agents/commands via Claude SDK
- `StreamSessionService` - Manages SSE streaming sessions
- Built-in controllers for `/v1/plugins/*` endpoints
- Optional basic auth with YAML or custom providers

### Plugin Structure
Plugins live in `.claude/plugins/<plugin-name>/` with:
- `.claude-plugin/plugin.json` - Manifest file
- `agents/*.md` - Agent definitions with frontmatter
- `commands/*.md` - Command definitions
- `skills/*/SKILL.md` - Skill definitions

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/plugins` | List all discovered plugins |
| GET | `/v1/plugins/:name` | Get plugin details |
| POST | `/v1/plugins/:plugin/agents/:agent` | Execute agent |
| POST | `/v1/plugins/:plugin/commands/:cmd` | Execute command |
| POST | `/v1/plugins/stream` | Create SSE stream session |
| GET | `/v1/stream/:sessionId` | Consume SSE stream |

## Claude Max Authentication

The project uses terminal-based authentication for Claude Max subscription:
1. Run `claude login` in terminal to authenticate
2. Credentials are stored locally and reused by the Agent SDK
3. No browser-based OAuth or API keys required

## Testing Strategy

- **E2E tests** (`test:e2e`): Test API endpoints without requiring Claude credentials. Safe for CI.
- **Local tests** (`test:local`): Full integration tests that execute real Claude agents. Requires `claude login`.
