# feat: NestJS REST API for Claude Code Plugins

## Overview

Build a **publishable npm library** (`@tigz/claude-code-plugin-api`) that provides a NestJS module for automatically discovering and exposing Claude Code plugins as HTTP endpoints. The library is consumed by example projects that demonstrate Docker deployment.

**Key Differentiator**: This is not a custom plugin system - it discovers and exposes **actual Claude Code plugins** (the same plugins used by `claude` CLI) via REST API.

## Problem Statement / Motivation

Claude Code plugins are powerful but limited to CLI/terminal usage. Developers want to:

1. **Use Claude Code plugins in web applications** - Call plugin commands/agents from frontends
2. **Build services backed by Claude Code plugins** - Create APIs that leverage existing plugin ecosystem
3. **Expose Claude agents as microservices** - Allow other services to consume Claude capabilities
4. **Share Claude Code workflows via HTTP** - Enable non-CLI access to Claude Code features

This template bridges the gap between Claude Code's plugin ecosystem and REST API consumers.

## Proposed Solution

A **monorepo** with two packages:

### 1. `@tigz/claude-code-plugin-api` (npm library)
- NestJS dynamic module for plugin discovery and execution
- Publishable to GitHub Packages
- Zero-config defaults with full customization options

### 2. `examples/basic-server` (example consumer)
- Demonstrates how to use the library
- Includes Docker and docker-compose configuration
- Ready-to-clone starting point for users

## Technical Approach

### Monorepo Structure

```
claude-code-plugin-api/
├── package.json                      # Workspace root
├── pnpm-workspace.yaml               # pnpm workspaces config
├── .npmrc                            # GitHub Packages registry config
├── turbo.json                        # Turborepo config (optional)
│
├── packages/
│   └── claude-code-plugin-api/       # @tigz/claude-code-plugin-api
│       ├── package.json
│       ├── tsconfig.json
│       ├── src/
│       │   ├── index.ts              # Public exports
│       │   ├── claude-plugin.module.ts
│       │   ├── services/
│       │   │   ├── plugin-discovery.service.ts
│       │   │   ├── plugin-execution.service.ts
│       │   │   └── stream-session.service.ts
│       │   ├── controllers/
│       │   │   └── plugin.controller.ts
│       │   └── types/
│       │       └── plugin.types.ts
│       └── README.md
│
└── examples/
    └── basic-server/                 # Example consumer project
        ├── package.json              # Depends on @tigz/claude-code-plugin-api
        ├── tsconfig.json
        ├── src/
        │   ├── main.ts
        │   └── app.module.ts         # Imports ClaudePluginModule.forRoot()
        ├── .claude/
        │   └── plugins/              # User's plugins go here
        │       └── example-plugin/
        ├── Dockerfile
        ├── docker-compose.yml
        └── README.md
```

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Consumer Application (examples/basic-server)              │
│                                                                              │
│   import { ClaudePluginModule } from '@tigz/claude-code-plugin-api';        │
│                                                                              │
│   @Module({                                                                  │
│     imports: [                                                               │
│       ClaudePluginModule.forRoot({                                          │
│         pluginDirectory: '.claude/plugins',                                  │
│         hotReload: true,                                                     │
│       }),                                                                    │
│     ],                                                                       │
│   })                                                                         │
│   export class AppModule {}                                                  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                @tigz/claude-code-plugin-api (npm library)                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                    Plugin Discovery Service                             │ │
│  │  - Scans configured plugin directory                                    │ │
│  │  - Parses plugin.json manifests                                         │ │
│  │  - Builds registry of commands/agents/skills                            │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                    │                                         │
│                                    ▼                                         │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                     Plugin Gateway Controller                           │ │
│  │                                                                          │ │
│  │  GET  /v1/plugins                    → List all plugins                 │ │
│  │  GET  /v1/plugins/:name              → Plugin details                   │ │
│  │  POST /v1/plugins/:name/commands/:cmd → Execute command                │ │
│  │  POST /v1/plugins/:name/agents/:agent → Execute agent                  │ │
│  │  POST /v1/stream                     → Create SSE session              │ │
│  │  GET  /v1/stream/:sessionId          → Consume SSE stream              │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                    │                                         │
│                                    ▼                                         │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                        Agent Execution Service                          │ │
│  │  - Loads command/agent markdown files                                   │ │
│  │  - Passes instructions to Claude Agent SDK                              │ │
│  │  - Handles streaming responses                                          │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
                      ┌────────────────────────────────┐
                      │     Claude Agent SDK           │
                      │  (@anthropic-ai/claude-code)   │
                      └────────────────────────────────┘
                                       │
                                       ▼
                      ┌────────────────────────────────┐
                      │  Claude Code Plugins           │
                      │  .claude/plugins/              │
                      └────────────────────────────────┘
```

### Claude Code Plugin Structure

Claude Code plugins follow this standard structure:

```
plugin-name/
├── .claude-plugin/
│   └── plugin.json          # Required: plugin manifest
├── commands/                 # Slash commands (optional)
│   └── hello.md             # /plugin-name:hello
├── agents/                   # Subagents (optional)
│   └── helper.md            # Specialized agent
├── skills/                   # Agent skills (optional)
│   └── my-skill/
│       └── SKILL.md         # Model-invoked capability
├── hooks/                    # Event handlers (optional)
│   └── hooks.json
└── .mcp.json                # MCP servers (optional)
```

**plugin.json manifest**:
```json
{
  "name": "plugin-name",
  "version": "1.0.0",
  "description": "What this plugin does",
  "author": { "name": "Author", "email": "author@example.com" },
  "commands": ["./commands/"],
  "agents": "./agents/",
  "skills": "./skills/"
}
```

### Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Plugin Discovery | Filesystem scan at startup | Simple, reliable, matches Claude Code behavior |
| Hot Reload | File watcher (chokidar) | Developer experience for local plugin development |
| URL Pattern | `/v1/plugins/:name/:type/:action` | RESTful, clear hierarchy, supports namespacing |
| Streaming | Two-step POST → SSE | Handles complex payloads, supports POST body with SSE |
| Execution | Per-request agent instance | Isolation, no shared state, predictable behavior |
| Authentication | Shared ~/.claude credentials | Matches Claude Max subscription model |
| API Authentication | Pluggable auth guards with YAML file default | Simple setup, extensible for custom providers |
| Raw Response Mode | `rawResponse` flag with auto-detect | Allows direct JSON/text output for API-to-API integrations |
| Multimodal Input | `attachments` array with base64/URL/fileId | Supports images, PDFs, and text files via Anthropic API format |
| Files API | Proxy to Anthropic Files API | Upload once, reference many times; efficient for large/repeated files |

---

## Implementation Phases

### Phase 0: Monorepo Setup

#### 0.1 Root Workspace Configuration

**package.json (root):**

```json
{
  "name": "claude-code-plugin-api-monorepo",
  "private": true,
  "scripts": {
    "build": "pnpm -r build",
    "dev": "pnpm --filter @tigz/claude-code-plugin-api dev",
    "dev:example": "pnpm --filter basic-server dev",
    "test": "pnpm -r test",
    "lint": "pnpm -r lint",
    "publish:lib": "pnpm --filter @tigz/claude-code-plugin-api publish"
  },
  "devDependencies": {
    "typescript": "^5.4.0"
  },
  "engines": {
    "node": ">=20.0.0",
    "pnpm": ">=9.0.0"
  }
}
```

**pnpm-workspace.yaml:**

```yaml
packages:
  - 'packages/*'
  - 'examples/*'
```

**.npmrc:**

```ini
@tigz:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

#### 0.2 Library Package Configuration

**packages/claude-code-plugin-api/package.json:**

```json
{
  "name": "@tigz/claude-code-plugin-api",
  "version": "0.1.0",
  "description": "NestJS module for exposing Claude Code plugins as REST APIs",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": [
    "dist"
  ],
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "jest",
    "prepublishOnly": "pnpm build"
  },
  "keywords": [
    "nestjs",
    "claude",
    "claude-code",
    "plugins",
    "rest-api",
    "anthropic"
  ],
  "author": "tigz",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/tigz/claude-code-plugin-api.git"
  },
  "publishConfig": {
    "registry": "https://npm.pkg.github.com"
  },
  "peerDependencies": {
    "@nestjs/common": "^10.0.0 || ^11.0.0",
    "@nestjs/core": "^10.0.0 || ^11.0.0",
    "rxjs": "^7.8.0"
  },
  "dependencies": {
    "@anthropic-ai/claude-code": "^0.2.0",
    "@anthropic-ai/sdk": "^0.30.0",
    "@nestjs/config": "^3.0.0",
    "@nestjs/event-emitter": "^2.0.0",
    "@nestjs/platform-express": "^10.0.0",
    "@nestjs/swagger": "^7.0.0",
    "chokidar": "^3.6.0",
    "gray-matter": "^4.0.3",
    "multer": "^1.4.5-lts.1",
    "uuid": "^9.0.0"
  },
  "devDependencies": {
    "@nestjs/common": "^10.0.0",
    "@nestjs/core": "^10.0.0",
    "@nestjs/testing": "^10.0.0",
    "@types/jest": "^29.5.0",
    "@types/node": "^20.0.0",
    "@types/multer": "^1.4.0",
    "@types/uuid": "^9.0.0",
    "jest": "^29.7.0",
    "reflect-metadata": "^0.2.0",
    "rxjs": "^7.8.0",
    "ts-jest": "^29.1.0",
    "typescript": "^5.4.0"
  }
}
```

**packages/claude-code-plugin-api/tsconfig.json:**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

#### 0.3 Library Public API

**packages/claude-code-plugin-api/src/index.ts:**

```typescript
// Main module export
export { ClaudePluginModule } from './claude-plugin.module';
export type { ClaudePluginModuleOptions } from './claude-plugin.module';

// Services (for advanced usage)
export { PluginDiscoveryService } from './services/plugin-discovery.service';
export { PluginExecutionService } from './services/plugin-execution.service';
export type { ExecutionOptions, ExecutionResult, Attachment, AttachmentSource } from './services/plugin-execution.service';
export { StreamSessionService } from './services/stream-session.service';

// Types
export type {
  PluginManifest,
  PluginCommand,
  PluginAgent,
  PluginSkill,
  DiscoveredPlugin,
} from './types/plugin.types';

// Controllers (for custom routing)
export { PluginController, StreamController } from './controllers/plugin.controller';
export { FilesController } from './controllers/files.controller';
```

