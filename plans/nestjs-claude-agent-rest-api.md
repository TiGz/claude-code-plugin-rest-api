# feat: NestJS REST API with Claude Agent SDK Integration

## Overview

Build a production-ready NestJS REST API template that exposes Claude Agents via HTTP endpoints, using the Claude Agent SDK with a flexible plugin/skill architecture. The template includes Docker support with credential mounting for Claude Max subscription authentication (no API key required).

## Problem Statement / Motivation

Developers want to build REST APIs backed by Claude's powerful agent capabilities but face several challenges:
- No clear pattern for integrating Claude Agent SDK with NestJS
- Complexity around authentication (API keys vs Claude Max subscription)
- Lack of extensibility patterns for adding new agents/capabilities
- Missing Docker patterns for credential management

This template solves these problems by providing a well-documented, production-ready foundation.

## Proposed Solution

A NestJS application with:
1. **Core Agent Service** - Wraps Claude Agent SDK with proper DI patterns
2. **Plugin Architecture** - Dynamic module system for extending agent capabilities
3. **Streaming Support** - SSE endpoints for real-time agent responses
4. **Docker Setup** - Multi-stage builds with credential mounting
5. **Developer Experience** - Clear patterns for adding new endpoint+agent combinations

## Technical Approach

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         NestJS Application                       │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │   Agent     │  │   Agent     │  │   Agent     │  ...        │
│  │ Controller  │  │ Controller  │  │ Controller  │             │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘             │
│         │                │                │                     │
│  ┌──────┴────────────────┴────────────────┴──────┐             │
│  │              Agent Service (Core)              │             │
│  │         Wraps Claude Agent SDK query()         │             │
│  └──────────────────────┬────────────────────────┘             │
│                         │                                       │
│  ┌──────────────────────┴────────────────────────┐             │
│  │            Plugin Registry Module              │             │
│  │    ┌─────────┐ ┌─────────┐ ┌─────────┐       │             │
│  │    │ Plugin  │ │ Plugin  │ │ Plugin  │ ...   │             │
│  │    │   A     │ │   B     │ │   C     │       │             │
│  │    └─────────┘ └─────────┘ └─────────┘       │             │
│  └───────────────────────────────────────────────┘             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │     Claude Agent SDK          │
              │  (@anthropic-ai/claude-agent-sdk)  │
              └───────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │  ~/.claude credentials        │
              │  (mounted from host)          │
              └───────────────────────────────┘
```

### Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Agent Instance Scope | Per-request | Isolation, no shared state, easier cleanup |
| Streaming | SSE (Server-Sent Events) | Unidirectional, simpler than WebSockets, native browser support |
| Plugin Loading | Dynamic Modules | NestJS-native, type-safe, DI-integrated |
| Authentication | Claude Max via ~/.claude | No API key management, uses existing `claude login` |
| Error Format | NestJS HttpException | Standard, well-documented, client-friendly |

## Implementation Phases

### Phase 1: Project Foundation

#### 1.1 Initialize NestJS Project

**Files to create:**

```
src/
├── main.ts
├── app.module.ts
├── app.controller.ts
└── app.service.ts
```

**package.json:**

```json
{
  "name": "claude-agent-template",
  "version": "0.1.0",
  "scripts": {
    "dev": "nest start --watch",
    "build": "nest build",
    "start:prod": "node dist/main",
    "test": "jest",
    "test:watch": "jest --watch",
    "lint": "eslint \"{src,apps,libs,test}/**/*.ts\" --fix",
    "format": "prettier --write \"src/**/*.ts\" \"test/**/*.ts\""
  },
  "dependencies": {
    "@nestjs/common": "^10.0.0",
    "@nestjs/config": "^3.0.0",
    "@nestjs/core": "^10.0.0",
    "@nestjs/platform-express": "^10.0.0",
    "@anthropic-ai/claude-agent-sdk": "^0.1.65",
    "reflect-metadata": "^0.1.13",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.0.0",
    "@nestjs/schematics": "^10.0.0",
    "@nestjs/testing": "^10.0.0",
    "@types/express": "^4.17.17",
    "@types/jest": "^29.5.2",
    "@types/node": "^20.3.1",
    "@typescript-eslint/eslint-plugin": "^6.0.0",
    "@typescript-eslint/parser": "^6.0.0",
    "eslint": "^8.42.0",
    "eslint-config-prettier": "^9.0.0",
    "eslint-plugin-prettier": "^5.0.0",
    "jest": "^29.5.0",
    "prettier": "^3.0.0",
    "ts-jest": "^29.1.0",
    "ts-loader": "^9.4.3",
    "ts-node": "^10.9.1",
    "tsconfig-paths": "^4.2.0",
    "typescript": "^5.1.3"
  }
}
```

**src/main.ts:**

```typescript
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');

  app.useGlobalPipes(new ValidationPipe({ transform: true }));
  app.enableCors();

  const port = process.env.PORT || 3000;
  await app.listen(port);
  logger.log(`Application running on port ${port}`);
}
bootstrap();
```

#### 1.2 Configuration Module

**src/config/configuration.ts:**

```typescript
export default () => ({
  port: parseInt(process.env.PORT, 10) || 3000,
  claude: {
    maxTurns: parseInt(process.env.CLAUDE_MAX_TURNS, 10) || 50,
    maxBudgetUsd: parseFloat(process.env.CLAUDE_MAX_BUDGET_USD) || 10.0,
    defaultModel: process.env.CLAUDE_MODEL || 'claude-sonnet-4-5',
    credentialsPath: process.env.CLAUDE_CREDENTIALS_PATH || '~/.claude',
  },
  agent: {
    defaultTimeout: parseInt(process.env.AGENT_TIMEOUT_MS, 10) || 300000, // 5 min
    maxConcurrent: parseInt(process.env.AGENT_MAX_CONCURRENT, 10) || 10,
  },
});
```

**src/config/config.module.ts:**

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './configuration';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
  ],
})
export class AppConfigModule {}
```

