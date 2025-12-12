# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A template project for building REST APIs using NestJS that leverage Claude agents via the Claude Agent SDK. Configured for Claude Max subscription with terminal-based (non-browser) authentication.

## Development Commands

```bash
# Install dependencies
pnpm install

# Development
pnpm dev              # Start development server with hot reload
pnpm build            # Build for production
pnpm start:prod       # Run production build

# Testing
pnpm test             # Run all tests
pnpm test:watch       # Run tests in watch mode
pnpm test <file>      # Run a single test file

# Code Quality
pnpm lint             # Run ESLint
pnpm lint:fix         # Fix linting issues
pnpm format           # Format code with Prettier
```

## Architecture

### Core Stack
- **Runtime**: Node.js with TypeScript
- **Package Manager**: pnpm
- **Framework**: NestJS for REST API structure
- **AI Integration**: Claude Agent SDK with plugin architecture
- **Authentication**: Claude Max subscription via terminal login (non-browser OAuth flow)

### Project Structure (Planned)
```
src/
├── agents/           # Claude agent definitions and configurations
├── plugins/          # Agent plugins for extending capabilities
├── modules/          # NestJS feature modules
│   └── api/          # REST API controllers and services
├── common/           # Shared utilities, guards, interceptors
└── config/           # Environment and app configuration
```

### Key Patterns
- **Agent Plugins**: Extend agent capabilities through a plugin system
- **NestJS Modules**: Feature-based module organization for API endpoints
- **Dependency Injection**: Leverage NestJS DI for agent and service management
- **Terminal Auth**: Use Claude CLI authentication flow for Max subscription access

## Claude Max Terminal Authentication

The project uses terminal-based authentication for Claude Max subscription:
- Run `claude login` in terminal to authenticate
- Credentials are stored locally and reused by the Agent SDK
- No browser-based OAuth required for API access