#### 0.4 Dynamic Module with forRoot()

**packages/claude-code-plugin-api/src/claude-plugin.module.ts:**

```typescript
import { Module, DynamicModule, Provider } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { PluginDiscoveryService } from './services/plugin-discovery.service';
import { PluginExecutionService } from './services/plugin-execution.service';
import { StreamSessionService } from './services/stream-session.service';
import { PluginController, StreamController } from './controllers/plugin.controller';

export interface ClaudePluginModuleOptions {
  /**
   * Directory containing Claude Code plugins
   * @default '.claude/plugins'
   */
  pluginDirectory?: string;

  /**
   * Enable hot reload of plugins when files change
   * @default false
   */
  hotReload?: boolean;

  /**
   * Maximum turns for agent execution
   * @default 50
   */
  maxTurns?: number;

  /**
   * Maximum budget in USD for agent execution
   * @default 10.0
   */
  maxBudgetUsd?: number;

  /**
   * Route prefix for plugin endpoints
   * @default 'v1'
   */
  routePrefix?: string;

  /**
   * Include built-in controllers (set to false for custom routing)
   * @default true
   */
  includeControllers?: boolean;
}

const CLAUDE_PLUGIN_OPTIONS = 'CLAUDE_PLUGIN_OPTIONS';

@Module({})
export class ClaudePluginModule {
  /**
   * Configure the Claude Plugin module with options
   */
  static forRoot(options: ClaudePluginModuleOptions = {}): DynamicModule {
    const optionsProvider: Provider = {
      provide: CLAUDE_PLUGIN_OPTIONS,
      useValue: {
        pluginDirectory: options.pluginDirectory ?? '.claude/plugins',
        hotReload: options.hotReload ?? false,
        maxTurns: options.maxTurns ?? 50,
        maxBudgetUsd: options.maxBudgetUsd ?? 10.0,
        routePrefix: options.routePrefix ?? 'v1',
        includeControllers: options.includeControllers ?? true,
      },
    };

    const controllers = options.includeControllers !== false
      ? [PluginController, StreamController, FilesController]
      : [];

    return {
      module: ClaudePluginModule,
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        EventEmitterModule.forRoot(),
      ],
      controllers,
      providers: [
        optionsProvider,
        {
          provide: PluginDiscoveryService,
          useFactory: (opts: ClaudePluginModuleOptions) => {
            return new PluginDiscoveryService(opts);
          },
          inject: [CLAUDE_PLUGIN_OPTIONS],
        },
        {
          provide: PluginExecutionService,
          useFactory: (
            opts: ClaudePluginModuleOptions,
            discovery: PluginDiscoveryService,
          ) => {
            return new PluginExecutionService(opts, discovery);
          },
          inject: [CLAUDE_PLUGIN_OPTIONS, PluginDiscoveryService],
        },
        StreamSessionService,
      ],
      exports: [
        PluginDiscoveryService,
        PluginExecutionService,
        StreamSessionService,
        CLAUDE_PLUGIN_OPTIONS,
      ],
      global: true,
    };
  }

  /**
   * Configure the module asynchronously (e.g., from ConfigService)
   */
  static forRootAsync(options: {
    useFactory: (...args: any[]) => ClaudePluginModuleOptions | Promise<ClaudePluginModuleOptions>;
    inject?: any[];
    imports?: any[];
  }): DynamicModule {
    const optionsProvider: Provider = {
      provide: CLAUDE_PLUGIN_OPTIONS,
      useFactory: async (...args: any[]) => {
        const opts = await options.useFactory(...args);
        return {
          pluginDirectory: opts.pluginDirectory ?? '.claude/plugins',
          hotReload: opts.hotReload ?? false,
          maxTurns: opts.maxTurns ?? 50,
          maxBudgetUsd: opts.maxBudgetUsd ?? 10.0,
          routePrefix: opts.routePrefix ?? 'v1',
          includeControllers: opts.includeControllers ?? true,
        };
      },
      inject: options.inject || [],
    };

    return {
      module: ClaudePluginModule,
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        EventEmitterModule.forRoot(),
        ...(options.imports || []),
      ],
      controllers: [PluginController, StreamController, FilesController],
      providers: [
        optionsProvider,
        {
          provide: PluginDiscoveryService,
          useFactory: (opts: ClaudePluginModuleOptions) => {
            return new PluginDiscoveryService(opts);
          },
          inject: [CLAUDE_PLUGIN_OPTIONS],
        },
        {
          provide: PluginExecutionService,
          useFactory: (
            opts: ClaudePluginModuleOptions,
            discovery: PluginDiscoveryService,
          ) => {
            return new PluginExecutionService(opts, discovery);
          },
          inject: [CLAUDE_PLUGIN_OPTIONS, PluginDiscoveryService],
        },
        StreamSessionService,
      ],
      exports: [
        PluginDiscoveryService,
        PluginExecutionService,
        StreamSessionService,
        CLAUDE_PLUGIN_OPTIONS,
      ],
      global: true,
    };
  }
}
```

---

### Phase 1: Plugin Discovery Service

#### 1.1 Plugin Types and Interfaces

**packages/claude-code-plugin-api/src/types/plugin.types.ts:**

```typescript
export interface PluginManifest {
  name: string;
  version: string;
  description?: string;
  author?: {
    name: string;
    email?: string;
  };
  homepage?: string;
  repository?: string;
  license?: string;
  keywords?: string[];
  commands?: string | string[];
  agents?: string | string[];
  skills?: string | string[];
  hooks?: string;
  mcpServers?: string;
}

export interface PluginCommand {
  name: string;
  description: string;
  filePath: string;
  content: string;
}

export interface PluginAgent {
  name: string;
  description: string;
  filePath: string;
  content: string;
  tools?: string[];
  model?: string;
}

export interface PluginSkill {
  name: string;
  description: string;
  dirPath: string;
  skillMdPath: string;
  content: string;
  allowedTools?: string[];
}

export interface DiscoveredPlugin {
  name: string;
  version: string;
  description?: string;
  rootPath: string;
  manifest: PluginManifest;
  commands: PluginCommand[];
  agents: PluginAgent[];
  skills: PluginSkill[];
}
```

#### 1.2 Plugin Discovery Service

**packages/claude-code-plugin-api/src/services/plugin-discovery.service.ts:**

```typescript
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as chokidar from 'chokidar';
import * as matter from 'gray-matter';
import {
  PluginManifest,
  PluginCommand,
  PluginAgent,
  PluginSkill,
  DiscoveredPlugin,
} from '../types/plugin.types';

@Injectable()
export class PluginDiscoveryService implements OnModuleInit {
  private readonly logger = new Logger(PluginDiscoveryService.name);
  private plugins = new Map<string, DiscoveredPlugin>();
  private watcher: chokidar.FSWatcher | null = null;

  constructor(
    private configService: ConfigService,
    private eventEmitter: EventEmitter2,
  ) {}

  async onModuleInit() {
    await this.discoverPlugins();

    if (this.configService.get('plugins.hotReload')) {
      this.startFileWatcher();
    }
  }

  async discoverPlugins(): Promise<void> {
    const pluginDir = this.configService.get('plugins.directory') || '.claude/plugins';
    const absolutePluginDir = path.resolve(process.cwd(), pluginDir);

    this.logger.log(`Discovering plugins in ${absolutePluginDir}`);

    try {
      const entries = await fs.readdir(absolutePluginDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const pluginPath = path.join(absolutePluginDir, entry.name);
          await this.loadPlugin(pluginPath);
        }
      }

      this.logger.log(`Discovered ${this.plugins.size} plugins`);
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.logger.warn(`Plugin directory not found: ${absolutePluginDir}`);
      } else {
        this.logger.error(`Failed to discover plugins: ${error.message}`);
      }
    }
  }

  private async loadPlugin(pluginPath: string): Promise<void> {
    const manifestPath = path.join(pluginPath, '.claude-plugin', 'plugin.json');

    try {
      const manifestData = await fs.readFile(manifestPath, 'utf-8');
      const manifest: PluginManifest = JSON.parse(manifestData);

      const plugin: DiscoveredPlugin = {
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        rootPath: pluginPath,
        manifest,
        commands: await this.discoverCommands(pluginPath, manifest),
        agents: await this.discoverAgents(pluginPath, manifest),
        skills: await this.discoverSkills(pluginPath, manifest),
      };

      this.plugins.set(manifest.name, plugin);
      this.logger.log(`Loaded plugin: ${manifest.name} v${manifest.version}`);
      this.logger.debug(`  Commands: ${plugin.commands.map(c => c.name).join(', ') || 'none'}`);
      this.logger.debug(`  Agents: ${plugin.agents.map(a => a.name).join(', ') || 'none'}`);
      this.logger.debug(`  Skills: ${plugin.skills.map(s => s.name).join(', ') || 'none'}`);

      this.eventEmitter.emit('plugin.loaded', plugin);
    } catch (error) {
      this.logger.warn(`Failed to load plugin at ${pluginPath}: ${error.message}`);
    }
  }

  private async discoverCommands(
    pluginPath: string,
    manifest: PluginManifest,
  ): Promise<PluginCommand[]> {
    const commands: PluginCommand[] = [];
    const commandPaths = this.normalizePaths(manifest.commands, ['./commands/']);

    for (const cmdPath of commandPaths) {
      const absolutePath = path.join(pluginPath, cmdPath);
      const mdFiles = await this.findMarkdownFiles(absolutePath);

      for (const mdFile of mdFiles) {
        const content = await fs.readFile(mdFile, 'utf-8');
        const { data, content: body } = matter(content);

        commands.push({
          name: path.basename(mdFile, '.md'),
          description: data.description || '',
          filePath: mdFile,
          content: body.trim(),
        });
      }
    }

    return commands;
  }

  private async discoverAgents(
    pluginPath: string,
    manifest: PluginManifest,
  ): Promise<PluginAgent[]> {
    const agents: PluginAgent[] = [];
    const agentPaths = this.normalizePaths(manifest.agents, ['./agents/']);

    for (const agentPath of agentPaths) {
      const absolutePath = path.join(pluginPath, agentPath);
      const mdFiles = await this.findMarkdownFiles(absolutePath);

      for (const mdFile of mdFiles) {
        const content = await fs.readFile(mdFile, 'utf-8');
        const { data, content: body } = matter(content);

        agents.push({
          name: data.name || path.basename(mdFile, '.md'),
          description: data.description || '',
          filePath: mdFile,
          content: body.trim(),
          tools: data.tools?.split(',').map((t: string) => t.trim()),
          model: data.model,
        });
      }
    }

    return agents;
  }

  private async discoverSkills(
    pluginPath: string,
    manifest: PluginManifest,
  ): Promise<PluginSkill[]> {
    const skills: PluginSkill[] = [];
    const skillPaths = this.normalizePaths(manifest.skills, ['./skills/']);

    for (const skillPath of skillPaths) {
      const absolutePath = path.join(pluginPath, skillPath);

      try {
        const entries = await fs.readdir(absolutePath, { withFileTypes: true });

        for (const entry of entries) {
          if (entry.isDirectory()) {
            const skillMdPath = path.join(absolutePath, entry.name, 'SKILL.md');

            try {
              const content = await fs.readFile(skillMdPath, 'utf-8');
              const { data, content: body } = matter(content);

              skills.push({
                name: data.name || entry.name,
                description: data.description || '',
                dirPath: path.join(absolutePath, entry.name),
                skillMdPath,
                content: body.trim(),
                allowedTools: data['allowed-tools']?.split(',').map((t: string) => t.trim()),
              });
            } catch {
              // No SKILL.md in this directory, skip
            }
          }
        }
      } catch {
        // Directory doesn't exist, skip
      }
    }

    return skills;
  }

  private normalizePaths(
    configPaths: string | string[] | undefined,
    defaults: string[],
  ): string[] {
    if (!configPaths) return defaults;
    return Array.isArray(configPaths) ? configPaths : [configPaths];
  }

  private async findMarkdownFiles(dirPath: string): Promise<string[]> {
    const files: string[] = [];

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.md')) {
          files.push(path.join(dirPath, entry.name));
        }
      }
    } catch {
      // Directory doesn't exist
    }

    return files;
  }

  private startFileWatcher(): void {
    const pluginDir = this.configService.get('plugins.directory') || '.claude/plugins';

    this.watcher = chokidar.watch(pluginDir, {
      persistent: true,
      ignoreInitial: true,
      depth: 3,
    });

    this.watcher.on('change', async (filePath) => {
      this.logger.debug(`Plugin file changed: ${filePath}`);
      await this.discoverPlugins();
      this.eventEmitter.emit('plugins.reloaded');
    });

    this.watcher.on('add', async (filePath) => {
      this.logger.debug(`Plugin file added: ${filePath}`);
      await this.discoverPlugins();
      this.eventEmitter.emit('plugins.reloaded');
    });

    this.logger.log('Plugin hot reload enabled');
  }

  // Public API

  getPlugin(name: string): DiscoveredPlugin | undefined {
    return this.plugins.get(name);
  }

  getAllPlugins(): DiscoveredPlugin[] {
    return Array.from(this.plugins.values());
  }

  getCommand(pluginName: string, commandName: string): PluginCommand | undefined {
    const plugin = this.plugins.get(pluginName);
    return plugin?.commands.find((c) => c.name === commandName);
  }

  getAgent(pluginName: string, agentName: string): PluginAgent | undefined {
    const plugin = this.plugins.get(pluginName);
    return plugin?.agents.find((a) => a.name === agentName);
  }

  getSkill(pluginName: string, skillName: string): PluginSkill | undefined {
    const plugin = this.plugins.get(pluginName);
    return plugin?.skills.find((s) => s.name === skillName);
  }
}
```