---

### Phase 2: Core Agent Module

#### 2.1 Agent Service (SDK Wrapper)

**src/agents/agent.service.ts:**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { Observable, from } from 'rxjs';

export interface AgentOptions {
  allowedTools?: string[];
  maxTurns?: number;
  maxBudgetUsd?: number;
  systemPrompt?: string;
  cwd?: string;
}

export interface AgentResult {
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
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(private configService: ConfigService) {}

  /**
   * Execute an agent query and return the final result
   */
  async execute(prompt: string, options: AgentOptions = {}): Promise<AgentResult> {
    const mergedOptions = this.mergeOptions(options);

    try {
      let finalResult: AgentResult = { success: false };

      for await (const message of query({
        prompt,
        options: mergedOptions,
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
      this.logger.error(`Agent execution failed: ${error.message}`, error.stack);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Execute an agent query with streaming response
   */
  stream(prompt: string, options: AgentOptions = {}): Observable<SDKMessage> {
    const mergedOptions = this.mergeOptions(options);

    return new Observable((subscriber) => {
      (async () => {
        try {
          for await (const message of query({
            prompt,
            options: mergedOptions,
          })) {
            subscriber.next(message);

            if (message.type === 'result') {
              subscriber.complete();
            }
          }
        } catch (error) {
          this.logger.error(`Agent stream failed: ${error.message}`, error.stack);
          subscriber.error(error);
        }
      })();
    });
  }

  private mergeOptions(options: AgentOptions) {
    return {
      allowedTools: options.allowedTools || ['Read', 'Glob', 'Grep'],
      maxTurns: options.maxTurns || this.configService.get('claude.maxTurns'),
      maxBudgetUsd: options.maxBudgetUsd || this.configService.get('claude.maxBudgetUsd'),
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
}
```

#### 2.2 Agent Controller

**src/agents/agent.controller.ts:**

```typescript
import { Controller, Post, Body, Sse, Query, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { Observable, map, catchError, of } from 'rxjs';
import { AgentService, AgentOptions, AgentResult } from './agent.service';

export class ExecuteAgentDto {
  prompt: string;
  options?: AgentOptions;
}

interface SseMessage {
  data: {
    type: string;
    content?: string;
    error?: string;
    result?: AgentResult;
  };
}

@Controller('agents')
export class AgentController {
  private readonly logger = new Logger(AgentController.name);

  constructor(private readonly agentService: AgentService) {}

  /**
   * Execute agent and return final result (non-streaming)
   */
  @Post('execute')
  async execute(@Body() dto: ExecuteAgentDto): Promise<AgentResult> {
    this.logger.log(`Executing agent with prompt: ${dto.prompt.substring(0, 50)}...`);

    const result = await this.agentService.execute(dto.prompt, dto.options);

    if (!result.success && result.error) {
      throw new HttpException(
        { success: false, error: result.error },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    return result;
  }

  /**
   * Execute agent with SSE streaming response
   */
  @Sse('stream')
  stream(@Query('prompt') prompt: string): Observable<SseMessage> {
    if (!prompt) {
      return of({
        data: { type: 'error', error: 'Prompt is required' },
      });
    }

    this.logger.log(`Streaming agent with prompt: ${prompt.substring(0, 50)}...`);

    return this.agentService.stream(prompt).pipe(
      map((message) => {
        if (message.type === 'assistant') {
          const text = message.message.content
            .filter((c) => c.type === 'text')
            .map((c) => c.text)
            .join('');

          return {
            data: { type: 'delta', content: text },
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
            },
          };
        }

        return { data: { type: message.type } };
      }),
      catchError((error) => {
        this.logger.error(`Stream error: ${error.message}`);
        return of({
          data: { type: 'error', error: error.message },
        });
      }),
    );
  }
}
```

#### 2.3 Agent Module

**src/agents/agent.module.ts:**

```typescript
import { Module } from '@nestjs/common';
import { AgentService } from './agent.service';
import { AgentController } from './agent.controller';

@Module({
  controllers: [AgentController],
  providers: [AgentService],
  exports: [AgentService],
})
export class AgentModule {}
```

---

### Phase 3: Plugin Architecture

#### 3.1 Plugin Interface

**src/plugins/interfaces/plugin.interface.ts:**

```typescript
export interface AgentTool {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
  execute: (args: Record<string, any>) => Promise<any>;
}

export interface AgentPlugin {
  /** Unique plugin identifier */
  name: string;

  /** Human-readable description */
  description: string;

  /** Plugin version */
  version: string;

  /** Tools this plugin provides to agents */
  tools: AgentTool[];

  /** Optional initialization (called once at startup) */
  initialize?(): Promise<void>;

  /** Optional cleanup (called on shutdown) */
  destroy?(): Promise<void>;
}

export const AGENT_PLUGIN = Symbol('AGENT_PLUGIN');
```

#### 3.2 Plugin Registry

**src/plugins/plugin-registry.service.ts:**

```typescript
import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Inject } from '@nestjs/common';
import { AgentPlugin, AGENT_PLUGIN } from './interfaces/plugin.interface';

@Injectable()
export class PluginRegistryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PluginRegistryService.name);
  private plugins = new Map<string, AgentPlugin>();

  constructor(
    @Inject(AGENT_PLUGIN)
    private readonly registeredPlugins: AgentPlugin[],
  ) {}

  async onModuleInit() {
    for (const plugin of this.registeredPlugins) {
      await this.registerPlugin(plugin);
    }
    this.logger.log(`Initialized ${this.plugins.size} plugins`);
  }

  async onModuleDestroy() {
    for (const plugin of this.plugins.values()) {
      if (plugin.destroy) {
        await plugin.destroy();
      }
    }
  }

  private async registerPlugin(plugin: AgentPlugin) {
    if (plugin.initialize) {
      await plugin.initialize();
    }
    this.plugins.set(plugin.name, plugin);
    this.logger.log(`Registered plugin: ${plugin.name} v${plugin.version}`);
  }

  getPlugin(name: string): AgentPlugin | undefined {
    return this.plugins.get(name);
  }

  getAllPlugins(): AgentPlugin[] {
    return Array.from(this.plugins.values());
  }

  getToolsForPlugins(pluginNames: string[]): AgentTool[] {
    return pluginNames
      .map((name) => this.plugins.get(name))
      .filter(Boolean)
      .flatMap((plugin) => plugin.tools);
  }
}
```

#### 3.3 Plugin Module (Dynamic)

**src/plugins/plugins.module.ts:**

```typescript
import { Module, DynamicModule } from '@nestjs/common';
import { PluginRegistryService } from './plugin-registry.service';
import { AgentPlugin, AGENT_PLUGIN } from './interfaces/plugin.interface';

export interface PluginsModuleOptions {
  plugins: AgentPlugin[];
}

@Module({})
export class PluginsModule {
  static forRoot(options: PluginsModuleOptions): DynamicModule {
    return {
      module: PluginsModule,
      global: true,
      providers: [
        {
          provide: AGENT_PLUGIN,
          useValue: options.plugins,
        },
        PluginRegistryService,
      ],
      exports: [PluginRegistryService],
    };
  }
}
```

#### 3.4 Example Plugin

**src/plugins/examples/calculator.plugin.ts:**

```typescript
import { AgentPlugin, AgentTool } from '../interfaces/plugin.interface';

const addTool: AgentTool = {
  name: 'calculator_add',
  description: 'Add two numbers together',
  inputSchema: {
    type: 'object',
    properties: {
      a: { type: 'number', description: 'First number' },
      b: { type: 'number', description: 'Second number' },
    },
    required: ['a', 'b'],
  },
  execute: async ({ a, b }) => ({ result: a + b }),
};

const multiplyTool: AgentTool = {
  name: 'calculator_multiply',
  description: 'Multiply two numbers',
  inputSchema: {
    type: 'object',
    properties: {
      a: { type: 'number', description: 'First number' },
      b: { type: 'number', description: 'Second number' },
    },
    required: ['a', 'b'],
  },
  execute: async ({ a, b }) => ({ result: a * b }),
};

export const calculatorPlugin: AgentPlugin = {
  name: 'calculator',
  description: 'Basic arithmetic operations',
  version: '1.0.0',
  tools: [addTool, multiplyTool],

  async initialize() {
    console.log('Calculator plugin initialized');
  },
};
```

---

### Phase 4: Example Agent Endpoint

#### 4.1 Code Reviewer Agent

**src/modules/code-reviewer/code-reviewer.controller.ts:**

```typescript
import { Controller, Post, Body, Sse, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { AgentService } from '../../agents/agent.service';

class ReviewCodeDto {
  code: string;
  language?: string;
  focus?: 'security' | 'performance' | 'style' | 'all';
}

@Controller('api/v1/code-reviewer')
export class CodeReviewerController {
  private readonly logger = new Logger(CodeReviewerController.name);

  constructor(private readonly agentService: AgentService) {}

  @Post('review')
  async reviewCode(@Body() dto: ReviewCodeDto) {
    const prompt = this.buildPrompt(dto);

    return this.agentService.execute(prompt, {
      allowedTools: ['Read', 'Grep', 'Glob'],
      systemPrompt: `You are an expert code reviewer. Analyze code for issues and provide actionable feedback.
Focus areas: ${dto.focus || 'all'}
Be concise and specific. Provide line numbers when referencing issues.`,
    });
  }

  @Sse('review/stream')
  reviewCodeStream(@Body() dto: ReviewCodeDto): Observable<any> {
    const prompt = this.buildPrompt(dto);

    return this.agentService.stream(prompt, {
      allowedTools: ['Read', 'Grep', 'Glob'],
      systemPrompt: `You are an expert code reviewer. Analyze code for issues and provide actionable feedback.`,
    });
  }

  private buildPrompt(dto: ReviewCodeDto): string {
    return `Review the following ${dto.language || ''} code:

\`\`\`${dto.language || ''}
${dto.code}
\`\`\`

Provide a detailed review focusing on: ${dto.focus || 'security, performance, and code style'}`;
  }
}
```

**src/modules/code-reviewer/code-reviewer.module.ts:**

```typescript
import { Module } from '@nestjs/common';
import { CodeReviewerController } from './code-reviewer.controller';
import { AgentModule } from '../../agents/agent.module';

@Module({
  imports: [AgentModule],
  controllers: [CodeReviewerController],
})
export class CodeReviewerModule {}
```

---

### Phase 5: Docker Configuration

#### 5.1 Dockerfile (Multi-stage)

**Dockerfile:**

```dockerfile
# =============================================================================
# Stage 1: Development
# =============================================================================
FROM node:20-alpine AS development

RUN apk add --no-cache libc6-compat
RUN npm install -g pnpm

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install all dependencies (including devDependencies)
RUN pnpm install

# Copy source
COPY . .

EXPOSE 3000

CMD ["pnpm", "run", "dev"]

# =============================================================================
# Stage 2: Build
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

# Security: Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001 -G nodejs

WORKDIR /app

# Install pnpm and production dependencies only
RUN npm install -g pnpm
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

# Copy built application
COPY --from=build --chown=nestjs:nodejs /app/dist ./dist

# Create .claude directory for credentials mount
RUN mkdir -p /home/nestjs/.claude && \
    chown -R nestjs:nodejs /home/nestjs/.claude

USER nestjs

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/health || exit 1

EXPOSE 3000

CMD ["node", "dist/main"]
```

#### 5.2 Docker Compose (Development)

**docker-compose.yml:**

```yaml
version: '3.8'

services:
  api:
    build:
      context: .
      dockerfile: Dockerfile
      target: development
    container_name: claude-agent-api
    ports:
      - "3000:3000"
    volumes:
      # Source code for hot reload
      - ./src:/app/src:ro
      - ./test:/app/test:ro
      # Claude credentials from host (read-only)
      - ~/.claude:/root/.claude:ro
    environment:
      - NODE_ENV=development
      - PORT=3000
      - CLAUDE_MAX_TURNS=50
      - CLAUDE_MAX_BUDGET_USD=10
    env_file:
      - .env
    networks:
      - agent-network
    restart: unless-stopped

networks:
  agent-network:
    driver: bridge
```

#### 5.3 Docker Compose (Production)

**docker-compose.prod.yml:**

```yaml
version: '3.8'

services:
  api:
    build:
      context: .
      dockerfile: Dockerfile
      target: production
    container_name: claude-agent-api-prod
    ports:
      - "3000:3000"
    volumes:
      # Claude credentials from host (read-only, mapped to non-root user home)
      - ~/.claude:/home/nestjs/.claude:ro
    environment:
      - NODE_ENV=production
      - PORT=3000
    env_file:
      - .env.production
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 1G
        reservations:
          cpus: '0.5'
          memory: 512M
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    networks:
      - agent-network

networks:
  agent-network:
    driver: bridge
```

---

### Phase 6: Health & Documentation

#### 6.1 Health Controller

**src/common/health/health.controller.ts:**

```typescript
import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

@Controller('health')
export class HealthController {
  constructor(private configService: ConfigService) {}

  @Get()
  check() {
    const claudeCredentialsPath = this.resolveClaudePath();
    const credentialsExist = fs.existsSync(claudeCredentialsPath);

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      claude: {
        credentialsConfigured: credentialsExist,
        credentialsPath: claudeCredentialsPath,
      },
    };
  }

  @Get('ready')
  ready() {
    const claudeCredentialsPath = this.resolveClaudePath();
    const credentialsExist = fs.existsSync(claudeCredentialsPath);

    if (!credentialsExist) {
      return {
        status: 'not_ready',
        reason: 'Claude credentials not found',
      };
    }

    return { status: 'ready' };
  }

  private resolveClaudePath(): string {
    const configPath = this.configService.get('claude.credentialsPath');
    if (configPath.startsWith('~')) {
      return path.join(os.homedir(), configPath.slice(1));
    }
    return configPath;
  }
}
```

#### 6.2 OpenAPI Documentation

**src/main.ts (updated):**

```typescript
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');

  app.useGlobalPipes(new ValidationPipe({ transform: true }));
  app.enableCors();

  // Swagger documentation
  const config = new DocumentBuilder()
    .setTitle('Claude Agent API')
    .setDescription('REST API for Claude Agent interactions')
    .setVersion('1.0')
    .addTag('agents', 'Core agent endpoints')
    .addTag('code-reviewer', 'Code review agent')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port);
  logger.log(`Application running on port ${port}`);
  logger.log(`API documentation available at http://localhost:${port}/api/docs`);
}
bootstrap();
```

---

### Phase 7: App Module Assembly

**src/app.module.ts:**

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { AgentModule } from './agents/agent.module';
import { PluginsModule } from './plugins/plugins.module';
import { CodeReviewerModule } from './modules/code-reviewer/code-reviewer.module';
import { HealthController } from './common/health/health.controller';

// Import plugins
import { calculatorPlugin } from './plugins/examples/calculator.plugin';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    PluginsModule.forRoot({
      plugins: [calculatorPlugin],
    }),
    AgentModule,
    CodeReviewerModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
```

---

## Developer Guide: Adding New Agent Endpoints

### Step 1: Create Module Directory

```bash
mkdir -p src/modules/my-agent
```

### Step 2: Create Controller

**src/modules/my-agent/my-agent.controller.ts:**

```typescript
import { Controller, Post, Body } from '@nestjs/common';
import { AgentService } from '../../agents/agent.service';

class MyAgentDto {
  input: string;
}

@Controller('api/v1/my-agent')
export class MyAgentController {
  constructor(private readonly agentService: AgentService) {}

  @Post()
  async process(@Body() dto: MyAgentDto) {
    return this.agentService.execute(dto.input, {
      allowedTools: ['Read', 'Write', 'Bash'],
      systemPrompt: 'You are a helpful assistant...',
    });
  }
}
```

### Step 3: Create Module

**src/modules/my-agent/my-agent.module.ts:**

```typescript
import { Module } from '@nestjs/common';
import { MyAgentController } from './my-agent.controller';
import { AgentModule } from '../../agents/agent.module';

@Module({
  imports: [AgentModule],
  controllers: [MyAgentController],
})
export class MyAgentModule {}
```

### Step 4: Register in AppModule

```typescript
// In app.module.ts
import { MyAgentModule } from './modules/my-agent/my-agent.module';

@Module({
  imports: [
    // ... other imports
    MyAgentModule,
  ],
})
export class AppModule {}
```

---

## Acceptance Criteria

### Functional Requirements

- [ ] NestJS application initializes and runs on port 3000
- [ ] `/health` endpoint returns status and credential check
- [ ] `/agents/execute` accepts POST with prompt, returns agent result
- [ ] `/agents/stream` accepts GET with prompt query param, returns SSE stream
- [ ] Plugin system loads and registers plugins at startup
- [ ] Code reviewer example endpoint works (`/api/v1/code-reviewer/review`)
- [ ] Docker build succeeds for both development and production targets
- [ ] Docker Compose mounts `~/.claude` credentials correctly
- [ ] Application authenticates with Claude using mounted credentials (no API key)

### Non-Functional Requirements

- [ ] Hot reload works in development mode
- [ ] TypeScript strict mode enabled
- [ ] ESLint and Prettier configured
- [ ] Unit tests for AgentService
- [ ] API documentation available at `/api/docs`
- [ ] Error responses follow consistent format

### Quality Gates

- [ ] All tests pass
- [ ] No TypeScript errors
- [ ] No ESLint errors
- [ ] Docker images build successfully
- [ ] Credentials mount verified in container

---

## Testing Strategy

### Unit Tests

**test/agents/agent.service.spec.ts:**

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AgentService } from '../../src/agents/agent.service';

// Mock the Claude Agent SDK
jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: jest.fn(),
}));