---

### Phase 2: Plugin Execution Service

#### 2.1 Execution Service

**packages/claude-code-plugin-api/src/services/plugin-execution.service.ts:**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { query, type SDKMessage } from '@anthropic-ai/claude-code';
import { Observable } from 'rxjs';
import { PluginDiscoveryService } from './plugin-discovery.service';
import { PluginCommand, PluginAgent, PluginSkill } from '../types/plugin.types';

export interface AttachmentSource {
  type: 'base64' | 'url' | 'file';
  data?: string;
  url?: string;
  /** Anthropic file ID from upload (when type is 'file') */
  fileId?: string;
}

export interface Attachment {
  type: 'image' | 'document' | 'text';
  mediaType: string;
  source: AttachmentSource;
  filename?: string;
}

export interface ExecutionOptions {
  arguments?: string;
  context?: Record<string, any>;
  attachments?: Attachment[];
  maxTurns?: number;
  maxBudgetUsd?: number;
  cwd?: string;
}

export interface ExecutionResult {
  success: boolean;
  result?: string;
  error?: string;
  cost?: number;
  turns?: number;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

@Injectable()
export class PluginExecutionService {
  private readonly logger = new Logger(PluginExecutionService.name);

  constructor(
    private configService: ConfigService,
    private pluginDiscovery: PluginDiscoveryService,
  ) {}

  /**
   * Execute a plugin command
   */
  async executeCommand(
    pluginName: string,
    commandName: string,
    options: ExecutionOptions = {},
  ): Promise<ExecutionResult> {
    const command = this.pluginDiscovery.getCommand(pluginName, commandName);

    if (!command) {
      return {
        success: false,
        error: `Command '${commandName}' not found in plugin '${pluginName}'`,
      };
    }

    const prompt = this.buildCommandPrompt(command, options);

    return this.execute(prompt, {
      systemPrompt: command.content,
      ...options,
    });
  }

  /**
   * Execute a plugin agent
   */
  async executeAgent(
    pluginName: string,
    agentName: string,
    options: ExecutionOptions = {},
  ): Promise<ExecutionResult> {
    const agent = this.pluginDiscovery.getAgent(pluginName, agentName);

    if (!agent) {
      return {
        success: false,
        error: `Agent '${agentName}' not found in plugin '${pluginName}'`,
      };
    }

    const prompt = options.arguments || 'Execute the agent task';

    return this.execute(prompt, {
      systemPrompt: agent.content,
      allowedTools: agent.tools,
      ...options,
    });
  }

  /**
   * Stream agent execution via Observable
   */
  streamAgent(
    pluginName: string,
    agentName: string,
    options: ExecutionOptions = {},
  ): Observable<SDKMessage> {
    const agent = this.pluginDiscovery.getAgent(pluginName, agentName);

    if (!agent) {
      return new Observable((subscriber) => {
        subscriber.error(new Error(`Agent '${agentName}' not found in plugin '${pluginName}'`));
      });
    }

    const prompt = options.arguments || 'Execute the agent task';

    return this.stream(prompt, {
      systemPrompt: agent.content,
      allowedTools: agent.tools,
      ...options,
    });
  }

  /**
   * Execute a plugin skill
   */
  async executeSkill(
    pluginName: string,
    skillName: string,
    options: ExecutionOptions = {},
  ): Promise<ExecutionResult> {
    const skill = this.pluginDiscovery.getSkill(pluginName, skillName);

    if (!skill) {
      return {
        success: false,
        error: `Skill '${skillName}' not found in plugin '${pluginName}'`,
      };
    }

    const prompt = options.arguments || 'Execute the skill';

    return this.execute(prompt, {
      systemPrompt: skill.content,
      allowedTools: skill.allowedTools,
      ...options,
    });
  }