describe('AgentService', () => {
  let service: AgentService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const config = {
                'claude.maxTurns': 50,
                'claude.maxBudgetUsd': 10,
              };
              return config[key];
            }),
          },
        },
      ],
    }).compile();

    service = module.get<AgentService>(AgentService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // Additional tests...
});
```

### Integration Tests

```bash
# Test health endpoint
curl http://localhost:3000/health

# Test agent execution
curl -X POST http://localhost:3000/agents/execute \
  -H "Content-Type: application/json" \
  -d '{"prompt": "What is 2+2?"}'

# Test streaming
curl -N http://localhost:3000/agents/stream?prompt=Hello
```

---

## File Structure Summary

```
claude-agent-template/
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── config/
│   │   ├── configuration.ts
│   │   └── config.module.ts
│   ├── agents/
│   │   ├── agent.service.ts
│   │   ├── agent.controller.ts
│   │   └── agent.module.ts
│   ├── plugins/
│   │   ├── interfaces/
│   │   │   └── plugin.interface.ts
│   │   ├── plugin-registry.service.ts
│   │   ├── plugins.module.ts
│   │   └── examples/
│   │       └── calculator.plugin.ts
│   ├── modules/
│   │   └── code-reviewer/
│   │       ├── code-reviewer.controller.ts
│   │       └── code-reviewer.module.ts
│   └── common/
│       └── health/
│           └── health.controller.ts
├── test/
│   └── agents/
│       └── agent.service.spec.ts
├── Dockerfile
├── docker-compose.yml
├── docker-compose.prod.yml
├── package.json
├── tsconfig.json
├── nest-cli.json
├── .eslintrc.js
├── .prettierrc
├── .env.example
└── README.md
```

---

## References & Research

### Internal References
- [CLAUDE.md](CLAUDE.md) - Project conventions and commands

### External References
- [Claude Agent SDK Documentation](https://platform.claude.com/docs/en/agent-sdk/overview)
- [Claude Agent SDK TypeScript](https://github.com/anthropics/claude-agent-sdk-typescript)
- [NestJS Documentation](https://docs.nestjs.com/)
- [NestJS Server-Sent Events](https://docs.nestjs.com/techniques/server-sent-events)
- [Docker Multi-stage Builds](https://docs.docker.com/build/building/multi-stage/)

### Related Work
- [claude-code-nestjs-agents](https://github.com/DanielSoCra/claude-code-nestjs-agents) - Production NestJS framework example