  private async execute(
    prompt: string,
    options: {
      systemPrompt?: string;
      allowedTools?: string[];
      maxTurns?: number;
      maxBudgetUsd?: number;
      cwd?: string;
    },
  ): Promise<ExecutionResult> {
    const queryOptions = this.buildQueryOptions(options);

    try {
      let finalResult: ExecutionResult = { success: false };

      for await (const message of query({
        prompt,
        options: queryOptions,
      })) {
        if (message.type === 'result') {
          finalResult = {
            success: !message.is_error,
            result: message.result,
            cost: message.total_cost_usd,
            turns: message.num_turns,
            usage: {
              inputTokens: message.usage?.input_tokens || 0,
              outputTokens: message.usage?.output_tokens || 0,
            },
          };
        }
      }

      return finalResult;
    } catch (error) {
      this.logger.error(`Execution failed: ${error.message}`, error.stack);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  private stream(
    prompt: string,
    options: {
      systemPrompt?: string;
      allowedTools?: string[];
      maxTurns?: number;
      maxBudgetUsd?: number;
      cwd?: string;
    },
  ): Observable<SDKMessage> {
    const queryOptions = this.buildQueryOptions(options);

    return new Observable((subscriber) => {
      (async () => {
        try {
          for await (const message of query({
            prompt,
            options: queryOptions,
          })) {
            subscriber.next(message);

            if (message.type === 'result') {
              subscriber.complete();
            }
          }
        } catch (error) {
          this.logger.error(`Stream failed: ${error.message}`, error.stack);
          subscriber.error(error);
        }
      })();
    });
  }

  private buildQueryOptions(options: {
    systemPrompt?: string;
    allowedTools?: string[];
    maxTurns?: number;
    maxBudgetUsd?: number;
    cwd?: string;
  }) {
    return {
      allowedTools: options.allowedTools || ['Read', 'Glob', 'Grep'],
      maxTurns: options.maxTurns || this.configService.get('claude.maxTurns') || 50,
      maxBudgetUsd: options.maxBudgetUsd || this.configService.get('claude.maxBudgetUsd') || 10,
      permissionMode: 'default' as const,
      cwd: options.cwd || process.cwd(),
      ...(options.systemPrompt && {
        systemPrompt: {
          type: 'custom' as const,
          content: options.systemPrompt,
        },
      }),
    };
  }

  private buildCommandPrompt(command: PluginCommand, options: ExecutionOptions): string {
    let prompt = `Execute the following command: ${command.name}`;

    if (options.arguments) {
      prompt += `\n\nArguments: ${options.arguments}`;
    }

    if (options.context) {
      prompt += `\n\nContext: ${JSON.stringify(options.context, null, 2)}`;
    }

    return prompt;
  }
}
```

---

### Phase 3: REST API Controller

#### 3.1 Plugin Gateway Controller

**packages/claude-code-plugin-api/src/controllers/plugin.controller.ts:**

```typescript
import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  Res,
  Sse,
  Logger,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { Response } from 'express';
import { Observable, map, catchError, of } from 'rxjs';
import { ApiTags, ApiOperation, ApiParam, ApiBody, ApiResponse } from '@nestjs/swagger';
import { PluginDiscoveryService } from '../services/plugin-discovery.service';
import { PluginExecutionService, ExecutionOptions } from '../services/plugin-execution.service';
import { StreamSessionService } from '../services/stream-session.service';

// Attachment types for multimodal inputs
interface AttachmentSource {
  type: 'base64' | 'url' | 'file';
  /** Base64-encoded content (when type is 'base64') */
  data?: string;
  /** URL to fetch content from (when type is 'url') */
  url?: string;
  /** Anthropic file ID from upload (when type is 'file') */
  fileId?: string;
}

interface Attachment {
  /**
   * Content type matching Anthropic API types:
   * - 'image' for images (jpeg, png, gif, webp)
   * - 'document' for PDFs
   * - 'text' for plain text files
   */
  type: 'image' | 'document' | 'text';

  /** MIME type (e.g., 'image/png', 'application/pdf', 'text/plain') */
  mediaType: string;

  /** How the content is provided */
  source: AttachmentSource;

  /** Optional filename for context */
  filename?: string;
}

// DTOs
class ExecuteCommandDto {
  arguments?: string;
  context?: Record<string, any>;
  /** File attachments (images, PDFs, text files) */
  attachments?: Attachment[];
  maxTurns?: number;
  maxBudgetUsd?: number;
  /**
   * When true, returns the agent's output directly without wrapper.
   * Content-Type is auto-detected: JSON if parseable, otherwise text/plain.
   */
  rawResponse?: boolean;
}

class ExecuteAgentDto {
  prompt: string;
  /** File attachments (images, PDFs, text files) */
  attachments?: Attachment[];
  maxTurns?: number;
  maxBudgetUsd?: number;
  /**
   * When true, returns the agent's output directly without wrapper.
   * Content-Type is auto-detected: JSON if parseable, otherwise text/plain.
   */
  rawResponse?: boolean;
}

class CreateStreamDto {
  pluginName: string;
  agentName: string;
  prompt: string;
  /** File attachments (images, PDFs, text files) */
  attachments?: Attachment[];
  maxTurns?: number;
  maxBudgetUsd?: number;
}

interface SseMessage {
  data: {
    type: string;
    content?: string;
    error?: string;
    result?: any;
    timestamp?: number;
  };
  id?: string;
}

@ApiTags('plugins')
@Controller('v1/plugins')
export class PluginController {
  private readonly logger = new Logger(PluginController.name);

  constructor(
    private readonly pluginDiscovery: PluginDiscoveryService,
    private readonly pluginExecution: PluginExecutionService,
    private readonly streamSession: StreamSessionService,
  ) {}

  /**
   * List all discovered plugins
   */
  @Get()
  @ApiOperation({ summary: 'List all discovered plugins' })
  @ApiResponse({ status: 200, description: 'List of plugins with their capabilities' })
  listPlugins() {
    const plugins = this.pluginDiscovery.getAllPlugins();

    return {
      plugins: plugins.map((p) => ({
        name: p.name,
        version: p.version,
        description: p.description,
        commands: p.commands.map((c) => ({ name: c.name, description: c.description })),
        agents: p.agents.map((a) => ({ name: a.name, description: a.description })),
        skills: p.skills.map((s) => ({ name: s.name, description: s.description })),
      })),
      count: plugins.length,
    };
  }

  /**
   * Get plugin details
   */
  @Get(':pluginName')
  @ApiOperation({ summary: 'Get plugin details' })
  @ApiParam({ name: 'pluginName', description: 'Plugin name' })
  @ApiResponse({ status: 200, description: 'Plugin details' })
  @ApiResponse({ status: 404, description: 'Plugin not found' })
  getPlugin(@Param('pluginName') pluginName: string) {
    const plugin = this.pluginDiscovery.getPlugin(pluginName);

    if (!plugin) {
      throw new NotFoundException(`Plugin '${pluginName}' not found`);
    }

    return {
      name: plugin.name,
      version: plugin.version,
      description: plugin.description,
      commands: plugin.commands.map((c) => ({
        name: c.name,
        description: c.description,
        endpoint: `/v1/plugins/${plugin.name}/commands/${c.name}`,
      })),
      agents: plugin.agents.map((a) => ({
        name: a.name,
        description: a.description,
        tools: a.tools,
        model: a.model,
        endpoint: `/v1/plugins/${plugin.name}/agents/${a.name}`,
        streamEndpoint: `/v1/plugins/${plugin.name}/agents/${a.name}/stream`,
      })),
      skills: plugin.skills.map((s) => ({
        name: s.name,
        description: s.description,
        allowedTools: s.allowedTools,
        endpoint: `/v1/plugins/${plugin.name}/skills/${s.name}`,
      })),
    };
  }

  /**
   * Execute a plugin command
   *
   * By default, returns a wrapped response with metadata (success, result, cost, turns, usage).
   * When `rawResponse: true`, returns the command's output directly with auto-detected Content-Type.
   */
  @Post(':pluginName/commands/:commandName')
  @ApiOperation({ summary: 'Execute a plugin command' })
  @ApiParam({ name: 'pluginName', description: 'Plugin name' })
  @ApiParam({ name: 'commandName', description: 'Command name' })
  @ApiBody({ type: ExecuteCommandDto })
  async executeCommand(
    @Param('pluginName') pluginName: string,
    @Param('commandName') commandName: string,
    @Body() dto: ExecuteCommandDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.logger.log(`Executing command: ${pluginName}/${commandName}`);

    const result = await this.pluginExecution.executeCommand(pluginName, commandName, {
      arguments: dto.arguments,
      context: dto.context,
      maxTurns: dto.maxTurns,
      maxBudgetUsd: dto.maxBudgetUsd,
    });

    if (!result.success && result.error?.includes('not found')) {
      throw new NotFoundException(result.error);
    }

    if (!result.success) {
      throw new HttpException(
        { success: false, error: result.error },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // Handle raw response mode with auto-detect Content-Type
    if (dto.rawResponse && result.result) {
      try {
        // Try to parse as JSON
        const parsed = JSON.parse(result.result);
        res.setHeader('Content-Type', 'application/json');
        return parsed;
      } catch {
        // Not valid JSON, return as plain text
        res.setHeader('Content-Type', 'text/plain');
        return result.result;
      }
    }

    // Default: return wrapped response
    return result;
  }

  /**
   * Execute a plugin agent (non-streaming)
   *
   * By default, returns a wrapped response with metadata (success, result, cost, turns, usage).
   * When `rawResponse: true`, returns the agent's output directly with auto-detected Content-Type.
   */
  @Post(':pluginName/agents/:agentName')
  @ApiOperation({ summary: 'Execute a plugin agent' })
  @ApiParam({ name: 'pluginName', description: 'Plugin name' })
  @ApiParam({ name: 'agentName', description: 'Agent name' })
  @ApiBody({ type: ExecuteAgentDto })
  async executeAgent(
    @Param('pluginName') pluginName: string,
    @Param('agentName') agentName: string,
    @Body() dto: ExecuteAgentDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.logger.log(`Executing agent: ${pluginName}/${agentName}`);

    const result = await this.pluginExecution.executeAgent(pluginName, agentName, {
      arguments: dto.prompt,
      maxTurns: dto.maxTurns,
      maxBudgetUsd: dto.maxBudgetUsd,
    });

    if (!result.success && result.error?.includes('not found')) {
      throw new NotFoundException(result.error);
    }

    if (!result.success) {
      throw new HttpException(
        { success: false, error: result.error },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // Handle raw response mode with auto-detect Content-Type
    if (dto.rawResponse && result.result) {
      try {
        // Try to parse as JSON
        const parsed = JSON.parse(result.result);
        res.setHeader('Content-Type', 'application/json');
        return parsed;
      } catch {
        // Not valid JSON, return as plain text
        res.setHeader('Content-Type', 'text/plain');
        return result.result;
      }
    }

    // Default: return wrapped response
    return result;
  }

  /**
   * Create a stream session for agent execution
   */
  @Post('stream')
  @ApiOperation({ summary: 'Create a stream session for agent execution' })
  @ApiBody({ type: CreateStreamDto })
  async createStreamSession(@Body() dto: CreateStreamDto) {
    const agent = this.pluginDiscovery.getAgent(dto.pluginName, dto.agentName);

    if (!agent) {
      throw new NotFoundException(`Agent '${dto.agentName}' not found in plugin '${dto.pluginName}'`);
    }

    const sessionId = await this.streamSession.createSession({
      pluginName: dto.pluginName,
      agentName: dto.agentName,
      prompt: dto.prompt,
      maxTurns: dto.maxTurns,
      maxBudgetUsd: dto.maxBudgetUsd,
    });

    return {
      sessionId,
      streamUrl: `/v1/stream/${sessionId}`,
      expiresIn: 300, // 5 minutes
    };
  }

  /**
   * Execute a plugin skill
   *
   * By default, returns a wrapped response with metadata (success, result, cost, turns, usage).
   * When `rawResponse: true`, returns the skill's output directly with auto-detected Content-Type.
   */
  @Post(':pluginName/skills/:skillName')
  @ApiOperation({ summary: 'Execute a plugin skill' })
  @ApiParam({ name: 'pluginName', description: 'Plugin name' })
  @ApiParam({ name: 'skillName', description: 'Skill name' })
  @ApiBody({ type: ExecuteCommandDto })
  async executeSkill(
    @Param('pluginName') pluginName: string,
    @Param('skillName') skillName: string,
    @Body() dto: ExecuteCommandDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.logger.log(`Executing skill: ${pluginName}/${skillName}`);

    const result = await this.pluginExecution.executeSkill(pluginName, skillName, {
      arguments: dto.arguments,
      context: dto.context,
      maxTurns: dto.maxTurns,
      maxBudgetUsd: dto.maxBudgetUsd,
    });

    if (!result.success && result.error?.includes('not found')) {
      throw new NotFoundException(result.error);
    }

    if (!result.success) {
      throw new HttpException(
        { success: false, error: result.error },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // Handle raw response mode with auto-detect Content-Type
    if (dto.rawResponse && result.result) {
      try {
        // Try to parse as JSON
        const parsed = JSON.parse(result.result);
        res.setHeader('Content-Type', 'application/json');
        return parsed;
      } catch {
        // Not valid JSON, return as plain text
        res.setHeader('Content-Type', 'text/plain');
        return result.result;
      }
    }

    // Default: return wrapped response
    return result;
  }
}

/**
 * Separate controller for SSE streaming to avoid mixing with REST endpoints
 */
@ApiTags('streaming')
@Controller('v1/stream')
export class StreamController {
  private readonly logger = new Logger(StreamController.name);

  constructor(
    private readonly pluginExecution: PluginExecutionService,
    private readonly streamSession: StreamSessionService,
  ) {}

  /**
   * Consume a stream session via SSE
   */
  @Sse(':sessionId')
  @ApiOperation({ summary: 'Stream agent responses via SSE' })
  @ApiParam({ name: 'sessionId', description: 'Stream session ID from POST /v1/plugins/stream' })
  consumeStream(@Param('sessionId') sessionId: string): Observable<SseMessage> {
    const session = this.streamSession.getSession(sessionId);

    if (!session) {
      return of({
        data: { type: 'error', error: 'Session not found or expired' },
      });
    }

    // Mark session as consumed
    this.streamSession.markConsumed(sessionId);

    this.logger.log(`Streaming agent: ${session.pluginName}/${session.agentName}`);

    return this.pluginExecution.streamAgent(session.pluginName, session.agentName, {
      arguments: session.prompt,
      maxTurns: session.maxTurns,
      maxBudgetUsd: session.maxBudgetUsd,
    }).pipe(
      map((message) => {
        if (message.type === 'assistant') {
          const text = message.message.content
            .filter((c: any) => c.type === 'text')
            .map((c: any) => c.text)
            .join('');

          return {
            data: {
              type: 'delta',
              content: text,
              timestamp: Date.now(),
            },
          };
        }

        if (message.type === 'result') {
          return {
            data: {
              type: 'complete',
              result: {
                success: !message.is_error,
                result: message.result,
                cost: message.total_cost_usd,
                turns: message.num_turns,
              },
              timestamp: Date.now(),
            },
          };
        }

        return {
          data: {
            type: message.type,
            timestamp: Date.now(),
          },
        };
      }),
      catchError((error) => {
        this.logger.error(`Stream error: ${error.message}`);
        return of({
          data: { type: 'error', error: error.message, timestamp: Date.now() },
        });
      }),
    );
  }
}
```

#### 3.2 Stream Session Service

**packages/claude-code-plugin-api/src/services/stream-session.service.ts:**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';

export interface StreamSession {
  id: string;
  pluginName: string;
  agentName: string;
  prompt: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
  createdAt: number;
  consumed: boolean;
}

@Injectable()
export class StreamSessionService {
  private readonly logger = new Logger(StreamSessionService.name);
  private sessions = new Map<string, StreamSession>();
  private readonly SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor() {
    // Cleanup expired sessions every minute
    setInterval(() => this.cleanupExpiredSessions(), 60 * 1000);
  }

  async createSession(params: {
    pluginName: string;
    agentName: string;
    prompt: string;
    maxTurns?: number;
    maxBudgetUsd?: number;
  }): Promise<string> {
    const id = uuidv4();

    const session: StreamSession = {
      id,
      ...params,
      createdAt: Date.now(),
      consumed: false,
    };

    this.sessions.set(id, session);
    this.logger.debug(`Created stream session: ${id}`);

    return id;
  }

  getSession(id: string): StreamSession | undefined {
    const session = this.sessions.get(id);

    if (!session) {
      return undefined;
    }

    // Check if expired
    if (Date.now() - session.createdAt > this.SESSION_TTL_MS) {
      this.sessions.delete(id);
      return undefined;
    }

    // Check if already consumed
    if (session.consumed) {
      return undefined;
    }

    return session;
  }

  markConsumed(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.consumed = true;
    }
  }

  private cleanupExpiredSessions(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, session] of this.sessions.entries()) {
      if (now - session.createdAt > this.SESSION_TTL_MS) {
        this.sessions.delete(id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.debug(`Cleaned up ${cleaned} expired stream sessions`);
    }
  }
}
```

#### 3.3 Files Controller (Anthropic Files API Proxy)

**packages/claude-code-plugin-api/src/controllers/files.controller.ts:**

```typescript
import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  UseInterceptors,
  UploadedFile,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes, ApiBody, ApiResponse } from '@nestjs/swagger';
import Anthropic from '@anthropic-ai/sdk';

// Response types matching Anthropic API
interface FileObject {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  expires_at: string | null;
  purpose: string;
}

interface FileListResponse {
  data: FileObject[];
  has_more: boolean;
}

@ApiTags('files')
@Controller('v1/files')
export class FilesController {
  private readonly logger = new Logger(FilesController.name);
  private readonly anthropic: Anthropic;

  constructor() {
    // Uses ANTHROPIC_API_KEY from environment
    this.anthropic = new Anthropic();
  }

  /**
   * Upload a file to Anthropic's Files API
   * Returns the file object which can be referenced in attachments
   */
  @Post()
  @ApiOperation({ summary: 'Upload a file to Anthropic Files API' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        purpose: { type: 'string', enum: ['vision', 'assistants'], default: 'vision' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'File uploaded successfully' })
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body('purpose') purpose: string = 'vision',
  ): Promise<FileObject> {
    if (!file) {
      throw new HttpException('No file provided', HttpStatus.BAD_REQUEST);
    }

    this.logger.log(`Uploading file: ${file.originalname} (${file.size} bytes)`);

    try {
      const response = await this.anthropic.files.create({
        file: new Blob([file.buffer], { type: file.mimetype }),
        purpose: purpose as 'vision' | 'assistants',
      });

      this.logger.log(`File uploaded: ${response.id}`);

      return {
        id: response.id,
        filename: response.filename,
        mime_type: response.mime_type,
        size_bytes: response.size_bytes,
        created_at: response.created_at,
        expires_at: response.expires_at,
        purpose: response.purpose,
      };
    } catch (error) {
      this.logger.error(`File upload failed: ${error.message}`);
      throw new HttpException(
        { error: 'File upload failed', details: error.message },
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  /**
   * List all uploaded files
   */
  @Get()
  @ApiOperation({ summary: 'List all uploaded files' })
  @ApiResponse({ status: 200, description: 'List of files' })
  async listFiles(): Promise<FileListResponse> {
    try {
      const response = await this.anthropic.files.list();

      return {
        data: response.data.map((f) => ({
          id: f.id,
          filename: f.filename,
          mime_type: f.mime_type,
          size_bytes: f.size_bytes,
          created_at: f.created_at,
          expires_at: f.expires_at,
          purpose: f.purpose,
        })),
        has_more: response.has_more,
      };
    } catch (error) {
      this.logger.error(`List files failed: ${error.message}`);
      throw new HttpException(
        { error: 'Failed to list files', details: error.message },
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  /**
   * Get a specific file's metadata
   */
  @Get(':fileId')
  @ApiOperation({ summary: 'Get file metadata' })
  @ApiResponse({ status: 200, description: 'File metadata' })
  @ApiResponse({ status: 404, description: 'File not found' })
  async getFile(@Param('fileId') fileId: string): Promise<FileObject> {
    try {
      const response = await this.anthropic.files.retrieve(fileId);

      return {
        id: response.id,
        filename: response.filename,
        mime_type: response.mime_type,
        size_bytes: response.size_bytes,
        created_at: response.created_at,
        expires_at: response.expires_at,
        purpose: response.purpose,
      };
    } catch (error) {
      if (error.status === 404) {
        throw new HttpException('File not found', HttpStatus.NOT_FOUND);
      }
      this.logger.error(`Get file failed: ${error.message}`);
      throw new HttpException(
        { error: 'Failed to get file', details: error.message },
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  /**
   * Delete a file
   */
  @Delete(':fileId')
  @ApiOperation({ summary: 'Delete a file' })
  @ApiResponse({ status: 200, description: 'File deleted' })
  @ApiResponse({ status: 404, description: 'File not found' })
  async deleteFile(@Param('fileId') fileId: string): Promise<{ id: string; deleted: boolean }> {
    try {
      const response = await this.anthropic.files.delete(fileId);

      this.logger.log(`File deleted: ${fileId}`);

      return {
        id: response.id,
        deleted: response.deleted,
      };
    } catch (error) {
      if (error.status === 404) {
        throw new HttpException('File not found', HttpStatus.NOT_FOUND);
      }
      this.logger.error(`Delete file failed: ${error.message}`);
      throw new HttpException(
        { error: 'Failed to delete file', details: error.message },
        HttpStatus.BAD_GATEWAY,
      );
    }
  }
}
```

---

### Phase 3.5: Authentication System

#### 3.5.1 Authentication Types and Interfaces

**packages/claude-code-plugin-api/src/auth/auth.types.ts:**

```typescript
export interface AuthUser {
  username: string;
  [key: string]: any;
}

export interface AuthProvider {
  /**
   * Validate credentials and return user if valid
   * @returns AuthUser if valid, null if invalid
   */
  validate(username: string, password: string): Promise<AuthUser | null>;
}

export interface AuthModuleOptions {
  /**
   * Disable authentication entirely
   * @default false
   */
  disabled?: boolean;

  /**
   * Custom auth provider (overrides default YAML file provider)
   */
  provider?: AuthProvider;

  /**
   * Path to auth.yml file (only used with default provider)
   * @default 'auth.yml'
   */
  authFilePath?: string;

  /**
   * Paths to exclude from authentication (supports wildcards)
   * @default ['/health', '/api/docs*']
   */
  excludePaths?: string[];
}
```

#### 3.5.2 YAML File Auth Provider (Default)

**packages/claude-code-plugin-api/src/auth/yaml-auth.provider.ts:**

```typescript
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import * as crypto from 'crypto';
import { AuthProvider, AuthUser } from './auth.types';

interface AuthYamlConfig {
  users: Array<{
    username: string;
    password: string; // Plain text or bcrypt hash (prefix with $2b$)
  }>;
}

@Injectable()
export class YamlAuthProvider implements AuthProvider, OnModuleInit {
  private readonly logger = new Logger(YamlAuthProvider.name);
  private users = new Map<string, string>();
  private authFilePath: string;

  constructor(authFilePath: string = 'auth.yml') {
    this.authFilePath = path.resolve(process.cwd(), authFilePath);
  }

  async onModuleInit() {
    await this.loadUsers();
  }

  private async loadUsers(): Promise<void> {
    try {
      const content = await fs.readFile(this.authFilePath, 'utf-8');
      const config = yaml.load(content) as AuthYamlConfig;

      if (!config?.users || !Array.isArray(config.users)) {
        this.logger.warn(`No users found in ${this.authFilePath}`);
        return;
      }

      for (const user of config.users) {
        if (user.username && user.password) {
          this.users.set(user.username, user.password);
        }
      }

      this.logger.log(`Loaded ${this.users.size} users from ${this.authFilePath}`);
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.logger.warn(`Auth file not found: ${this.authFilePath}. API is UNPROTECTED!`);
        this.logger.warn(`Create ${this.authFilePath} or disable auth with { auth: { disabled: true } }`);
      } else {
        this.logger.error(`Failed to load auth file: ${error.message}`);
      }
    }
  }

  async validate(username: string, password: string): Promise<AuthUser | null> {
    const storedPassword = this.users.get(username);

    if (!storedPassword) {
      return null;
    }

    // Check if it's a bcrypt hash (starts with $2b$, $2a$, or $2y$)
    if (storedPassword.startsWith('$2')) {
      // For bcrypt, you'd use bcrypt.compare() - simplified here
      // In production, add bcrypt as dependency
      const bcrypt = await import('bcrypt').catch(() => null);
      if (bcrypt) {
        const isValid = await bcrypt.compare(password, storedPassword);
        return isValid ? { username } : null;
      }
      this.logger.warn('bcrypt not installed, cannot verify hashed passwords');
      return null;
    }

    // Plain text comparison (for development only)
    const isValid = crypto.timingSafeEqual(
      Buffer.from(password),
      Buffer.from(storedPassword),
    );

    return isValid ? { username } : null;
  }
}
```

#### 3.5.3 Auth Guard

**packages/claude-code-plugin-api/src/auth/auth.guard.ts:**

```typescript
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Inject,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthProvider, AuthModuleOptions } from './auth.types';

const AUTH_OPTIONS = 'AUTH_OPTIONS';
const AUTH_PROVIDER = 'AUTH_PROVIDER';

@Injectable()
export class BasicAuthGuard implements CanActivate {
  private readonly logger = new Logger(BasicAuthGuard.name);

  constructor(
    @Inject(AUTH_OPTIONS) private readonly options: AuthModuleOptions,
    @Inject(AUTH_PROVIDER) private readonly provider: AuthProvider,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Auth disabled - allow all requests
    if (this.options.disabled) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const path = request.path;

    // Check excluded paths
    if (this.isExcludedPath(path)) {
      return true;
    }

    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Basic ')) {
      throw new UnauthorizedException('Missing or invalid Authorization header');
    }

    const base64Credentials = authHeader.slice(6);
    const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
    const [username, password] = credentials.split(':');

    if (!username || !password) {
      throw new UnauthorizedException('Invalid credentials format');
    }

    const user = await this.provider.validate(username, password);

    if (!user) {
      this.logger.warn(`Failed auth attempt for user: ${username}`);
      throw new UnauthorizedException('Invalid credentials');
    }

    // Attach user to request for downstream use
    (request as any).user = user;
    return true;
  }

  private isExcludedPath(path: string): boolean {
    const excludePaths = this.options.excludePaths || ['/health', '/api/docs*'];

    return excludePaths.some((pattern) => {
      if (pattern.endsWith('*')) {
        return path.startsWith(pattern.slice(0, -1));
      }
      return path === pattern;
    });
  }
}
```

#### 3.5.4 Update Module Options

**Update packages/claude-code-plugin-api/src/claude-plugin.module.ts:**

Add to `ClaudePluginModuleOptions`:

```typescript
export interface ClaudePluginModuleOptions {
  // ... existing options ...

  /**
   * Authentication configuration
   * Set to { disabled: true } to disable built-in auth
   */
  auth?: AuthModuleOptions;
}
```

Add to the module's `forRoot()` method:

```typescript
import { APP_GUARD } from '@nestjs/core';
import { BasicAuthGuard } from './auth/auth.guard';
import { YamlAuthProvider } from './auth/yaml-auth.provider';
import { AuthModuleOptions } from './auth/auth.types';

const AUTH_OPTIONS = 'AUTH_OPTIONS';
const AUTH_PROVIDER = 'AUTH_PROVIDER';

// Inside forRoot():
const authOptions: AuthModuleOptions = {
  disabled: options.auth?.disabled ?? false,
  excludePaths: options.auth?.excludePaths ?? ['/health', '/api/docs*'],
  authFilePath: options.auth?.authFilePath ?? 'auth.yml',
};

const authProviders: Provider[] = authOptions.disabled ? [] : [
  {
    provide: AUTH_OPTIONS,
    useValue: authOptions,
  },
  {
    provide: AUTH_PROVIDER,
    useFactory: () => {
      if (options.auth?.provider) {
        return options.auth.provider;
      }
      return new YamlAuthProvider(authOptions.authFilePath);
    },
  },
  {
    provide: APP_GUARD,
    useClass: BasicAuthGuard,
  },
];

return {
  module: ClaudePluginModule,
  // ... rest of config
  providers: [
    ...authProviders,
    // ... other providers
  ],
};
```

#### 3.5.5 Public Exports

**Update packages/claude-code-plugin-api/src/index.ts:**

```typescript
// Auth exports
export type { AuthUser, AuthProvider, AuthModuleOptions } from './auth/auth.types';
export { YamlAuthProvider } from './auth/yaml-auth.provider';
export { BasicAuthGuard } from './auth/auth.guard';
```

#### 3.5.6 Example Auth Configuration

**examples/basic-server/example.auth.yml:**

```yaml
# Copy this file to auth.yml and customize
# WARNING: Do not commit auth.yml with real credentials!

users:
  # Plain text password (development only)
  - username: admin
    password: changeme

  # Bcrypt hashed password (recommended for production)
  # Generate with: npx bcrypt-cli hash "your-password"
  # - username: api-user
  #   password: $2b$10$abcdefghijklmnopqrstuv...

  # Multiple users supported
  # - username: readonly
  #   password: readonly-pass
```

**examples/basic-server/.gitignore (add):**

```
auth.yml
```

#### 3.5.7 Usage Examples

**Disable auth entirely (use your own):**

```typescript
@Module({
  imports: [
    ClaudePluginModule.forRoot({
      pluginDirectory: '.claude/plugins',
      auth: { disabled: true }, // Disable built-in auth
    }),
  ],
})
export class AppModule {}
```

**Custom auth provider:**

```typescript
import { AuthProvider, AuthUser } from '@tigz/claude-code-plugin-api';

class MyDatabaseAuthProvider implements AuthProvider {
  constructor(private userService: UserService) {}

  async validate(username: string, password: string): Promise<AuthUser | null> {
    const user = await this.userService.validateCredentials(username, password);
    return user ? { username: user.email, role: user.role } : null;
  }
}

@Module({
  imports: [
    ClaudePluginModule.forRootAsync({
      imports: [UserModule],
      useFactory: (userService: UserService) => ({
        pluginDirectory: '.claude/plugins',
        auth: {
          provider: new MyDatabaseAuthProvider(userService),
        },
      }),
      inject: [UserService],
    }),
  ],
})
export class AppModule {}
```

**Custom excluded paths:**

```typescript
ClaudePluginModule.forRoot({
  pluginDirectory: '.claude/plugins',
  auth: {
    excludePaths: ['/health', '/api/docs*', '/v1/plugins'], // Add public endpoints
  },
})
```

**Calling the API with Basic Auth:**

```bash
# Using curl with Basic Auth
curl -u admin:changeme http://localhost:3000/v1/plugins

# Or with explicit header
curl -H "Authorization: Basic $(echo -n 'admin:changeme' | base64)" \
  http://localhost:3000/v1/plugins

# In JavaScript/TypeScript
fetch('http://localhost:3000/v1/plugins', {
  headers: {
    'Authorization': 'Basic ' + btoa('admin:changeme')
  }
})
```

#### 3.5.8 Package Dependencies

Add to **packages/claude-code-plugin-api/package.json** dependencies:

```json
{
  "dependencies": {
    "js-yaml": "^4.1.0"
  },
  "optionalDependencies": {
    "bcrypt": "^5.1.0"
  },
  "devDependencies": {
    "@types/js-yaml": "^4.0.0",
    "@types/bcrypt": "^5.0.0"
  }
}
```

---

### Phase 4: Example Consumer Project

#### 4.1 Example Package Configuration

**examples/basic-server/package.json:**

```json
{
  "name": "basic-server",
  "version": "0.1.0",
  "private": true,
  "description": "Example NestJS server using @tigz/claude-code-plugin-api",
  "scripts": {
    "build": "nest build",
    "dev": "nest start --watch",
    "start": "node dist/main",
    "start:prod": "node dist/main",
    "lint": "eslint \"{src,test}/**/*.ts\"",
    "test": "jest"
  },
  "dependencies": {
    "@tigz/claude-code-plugin-api": "workspace:*",
    "@nestjs/common": "^10.0.0",
    "@nestjs/core": "^10.0.0",
    "@nestjs/platform-express": "^10.0.0",
    "reflect-metadata": "^0.2.0",
    "rxjs": "^7.8.0"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.0.0",
    "@nestjs/schematics": "^10.0.0",
    "@types/express": "^4.17.0",
    "@types/node": "^20.0.0",
    "typescript": "^5.4.0"
  }
}
```

#### 4.2 App Module (Consumer)

**examples/basic-server/src/app.module.ts:**

```typescript
import { Module } from '@nestjs/common';
import { ClaudePluginModule } from '@tigz/claude-code-plugin-api';
import { HealthController } from './health.controller';

@Module({
  imports: [
    // Simple usage with defaults
    ClaudePluginModule.forRoot({
      pluginDirectory: '.claude/plugins',
      hotReload: process.env.NODE_ENV === 'development',
    }),

    // Or with async configuration:
    // ClaudePluginModule.forRootAsync({
    //   useFactory: () => ({
    //     pluginDirectory: process.env.PLUGINS_DIR || '.claude/plugins',
    //     hotReload: process.env.NODE_ENV === 'development',
    //     maxTurns: 100,
    //     maxBudgetUsd: 25,
    //   }),
    // }),
  ],
  controllers: [HealthController],
})
export class AppModule {}
```

#### 4.3 Main Entry Point

**examples/basic-server/src/main.ts:**

```typescript
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { Logger, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');

  app.useGlobalPipes(new ValidationPipe({ transform: true }));
  app.enableCors();

  // Swagger documentation
  const config = new DocumentBuilder()
    .setTitle('Claude Plugin API')
    .setDescription('REST API for Claude Code plugins')
    .setVersion('1.0')
    .addTag('plugins', 'Plugin discovery and execution')
    .addTag('streaming', 'SSE streaming endpoints')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port);

  logger.log(`Application running on http://localhost:${port}`);
  logger.log(`API docs available at http://localhost:${port}/api/docs`);
}
bootstrap();
```

#### 4.4 Health Controller

**examples/basic-server/src/health.controller.ts:**

```typescript
import { Controller, Get } from '@nestjs/common';
import { PluginDiscoveryService } from '@tigz/claude-code-plugin-api';

@Controller('health')
export class HealthController {
  constructor(private readonly pluginDiscovery: PluginDiscoveryService) {}

  @Get()
  check() {
    const plugins = this.pluginDiscovery.getAllPlugins();

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      plugins: {
        count: plugins.length,
        names: plugins.map((p) => p.name),
      },
    };
  }
}
```

#### 4.5 Example Plugin

**examples/basic-server/.claude/plugins/example-plugin/.claude-plugin/plugin.json:**

```json
{
  "name": "example-plugin",
  "version": "1.0.0",
  "description": "Example plugin to demonstrate the API"
}
```

**examples/basic-server/.claude/plugins/example-plugin/commands/hello.md:**

```markdown
---
description: Greet the user with a friendly message
---

You are a friendly assistant. When the user provides a name, greet them warmly.
If no name is provided, use a generic greeting.

Keep responses brief and cheerful.
```

**examples/basic-server/.claude/plugins/example-plugin/agents/code-helper.md:**

```markdown
---
name: code-helper
description: A helpful coding assistant that can read and analyze code
tools: Read, Glob, Grep
model: sonnet
---

You are a helpful coding assistant. You can:
- Read files in the project
- Search for patterns in code
- Provide explanations and suggestions

Be concise and focus on practical advice.
```

---

### Phase 5: Docker Configuration

#### 5.1 Dockerfile

**examples/basic-server/Dockerfile:**

```dockerfile
# =============================================================================
# Stage 1: Development
# =============================================================================
FROM node:20-alpine AS development

RUN apk add --no-cache libc6-compat
RUN npm install -g pnpm

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install

COPY . .

EXPOSE 3000

CMD ["pnpm", "run", "dev"]

# =============================================================================
# Stage 2: Production Build
# =============================================================================
FROM node:20-alpine AS build

RUN npm install -g pnpm

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

# =============================================================================
# Stage 3: Production
# =============================================================================
FROM node:20-alpine AS production

RUN apk add --no-cache libc6-compat

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001 -G nodejs

WORKDIR /app

RUN npm install -g pnpm
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY --from=build --chown=nestjs:nodejs /app/dist ./dist

# Create directories for Claude credentials and plugins
RUN mkdir -p /home/nestjs/.claude && \
    mkdir -p /app/.claude/plugins && \
    chown -R nestjs:nodejs /home/nestjs/.claude /app/.claude

USER nestjs

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/health || exit 1

EXPOSE 3000

CMD ["node", "dist/main"]
```

#### 5.2 Docker Compose

**examples/basic-server/docker-compose.yml:**

```yaml
version: '3.8'

services:
  api:
    build:
      context: .
      dockerfile: Dockerfile
      target: development
    container_name: claude-plugin-api
    ports:
      - "3000:3000"
    volumes:
      # Source code for hot reload
      - ./src:/app/src:ro
      # Claude credentials from host
      - ~/.claude:/root/.claude:ro
      # Plugin directory - mount your plugins here
      - ./.claude/plugins:/app/.claude/plugins:ro
    environment:
      - NODE_ENV=development
      - PORT=3000
      - PLUGINS_DIRECTORY=.claude/plugins
      - PLUGINS_HOT_RELOAD=true
      - CLAUDE_MAX_TURNS=50
      - CLAUDE_MAX_BUDGET_USD=10
    restart: unless-stopped
```

---

### Phase 6: CI/CD and Publishing

#### 6.1 GitHub Actions Workflow

**.github/workflows/publish.yml:**

```yaml
name: Publish Package

on:
  push:
    tags:
      - 'v*'

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write

    steps:
      - uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v2
        with:
          version: 9

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://npm.pkg.github.com'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install

      - name: Build library
        run: pnpm --filter @tigz/claude-code-plugin-api build

      - name: Run tests
        run: pnpm --filter @tigz/claude-code-plugin-api test

      - name: Publish to GitHub Packages
        run: pnpm --filter @tigz/claude-code-plugin-api publish --no-git-checks
        env:
          NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**.github/workflows/ci.yml:**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v2
        with:
          version: 9

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install

      - name: Build all packages
        run: pnpm build

      - name: Run tests
        run: pnpm test

      - name: Lint
        run: pnpm lint
```

#### 6.2 Publishing Workflow

To publish a new version:

```bash
# 1. Update version in packages/claude-code-plugin-api/package.json
cd packages/claude-code-plugin-api
pnpm version patch  # or minor, major

# 2. Commit and tag
git add .
git commit -m "chore: release v0.1.1"
git tag v0.1.1

# 3. Push (triggers GitHub Actions)
git push origin main --tags
```

---

## Developer Guide

### Quick Start: Using the Published Package

For users who want to consume `@tigz/claude-code-plugin-api` in their own project:

```bash
# 1. Create a new NestJS project
npx @nestjs/cli new my-claude-api
cd my-claude-api

# 2. Configure npm to use GitHub Packages for @tigz scope
echo "@tigz:registry=https://npm.pkg.github.com" >> .npmrc

# 3. Install the package (requires GITHUB_TOKEN with read:packages scope)
npm install @tigz/claude-code-plugin-api

# 4. Update app.module.ts
```

**app.module.ts:**
```typescript
import { Module } from '@nestjs/common';
import { ClaudePluginModule } from '@tigz/claude-code-plugin-api';

@Module({
  imports: [
    ClaudePluginModule.forRoot({
      pluginDirectory: '.claude/plugins',
      hotReload: true,
    }),
  ],
})
export class AppModule {}
```

```bash
# 5. Add plugins to .claude/plugins/ directory
mkdir -p .claude/plugins

# 6. Run the server
npm run start:dev

# 7. Test
curl http://localhost:3000/v1/plugins
```

---

### Installing Claude Code Plugins

```bash
# Option 1: Clone from marketplace
git clone https://github.com/example/my-plugin.git .claude/plugins/my-plugin

# Option 2: Symlink for local development
ln -s /path/to/my-plugin .claude/plugins/my-plugin
```

### Plugin Directory Structure

```
.claude/plugins/
├── my-plugin/
│   ├── .claude-plugin/
│   │   └── plugin.json
│   ├── commands/
│   │   └── hello.md
│   ├── agents/
│   │   └── helper.md
│   └── skills/
│       └── pdf-reader/
│           └── SKILL.md
└── another-plugin/
    └── ...
```

### Using Plugins via API

```bash
# List all plugins
curl http://localhost:3000/v1/plugins

# Get plugin details
curl http://localhost:3000/v1/plugins/my-plugin

# Execute a command
curl -X POST http://localhost:3000/v1/plugins/my-plugin/commands/hello \
  -H "Content-Type: application/json" \
  -d '{"arguments": "world"}'

# Execute an agent (non-streaming) - wrapped response with metadata
curl -X POST http://localhost:3000/v1/plugins/my-plugin/agents/helper \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Help me write a test"}'
# Response: { "success": true, "result": "...", "cost": 0.01, "turns": 3, "usage": {...} }

# Execute an agent with raw response (direct output, auto-detect Content-Type)
curl -X POST http://localhost:3000/v1/plugins/my-plugin/agents/json-generator \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Generate user data", "rawResponse": true}'
# Response: { "name": "Alice", "email": "alice@example.com" }
# Content-Type: application/json (auto-detected)

# Raw response with plain text output
curl -X POST http://localhost:3000/v1/plugins/my-plugin/agents/helper \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Say hello", "rawResponse": true}'
# Response: Hello! How can I help you today?
# Content-Type: text/plain (auto-detected)

# Stream an agent response
# Step 1: Create session
SESSION=$(curl -X POST http://localhost:3000/v1/plugins/stream \
  -H "Content-Type: application/json" \
  -d '{
    "pluginName": "my-plugin",
    "agentName": "helper",
    "prompt": "Write a comprehensive test suite"
  }' | jq -r '.sessionId')

# Step 2: Consume stream
curl -N http://localhost:3000/v1/stream/$SESSION
```

### Raw Response Mode

For API-to-API integrations where you want the agent's output directly (without wrapper metadata), use the `rawResponse` flag. The Content-Type is auto-detected based on the output:

| Agent Output | Detected Content-Type |
|--------------|----------------------|
| Valid JSON string | `application/json` |
| Plain text | `text/plain` |

**Use cases:**
- **API proxies**: When your API wraps Claude agents and clients expect direct JSON/text
- **Webhooks**: When the agent output should be forwarded as-is
- **Microservices**: When other services consume the raw result without needing metadata

**Default behavior** (without `rawResponse`):
```json
{
  "success": true,
  "result": "{\"name\": \"Alice\"}",
  "cost": 0.01,
  "turns": 3,
  "usage": { "inputTokens": 150, "outputTokens": 50 }
}
```

**With `rawResponse: true`** (agent returns JSON):
```json
{"name": "Alice"}
```
Content-Type: `application/json`

**With `rawResponse: true`** (agent returns plain text):
```
Hello! How can I help you today?
```
Content-Type: `text/plain`

### Multimodal Inputs (Images, PDFs, Files)

Send images, PDFs, and text files to agents using the `attachments` array. Supports both base64-encoded content and URLs.

**Supported attachment types:**

| Type | MIME Types | Use Case |
|------|------------|----------|
| `image` | `image/jpeg`, `image/png`, `image/gif`, `image/webp` | Vision analysis, image processing |
| `document` | `application/pdf` | PDF analysis, document extraction |
| `text` | `text/plain`, `text/csv`, etc. | Code files, data files, logs |

**Image analysis example:**
```bash
curl -X POST http://localhost:3000/v1/plugins/vision-plugin/agents/analyzer \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "What objects are in this image?",
    "attachments": [{
      "type": "image",
      "mediaType": "image/jpeg",
      "source": { "type": "base64", "data": "/9j/4AAQSkZJRg..." }
    }]
  }'
```

**PDF document analysis:**
```bash
curl -X POST http://localhost:3000/v1/plugins/doc-reader/agents/summarizer \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Summarize the key findings in this report",
    "attachments": [{
      "type": "document",
      "mediaType": "application/pdf",
      "source": { "type": "base64", "data": "JVBERi0xLjQK..." },
      "filename": "quarterly-report.pdf"
    }]
  }'
```

**Multiple attachments (comparing files):**
```bash
curl -X POST http://localhost:3000/v1/plugins/analyzer/agents/compare \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Compare the chart in the image with the data in the PDF",
    "attachments": [
      {
        "type": "image",
        "mediaType": "image/png",
        "source": { "type": "base64", "data": "iVBORw0KGgo..." },
        "filename": "chart.png"
      },
      {
        "type": "document",
        "mediaType": "application/pdf",
        "source": { "type": "base64", "data": "JVBERi0xLjQK..." },
        "filename": "data.pdf"
      }
    ]
  }'
```

**Using URL source (for publicly accessible files):**
```bash
curl -X POST http://localhost:3000/v1/plugins/vision-plugin/agents/analyzer \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Describe this image",
    "attachments": [{
      "type": "image",
      "mediaType": "image/png",
      "source": { "type": "url", "url": "https://example.com/image.png" }
    }]
  }'
```

### Files API (Upload Once, Use Many Times)

For files you need to reference multiple times, use the Files API to upload once and reference by ID. This is more efficient than sending base64-encoded content with each request.

**Upload a file:**
```bash
curl -X POST http://localhost:3000/v1/files \
  -F "file=@/path/to/document.pdf" \
  -F "purpose=vision"

# Response:
# {
#   "id": "file-abc123",
#   "filename": "document.pdf",
#   "mime_type": "application/pdf",
#   "size_bytes": 102400,
#   "created_at": "2024-01-15T10:30:00Z",
#   "expires_at": null,
#   "purpose": "vision"
# }
```

**Reference uploaded file in agent request:**
```bash
curl -X POST http://localhost:3000/v1/plugins/doc-reader/agents/analyzer \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Analyze this document",
    "attachments": [{
      "type": "document",
      "mediaType": "application/pdf",
      "source": { "type": "file", "fileId": "file-abc123" }
    }]
  }'
```

**List uploaded files:**
```bash
curl http://localhost:3000/v1/files

# Response:
# {
#   "data": [
#     { "id": "file-abc123", "filename": "document.pdf", ... },
#     { "id": "file-def456", "filename": "image.png", ... }
#   ],
#   "has_more": false
# }
```

**Get file metadata:**
```bash
curl http://localhost:3000/v1/files/file-abc123
```

**Delete a file:**
```bash
curl -X DELETE http://localhost:3000/v1/files/file-abc123

# Response: { "id": "file-abc123", "deleted": true }
```

**When to use Files API vs inline attachments:**

| Scenario | Recommended Approach |
|----------|---------------------|
| One-time file analysis | Inline base64 attachment |
| Same file used in multiple requests | Upload to Files API first |
| Large files (>10MB) | Upload to Files API |
| Files needed across sessions | Upload to Files API |
| Quick prototyping | Inline base64 attachment |

### Creating a Local Plugin

1. Create plugin directory:
```bash
mkdir -p .claude/plugins/my-local-plugin/.claude-plugin
mkdir -p .claude/plugins/my-local-plugin/commands
mkdir -p .claude/plugins/my-local-plugin/agents
```

2. Create manifest (`.claude-plugin/plugin.json`):
```json
{
  "name": "my-local-plugin",
  "version": "1.0.0",
  "description": "My local development plugin"
}
```

3. Create a command (`commands/greet.md`):
```markdown
---
description: Greet the user
---

Greet the user with a friendly message. Use their name if provided.
```

4. Restart server or wait for hot reload

5. Test:
```bash
curl -X POST http://localhost:3000/v1/plugins/my-local-plugin/commands/greet \
  -H "Content-Type: application/json" \
  -d '{"arguments": "Alice"}'
```

---

## Acceptance Criteria

### Functional Requirements

- [ ] Plugin discovery service scans `.claude/plugins` directory
- [ ] Plugin manifests (`.claude-plugin/plugin.json`) are parsed correctly
- [ ] Commands, agents, and skills are discovered from markdown files
- [ ] YAML frontmatter is extracted for metadata (description, tools, model)
- [ ] `GET /v1/plugins` lists all discovered plugins with their capabilities
- [ ] `GET /v1/plugins/:name` returns detailed plugin information
- [ ] `POST /v1/plugins/:name/commands/:cmd` executes plugin commands
- [ ] `POST /v1/plugins/:name/agents/:agent` executes plugin agents
- [ ] `POST /v1/plugins/:name/skills/:skill` executes plugin skills
- [ ] SSE streaming works via two-step POST → GET pattern
- [ ] Hot reload detects plugin changes in development mode
- [ ] `rawResponse` flag returns direct output with auto-detected Content-Type (JSON or text/plain)
- [ ] `attachments` array supports images (jpeg, png, gif, webp), PDFs, and text files
- [ ] Attachments can be provided via base64 encoding, URL reference, or file ID
- [ ] Files API proxies to Anthropic: upload, list, get, delete
- [ ] Uploaded file IDs can be referenced in attachments with `source.type: 'file'`
- [ ] HTTP Basic Auth protects API endpoints by default
- [ ] Auth can be disabled via `{ auth: { disabled: true } }`
- [ ] Custom auth providers can replace the default YAML-based provider
- [ ] `auth.yml` file configures users (plain text or bcrypt passwords)
- [ ] `/health` and `/api/docs*` are excluded from auth by default
- [ ] Excluded paths are configurable via `auth.excludePaths`

### Non-Functional Requirements

- [ ] Plugin loading errors don't crash the server
- [ ] Invalid plugin structures are logged and skipped
- [ ] Stream sessions expire after 5 minutes
- [ ] OpenAPI documentation is generated for all endpoints
- [ ] Health endpoint reports plugin count

### Quality Gates

- [ ] All tests pass
- [ ] No TypeScript errors
- [ ] Docker images build successfully
- [ ] Can load and execute example plugin

---

## File Structure Summary

```
claude-code-plugin-api/                    # Monorepo root
├── package.json                           # Workspace root (private)
├── pnpm-workspace.yaml                    # pnpm workspaces config
├── .npmrc                                 # GitHub Packages registry
├── .github/
│   └── workflows/
│       ├── ci.yml                         # CI pipeline
│       └── publish.yml                    # Publish to GitHub Packages
│
├── packages/
│   └── claude-code-plugin-api/            # @tigz/claude-code-plugin-api
│       ├── package.json
│       ├── tsconfig.json
│       ├── README.md
│       └── src/
│           ├── index.ts                   # Public exports
│           ├── claude-plugin.module.ts    # Main dynamic module
│           ├── types/
│           │   └── plugin.types.ts
│           ├── auth/
│           │   ├── auth.types.ts              # AuthProvider interface, AuthModuleOptions
│           │   ├── auth.guard.ts              # BasicAuthGuard
│           │   └── yaml-auth.provider.ts      # Default YAML file auth provider
│           ├── services/
│           │   ├── plugin-discovery.service.ts
│           │   ├── plugin-execution.service.ts
│           │   └── stream-session.service.ts
│           └── controllers/
│               └── plugin.controller.ts
│
└── examples/
    └── basic-server/                      # Example consumer project
        ├── package.json
        ├── tsconfig.json
        ├── nest-cli.json
        ├── Dockerfile
        ├── docker-compose.yml
        ├── README.md
        ├── example.auth.yml               # Example auth config (copy to auth.yml)
        ├── .gitignore                     # Includes auth.yml
        ├── src/
        │   ├── main.ts
        │   ├── app.module.ts
        │   └── health.controller.ts
        └── .claude/
            └── plugins/                   # User's plugins
                └── example-plugin/
                    ├── .claude-plugin/
                    │   └── plugin.json
                    ├── commands/
                    │   └── hello.md
                    └── agents/
                        └── code-helper.md
```

---

## References & Research

### Claude Code Plugin System
- Plugin structure with `.claude-plugin/plugin.json` manifest
- Commands in `commands/*.md` with YAML frontmatter
- Agents in `agents/*.md` with optional `tools`, `model` metadata
- Skills in `skills/*/SKILL.md` with `allowed-tools` metadata
- Marketplaces as git repositories with `marketplace.json`

### NestJS Patterns
- Dynamic modules with `ConfigurableModuleBuilder`
- SSE via `@Sse()` decorator returning `Observable<MessageEvent>`
- File watching with chokidar for hot reload
- EventEmitter2 for plugin lifecycle events

### Best Practices
- Two-step SSE pattern (POST → GET) for complex payloads
- Parameterized routes for plugin gateway (`/plugins/:name/:type/:action`)
- Session-based streaming with TTL and cleanup
- Graceful handling of missing/invalid plugins

### External References
- [Claude Agent SDK](https://github.com/anthropics/claude-code)
- [NestJS Server-Sent Events](https://docs.nestjs.com/techniques/server-sent-events)
- [NestJS Dynamic Modules](https://docs.nestjs.com/fundamentals/dynamic-modules)
