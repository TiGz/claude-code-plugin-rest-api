# REST API Plugin System Research
## Best Practices for NestJS Plugin Architecture

**Research Date:** 2025-12-12
**Context:** Building a NestJS REST API template that automatically discovers and exposes Claude Code plugins as HTTP endpoints

---

## Table of Contents
1. [Plugin Discovery and Registration Patterns](#1-plugin-discovery-and-registration-patterns)
2. [Dynamic Route Generation in NestJS](#2-dynamic-route-generation-in-nestjs)
3. [REST API Design for Extensibility](#3-rest-api-design-for-extensible-functionality)
4. [Streaming Responses with SSE](#4-streaming-responses-sse-for-agent-interactions)
5. [Authentication and Security](#5-authentication-and-security)
6. [Real-World Examples and References](#6-real-world-examples-and-references)

---

## 1. Plugin Discovery and Registration Patterns

### Naming Conventions (Industry Standard)

Following established conventions from ESLint and Babel ecosystems:

**Unscoped Packages:**
```
claude-agent-plugin-<name>
```
Example: `claude-agent-plugin-github`, `claude-agent-plugin-slack`

**Scoped Packages:**
```
@<scope>/claude-agent-plugin-<name>
@<scope>/claude-agent-plugin
```
Example: `@myorg/claude-agent-plugin-custom`, `@myorg/claude-agent-plugin`

**Discovery Pattern:**
- Users can omit the prefix when configuring: `"github"` resolves to `claude-agent-plugin-github`
- For scoped: `"@myorg/custom"` resolves to `@myorg/claude-agent-plugin-custom`

**Source:** [ESLint Plugin Documentation](https://eslint.org/docs/latest/extend/plugins)

### Package.json Convention for Plugin Discovery

Each plugin should include metadata in package.json:

```json
{
  "name": "claude-agent-plugin-example",
  "version": "1.0.0",
  "keywords": ["claude-agent-plugin", "claude", "plugin"],
  "main": "dist/index.js",
  "claudeAgentPlugin": {
    "name": "example",
    "version": "1.0.0",
    "type": "agent" // or "command", "skill"
  }
}
```

**Key Fields:**
- `keywords`: Must include `"claude-agent-plugin"` for npm discoverability
- `main`: Entry point for the plugin
- `claudeAgentPlugin`: Custom field with plugin metadata

**Source:** [npm package.json documentation](https://docs.npmjs.com/cli/v7/configuring-npm/package-json/)

### Plugin Discovery Implementation

**Approach 1: Filesystem-Based Discovery (Recommended for Local Development)**

```typescript
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class PluginDiscoveryService {
  private pluginCache = new Map<string, PluginModule>();

  async discoverPlugins(pluginDir: string): Promise<PluginModule[]> {
    const plugins: PluginModule[] = [];

    // Check if plugin directory exists
    if (!fs.existsSync(pluginDir)) {
      return plugins;
    }

    // Read all subdirectories
    const entries = fs.readdirSync(pluginDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const pluginPath = path.join(pluginDir, entry.name);
        const plugin = await this.loadPlugin(pluginPath);

        if (plugin) {
          plugins.push(plugin);
          this.pluginCache.set(plugin.name, plugin);
        }
      }
    }

    return plugins;
  }

  private async loadPlugin(pluginPath: string): Promise<PluginModule | null> {
    try {
      const packageJsonPath = path.join(pluginPath, 'package.json');

      if (!fs.existsSync(packageJsonPath)) {
        return null;
      }

      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

      // Validate it's a Claude agent plugin
      if (!packageJson.claudeAgentPlugin) {
        return null;
      }

      // Dynamic import of the plugin module
      const pluginModule = await import(pluginPath);

      return {
        name: packageJson.claudeAgentPlugin.name,
        version: packageJson.version,
        type: packageJson.claudeAgentPlugin.type,
        module: pluginModule.default || pluginModule,
        metadata: packageJson.claudeAgentPlugin
      };
    } catch (error) {
      console.error(`Failed to load plugin from ${pluginPath}:`, error);
      return null;
    }
  }
}
```

**Source:** [Node.js plugin-loader](https://github.com/bitgamma/plugin-loader), [Plugin architecture patterns](https://www.n-school.com/plugin-based-architecture-in-node-js/)

**Approach 2: node_modules Discovery (Recommended for Production)**

```typescript
import { readdir } from 'fs/promises';
import { join } from 'path';

@Injectable()
export class NodeModulesPluginDiscovery {
  async discoverFromNodeModules(): Promise<PluginModule[]> {
    const plugins: PluginModule[] = [];
    const nodeModulesPath = join(process.cwd(), 'node_modules');

    try {
      const entries = await readdir(nodeModulesPath, { withFileTypes: true });

      for (const entry of entries) {
        // Handle scoped packages
        if (entry.isDirectory() && entry.name.startsWith('@')) {
          const scopedPlugins = await this.discoverScopedPlugins(
            join(nodeModulesPath, entry.name)
          );
          plugins.push(...scopedPlugins);
        }
        // Handle unscoped packages
        else if (entry.name.startsWith('claude-agent-plugin-')) {
          const plugin = await this.loadPluginFromNodeModules(
            join(nodeModulesPath, entry.name)
          );
          if (plugin) plugins.push(plugin);
        }
      }
    } catch (error) {
      console.error('Error discovering plugins from node_modules:', error);
    }

    return plugins;
  }

  private async discoverScopedPlugins(scopePath: string): Promise<PluginModule[]> {
    const plugins: PluginModule[] = [];
    const entries = await readdir(scopePath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith('claude-agent-plugin') ||
          entry.name === 'claude-agent-plugin') {
        const plugin = await this.loadPluginFromNodeModules(
          join(scopePath, entry.name)
        );
        if (plugin) plugins.push(plugin);
      }
    }

    return plugins;
  }
}
```

**Source:** [Node.js packages documentation](https://nodejs.org/api/packages.html)

### Plugin Validation and Security

**Critical Best Practices:**

1. **Validate Plugin Structure** before loading:
```typescript
import * as Joi from 'joi';

const pluginMetadataSchema = Joi.object({
  name: Joi.string().required(),
  version: Joi.string().required(),
  type: Joi.string().valid('agent', 'command', 'skill').required(),
  capabilities: Joi.array().items(Joi.string()),
  dependencies: Joi.object()
});

async validatePlugin(metadata: unknown): Promise<boolean> {
  const { error } = pluginMetadataSchema.validate(metadata);
  return !error;
}
```

2. **Namespace Plugin Outputs** to prevent conflicts:
```typescript
// Bad: app.logger (conflicts possible)
// Good: app.plugins.github.logger
```

3. **Run plugins in sandboxed environments** (for untrusted plugins)
4. **Restrict file system access** using Node.js permissions model

**Source:** [Plugin architecture security](https://www.n-school.com/plugin-based-architecture-in-node-js/)

### Hot Reloading Support

```typescript
import { EventEmitter2 } from '@nestjs/event-emitter';
import { watch } from 'chokidar';

@Injectable()
export class PluginHotReloadService {
  constructor(private eventEmitter: EventEmitter2) {}

  watchPluginDirectory(pluginDir: string) {
    const watcher = watch(pluginDir, {
      ignored: /node_modules/,
      persistent: true,
      ignoreInitial: true
    });

    watcher
      .on('add', (path) => {
        this.eventEmitter.emit('plugin.added', { path });
      })
      .on('unlink', (path) => {
        this.eventEmitter.emit('plugin.removed', { path });
      })
      .on('change', (path) => {
        this.eventEmitter.emit('plugin.changed', { path });
      });
  }
}
```

**Source:** [Plugin hot reloading](https://www.n-school.com/plugin-based-architecture-in-node-js/)

---

## 2. Dynamic Route Generation in NestJS

### Challenge: NestJS Limitations

NestJS does not provide built-in support for fully dynamic routes at runtime. Routes must be defined using decorators like `@Controller()`, `@Get()`, etc., which require static values known at development time.

**Source:** [NestJS Issue #1438](https://github.com/nestjs/nest/issues/1438), [Dynamic routing discussion](https://github.com/nestjs/nest/issues/124)

### Solution 1: Dynamic Module Factory Pattern (Recommended)

Create a factory that generates controller classes dynamically:

```typescript
import { Controller, DynamicModule, Module } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';

export class PluginRouteFactory {
  static createPluginController(plugin: PluginModule): any {
    const { name, routes } = plugin.metadata;

    @Controller(`plugins/${name}`)
    class DynamicPluginController {
      constructor(private readonly pluginService: PluginExecutionService) {}
    }

    // Dynamically add route handlers
    for (const route of routes) {
      const { method, path, handler } = route;

      const descriptor = Object.getOwnPropertyDescriptor(
        DynamicPluginController.prototype,
        handler
      );

      // Add route decorator metadata
      Reflect.defineMetadata(
        PATH_METADATA,
        path,
        DynamicPluginController.prototype,
        handler
      );

      // Add the handler method
      DynamicPluginController.prototype[handler] = async function(
        req: Request,
        res: Response
      ) {
        return this.pluginService.executePluginRoute(
          plugin.name,
          route.name,
          req,
          res
        );
      };
    }

    return DynamicPluginController;
  }

  static createDynamicModule(plugins: PluginModule[]): DynamicModule {
    const controllers = plugins.map(plugin =>
      this.createPluginController(plugin)
    );

    return {
      module: PluginRoutesModule,
      controllers,
      providers: [PluginExecutionService],
      exports: [PluginExecutionService]
    };
  }
}

// Usage in AppModule
@Module({})
export class AppModule {
  static async forRoot(): Promise<DynamicModule> {
    const pluginDiscovery = new PluginDiscoveryService();
    const plugins = await pluginDiscovery.discoverPlugins('./plugins');

    const pluginModule = PluginRouteFactory.createDynamicModule(plugins);

    return {
      module: AppModule,
      imports: [pluginModule],
    };
  }
}
```

**Source:** [Dynamic routes gist](https://gist.github.com/faboulaws/9cfa959baa2b7bcf9d77cbb2a750ae91), [NestJS dynamic modules](https://docs.nestjs.com/fundamentals/dynamic-modules)

### Solution 2: Single Route with Dispatch Pattern (Simpler Alternative)

Create a single parameterized route that dispatches to plugin handlers:

```typescript
@Controller('plugins')
export class PluginGatewayController {
  constructor(private readonly pluginRegistry: PluginRegistryService) {}

  @All(':pluginName/:action')
  async handlePluginRequest(
    @Param('pluginName') pluginName: string,
    @Param('action') action: string,
    @Req() req: Request,
    @Res() res: Response
  ) {
    const plugin = this.pluginRegistry.getPlugin(pluginName);

    if (!plugin) {
      throw new NotFoundException(`Plugin ${pluginName} not found`);
    }

    const handler = plugin.routes?.find(r => r.name === action);

    if (!handler) {
      throw new NotFoundException(
        `Action ${action} not found in plugin ${pluginName}`
      );
    }

    return handler.execute(req, res);
  }

  @Get(':pluginName/stream/:action')
  @Sse()
  streamPluginResponse(
    @Param('pluginName') pluginName: string,
    @Param('action') action: string,
    @Req() req: Request
  ): Observable<MessageEvent> {
    const plugin = this.pluginRegistry.getPlugin(pluginName);
    return plugin.streamAction(action, req);
  }
}
```

**Pros:**
- Simple to implement
- No reflection or metadata manipulation
- Easy to secure and validate

**Cons:**
- Less RESTful (all routes under `/plugins/:name/:action`)
- Cannot use standard NestJS route decorators per plugin

**Source:** [Dynamic routing alternatives](https://lightrun.com/answers/nestjs-nest-add-dynamic-routing)

### Solution 3: Discovery Service with Lazy Loading

Use NestJS DiscoveryModule to register routes during initialization:

```typescript
import { DiscoveryModule, DiscoveryService } from '@nestjs/core';
import { MetadataScanner } from '@nestjs/core/metadata-scanner';

@Module({
  imports: [DiscoveryModule],
  providers: [DynamicRouteService]
})
export class DynamicRoutesModule implements OnModuleInit {
  constructor(
    private discoveryService: DiscoveryService,
    private metadataScanner: MetadataScanner
  ) {}

  async onModuleInit() {
    // Scan for dynamic routes during initialization
    const plugins = await this.discoverPlugins();
    await this.registerDynamicRoutes(plugins);
  }

  private async registerDynamicRoutes(plugins: PluginModule[]) {
    for (const plugin of plugins) {
      // Register routes using reflection
      this.createControllerForPlugin(plugin);
    }
  }
}
```

**Source:** [Dynamic NestJS listeners](https://dev.to/this-is-learning/dynamic-nestjs-listeners-discover-the-power-of-lazy-loading-53i2)

### Recommendation for Claude Agent Template

**Use Solution 2 (Single Route with Dispatch)** for the initial template because:
1. Simplest to implement and understand
2. Doesn't require reflection/metadata manipulation
3. Easy to secure and validate
4. Can evolve to Solution 1 later if needed

Example route structure:
```
POST   /plugins/:name/execute      # Execute agent/command
GET    /plugins/:name/stream       # Stream agent responses (SSE)
GET    /plugins                    # List available plugins
GET    /plugins/:name              # Get plugin metadata
GET    /plugins/:name/health       # Check plugin health
```

---

## 3. REST API Design for Extensible Functionality

### Modular Architecture Pattern

**Key Principle:** Divide the API into smaller, independent modules or microservices. Each module has its own functionalities and data, making it easier to extend specific features without affecting the entire API.

**Source:** [REST API extensibility design](https://www.linkedin.com/advice/3/how-can-you-design-restful-api-maximum-lrv7e)

### HATEOAS for Discoverability

Implement HATEOAS (Hypermedia as the Engine of Application State) to make the API self-documenting:

```typescript
@Get('plugins')
async listPlugins(): Promise<PluginListResponse> {
  const plugins = await this.pluginRegistry.getAll();

  return {
    _links: {
      self: { href: '/plugins' }
    },
    plugins: plugins.map(plugin => ({
      name: plugin.name,
      version: plugin.version,
      type: plugin.type,
      _links: {
        self: { href: `/plugins/${plugin.name}` },
        execute: {
          href: `/plugins/${plugin.name}/execute`,
          method: 'POST'
        },
        stream: {
          href: `/plugins/${plugin.name}/stream`,
          method: 'GET'
        }
      }
    }))
  };
}
```

**Source:** [API design patterns](https://www.linkedin.com/advice/3/how-can-you-design-restful-api-maximum-lrv7e)

### Versioning Strategy

Include API version in the URL or headers:

```typescript
// URL versioning (recommended for simplicity)
@Controller('v1/plugins')
export class PluginsV1Controller {}

// Header versioning (more flexible)
@Controller('plugins')
export class PluginsController {
  @Version('1')
  @Get()
  listPluginsV1() {}

  @Version('2')
  @Get()
  listPluginsV2() {}
}
```

**Best Practice:** Maintain backward compatibility for at least 2-3 major versions. Deprecate old versions gradually with advance notice.

**Source:** [API versioning best practices](https://learn.microsoft.com/en-us/azure/architecture/best-practices/api-design)

### Event-Driven Architecture for Plugin Communication

For plugins that need to communicate with each other:

```typescript
@Injectable()
export class PluginEventBus {
  constructor(private eventEmitter: EventEmitter2) {}

  async publishPluginEvent(event: PluginEvent) {
    await this.eventEmitter.emit(
      `plugin.${event.pluginName}.${event.eventType}`,
      event.data
    );
  }

  subscribeToPluginEvents(
    pluginName: string,
    eventType: string,
    handler: (data: any) => void
  ) {
    this.eventEmitter.on(
      `plugin.${pluginName}.${eventType}`,
      handler
    );
  }
}
```

**Source:** [Event-driven patterns](https://treblle.com/blog/beyond-rest-common-api-design-patterns-and-when-you-will-need-them-2)

### API Design for Claude Agent Plugins

Recommended endpoint structure:

```typescript
// Plugin management
GET    /v1/plugins                    # List all plugins
GET    /v1/plugins/:name              # Get plugin details
POST   /v1/plugins/:name/install      # Install plugin (if dynamic)
DELETE /v1/plugins/:name              # Uninstall plugin

// Agent execution
POST   /v1/agents/:name/execute       # Execute agent synchronously
GET    /v1/agents/:name/stream        # Stream agent responses (SSE)
POST   /v1/agents/:name/sessions      # Create new agent session
GET    /v1/agents/:name/sessions/:id  # Get session status

// Command execution
POST   /v1/commands/:name/execute     # Execute command

// Skill execution
POST   /v1/skills/:name/invoke        # Invoke skill
```

---

## 4. Streaming Responses (SSE) for Agent Interactions

### Why SSE for Claude Agents?

Server-Sent Events are ideal for Claude agent interactions because:
- **One-way streaming**: Agents stream responses to clients
- **Automatic reconnection**: Browser handles connection drops
- **Lightweight**: Uses standard HTTP, no WebSocket overhead
- **ChatGPT-like UX**: ChatGPT uses SSE, not WebSockets

**Source:** [Real-time SSE with NestJS](https://devkamal.medium.com/real-time-communication-made-simple-building-server-sent-events-sse-with-nestjs-f6a8f5715d18)

### Basic SSE Implementation

```typescript
import { Controller, Sse, MessageEvent, Query } from '@nestjs/common';
import { Observable, interval, map } from 'rxjs';

@Controller('agents')
export class AgentController {
  constructor(private agentService: AgentExecutionService) {}

  @Sse(':name/stream')
  streamAgentResponse(
    @Param('name') agentName: string,
    @Body() request: AgentRequest
  ): Observable<MessageEvent> {
    return this.agentService.executeAgent(agentName, request).pipe(
      map(chunk => ({
        type: 'message',
        data: chunk,
        id: Date.now().toString(),
        retry: 10000
      }))
    );
  }
}
```

**Source:** [NestJS SSE Documentation](https://docs.nestjs.com/techniques/server-sent-events)

### Production-Ready SSE Architecture

**Key Requirements for Production:**
1. Workspace-level filtering
2. User-level filtering
3. Event-type filtering
4. Horizontal scaling with Redis
5. Connection management
6. Error handling

```typescript
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { fromEvent, Observable } from 'rxjs';
import { filter, map } from 'rxjs/operators';

interface SSEEvent {
  workspaceId: string;
  userId: string;
  eventType: string;
  data: any;
}

@Injectable()
export class SSEService {
  constructor(private eventEmitter: EventEmitter2) {}

  createEventStream(
    workspaceId: string,
    userId: string,
    eventTypes: string[]
  ): Observable<MessageEvent> {
    return fromEvent<SSEEvent>(this.eventEmitter, 'sse.event').pipe(
      filter(event =>
        event.workspaceId === workspaceId &&
        event.userId === userId &&
        eventTypes.includes(event.eventType)
      ),
      map(event => ({
        type: event.eventType,
        data: JSON.stringify(event.data),
        id: Date.now().toString()
      }))
    );
  }

  publishEvent(event: SSEEvent) {
    this.eventEmitter.emit('sse.event', event);
  }
}

@Controller('stream')
export class StreamController {
  constructor(private sseService: SSEService) {}

  @Sse('events')
  streamEvents(
    @Query('workspace') workspaceId: string,
    @Query('user') userId: string,
    @Query('types') eventTypes: string
  ): Observable<MessageEvent> {
    const types = eventTypes.split(',');
    return this.sseService.createEventStream(workspaceId, userId, types);
  }
}
```

**Source:** [Production SSE patterns](https://iliabedian.com/blog/server-side-events-on-nestjs-emitting-events-to-clients)

### Handling POST with SSE (Two-Step Pattern)

Since SSE uses GET requests, use this pattern for complex payloads:

```typescript
import { v4 as uuidv4 } from 'uuid';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';

@Controller('agents')
export class AgentController {
  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private agentService: AgentExecutionService
  ) {}

  // Step 1: POST to create stream session
  @Post(':name/stream')
  async createStreamSession(
    @Param('name') agentName: string,
    @Body() request: AgentRequest
  ): Promise<{ streamId: string }> {
    const streamId = uuidv4();

    // Store request in cache temporarily (5 minutes TTL)
    await this.cacheManager.set(
      `stream:${streamId}`,
      { agentName, request },
      300000
    );

    return { streamId };
  }

  // Step 2: GET to consume stream
  @Sse('stream/:streamId')
  async consumeStream(
    @Param('streamId') streamId: string
  ): Promise<Observable<MessageEvent>> {
    const session = await this.cacheManager.get(`stream:${streamId}`);

    if (!session) {
      throw new NotFoundException('Stream session not found or expired');
    }

    // Delete from cache to prevent reuse
    await this.cacheManager.del(`stream:${streamId}`);

    return this.agentService
      .executeAgent(session.agentName, session.request)
      .pipe(
        map(chunk => ({
          type: 'message',
          data: JSON.stringify(chunk)
        }))
      );
  }
}
```

**Source:** [SSE with POST requests](https://medium.com/@kumar.gowtham/nestjs-server-sent-events-sse-and-its-use-cases-9f7316e78fa0)

### Manual SSE Implementation (More Control)

Bypass the `@Sse()` decorator for better error handling:

```typescript
@Controller('agents')
export class AgentController {
  @Get(':name/stream')
  async streamManual(
    @Param('name') agentName: string,
    @Res() res: Response
  ) {
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

    // Send initial connection message
    res.write('event: connected\n');
    res.write('data: {"status": "connected"}\n\n');

    try {
      const stream = await this.agentService.executeAgent(agentName);

      for await (const chunk of stream) {
        res.write(`event: message\n`);
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }

      // Send completion event
      res.write('event: done\n');
      res.write('data: {"status": "completed"}\n\n');
      res.end();
    } catch (error) {
      // Send error event
      res.write('event: error\n');
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    }

    // Handle client disconnect
    res.on('close', () => {
      console.log('Client disconnected');
    });
  }
}
```

**Source:** [Manual SSE implementation](https://sevic.dev/notes/sse-101/)

### Horizontal Scaling with Redis

For multi-instance deployments:

```typescript
import { Injectable } from '@nestjs/common';
import { RedisService } from '@nestjs-modules/ioredis';
import { fromEvent, Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable()
export class RedisSSEService {
  constructor(private redisService: RedisService) {}

  async publishToChannel(channel: string, data: any) {
    const redis = this.redisService.getClient();
    await redis.publish(channel, JSON.stringify(data));
  }

  subscribeToChannel(channel: string): Observable<MessageEvent> {
    const subscriber = this.redisService.getClient().duplicate();
    subscriber.subscribe(channel);

    return fromEvent(subscriber, 'message').pipe(
      map(([ch, message]) => ({
        type: 'message',
        data: message
      }))
    );
  }
}
```

**Source:** [Scalable SSE with Redis](https://iliabedian.com/blog/server-side-events-on-nestjs-emitting-events-to-clients)

### Client-Side SSE Usage

```typescript
// Browser client
const eventSource = new EventSource(
  '/v1/agents/my-agent/stream?workspace=ws1&user=user1'
);

eventSource.addEventListener('message', (event) => {
  const data = JSON.parse(event.data);
  console.log('Received:', data);
});

eventSource.addEventListener('error', (event) => {
  console.error('SSE error:', event);
  eventSource.close();
});

eventSource.addEventListener('done', () => {
  eventSource.close();
});
```

---

## 5. Authentication and Security

### JWT Bearer Token Authentication

For Claude Max credentials integration:

```typescript
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET,
    });
  }

  async validate(payload: any) {
    return {
      userId: payload.sub,
      email: payload.email,
      claudeMaxSubscription: payload.claudeMaxSubscription
    };
  }
}
```

**Source:** [NestJS JWT Authentication](https://docs.nestjs.com/security/authentication)

### Custom Guard for Claude Credentials

```typescript
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

@Injectable()
export class ClaudeAuthGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check for @Public() decorator
    const isPublic = this.reflector.get<boolean>(
      'isPublic',
      context.getHandler()
    );

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();

    // Check for Claude credentials
    const claudeCredsPath = path.join(os.homedir(), '.claude', 'credentials');

    if (!fs.existsSync(claudeCredsPath)) {
      throw new UnauthorizedException(
        'Claude credentials not found. Run `claude login`'
      );
    }

    try {
      const credentials = JSON.parse(
        fs.readFileSync(claudeCredsPath, 'utf-8')
      );

      // Validate credentials format
      if (!credentials.apiKey || !credentials.subscription) {
        throw new UnauthorizedException('Invalid Claude credentials');
      }

      // Attach credentials to request
      request.claudeCredentials = credentials;

      return true;
    } catch (error) {
      throw new UnauthorizedException('Failed to read Claude credentials');
    }
  }
}

// Public decorator for exempting routes
export const Public = () => SetMetadata('isPublic', true);

// Usage
@Controller('plugins')
@UseGuards(ClaudeAuthGuard)
export class PluginsController {
  @Get()
  @Public() // This route doesn't require auth
  listPlugins() {}

  @Post(':name/execute')
  // This route requires Claude auth
  executePlugin() {}
}
```

**Source:** [NestJS Guards](https://docs.nestjs.com/guards), [Public routes pattern](https://fintech.theodo.com/blog-posts/implementing-authentication-in-nestjs-using-passport-and-jwt)

### JWT Best Practices

1. **Keep secrets secure**: Store JWT secret in environment variables, never in code
2. **Set token expiration**: Short-lived tokens (15-60 minutes)
3. **Use HTTPS only**: Never send tokens over HTTP
4. **HTTP-only cookies**: For browser clients, prefer HTTP-only cookies over localStorage
5. **Implement refresh tokens**: Separate refresh token with longer expiration
6. **Token revocation**: Maintain blacklist for revoked tokens

```typescript
// JWT Module configuration
@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: {
        expiresIn: '15m', // Short-lived access token
        algorithm: 'HS256'
      }
    })
  ]
})
export class AuthModule {}
```

**Source:** [JWT Best Practices](https://blog.openreplay.com/jwt-authentication-best-practices/), [Secure REST API](https://blog.logrocket.com/secure-rest-api-jwt-authentication/)

### Rate Limiting

```typescript
import { ThrottlerModule } from '@nestjs/throttler';

@Module({
  imports: [
    ThrottlerModule.forRoot({
      ttl: 60,        // Time window in seconds
      limit: 10,      // Max requests per ttl
    })
  ]
})
export class AppModule {}

// Apply to specific routes
@Controller('agents')
@UseGuards(ThrottlerGuard)
export class AgentController {
  @Throttle(5, 60) // Override: 5 requests per 60 seconds
  @Post(':name/execute')
  executeAgent() {}
}
```

**Source:** [NestJS Throttler](https://docs.nestjs.com/security/rate-limiting)

---

## 6. Real-World Examples and References

### Example Projects

1. **NestJS Awesome List**
   - URL: https://github.com/nestjs/awesome-nestjs
   - Curated collection of NestJS resources, examples, and plugins

2. **NestJS Real World Example**
   - URL: https://github.com/lujakob/nestjs-realworld-example-app
   - Production-ready NestJS API with TypeORM/Prisma

3. **NestJS Project Structure**
   - URL: https://github.com/CatsMiaow/nestjs-project-structure
   - Best practices for organizing NestJS projects

4. **NestJS Monorepo Boilerplate**
   - URL: https://github.com/mikemajesty/nestjs-monorepo
   - Monorepo structure with observability, logging, and authentication

5. **NestJS Plugin Architecture Discussion**
   - URL: https://github.com/nestjs/nest/issues/3277
   - Community discussion on implementing plugin systems

**Source:** [Awesome NestJS](https://github.com/nestjs/awesome-nestjs)

### Plugin Architecture References

1. **Node.js Plugin Loader**
   - URL: https://github.com/bitgamma/plugin-loader
   - Dynamic plugin discovery and loading library

2. **Stateful Plugin System Guide**
   - URL: https://stateful.com/blog/build-a-plugin-system-with-node
   - Comprehensive guide to building plugin systems

3. **Plugin Architecture Patterns**
   - URL: https://www.n-school.com/plugin-based-architecture-in-node-js/
   - Expert guide on plugin-based architecture

**Source:** [Plugin patterns research](https://www.n-school.com/plugin-based-architecture-in-node-js/)

### Official Documentation

1. **NestJS Dynamic Modules**
   - URL: https://docs.nestjs.com/fundamentals/dynamic-modules
   - Official guide to creating dynamic modules

2. **NestJS Server-Sent Events**
   - URL: https://docs.nestjs.com/techniques/server-sent-events
   - Official SSE implementation guide

3. **NestJS Authentication**
   - URL: https://docs.nestjs.com/security/authentication
   - Official authentication and security guide

4. **NestJS Guards**
   - URL: https://docs.nestjs.com/guards
   - Official guide to implementing guards

---

## Recommended Implementation Plan

### Phase 1: Core Plugin System
1. Implement plugin discovery service (filesystem + node_modules)
2. Define plugin metadata schema and validation
3. Create plugin registry service
4. Implement basic plugin loading and caching

### Phase 2: REST API Endpoints
1. Implement single-route dispatch pattern (`/plugins/:name/:action`)
2. Create plugin gateway controller
3. Add HATEOAS links for discoverability
4. Implement versioning (v1)

### Phase 3: Streaming Support
1. Implement SSE endpoint for agent streaming
2. Add two-step pattern for POST + SSE
3. Implement connection management
4. Add error handling and client disconnect handling

### Phase 4: Authentication & Security
1. Implement Claude credentials guard
2. Add JWT authentication support
3. Implement rate limiting
4. Add plugin validation and sandboxing

### Phase 5: Production Features
1. Add Redis support for horizontal scaling
2. Implement plugin hot reloading
3. Add comprehensive logging and monitoring
4. Create developer documentation

---

## Key Takeaways

1. **Naming Convention**: Use `claude-agent-plugin-<name>` pattern for npm packages
2. **Discovery**: Support both filesystem (dev) and node_modules (production) discovery
3. **Dynamic Routes**: Use single-route dispatch pattern for simplicity
4. **SSE for Streaming**: Perfect for Claude agent responses, use two-step pattern for POST data
5. **Authentication**: Custom guard for ~/.claude credentials + JWT for API tokens
6. **Security**: Validate plugins, namespace outputs, implement rate limiting
7. **Scalability**: Redis for horizontal scaling, event-driven architecture for plugin communication
8. **Developer Experience**: HATEOAS for discoverability, comprehensive error handling

---

## Sources

### NestJS Official Documentation
- [NestJS Modules](https://docs.nestjs.com/modules)
- [Dynamic Modules](https://docs.nestjs.com/fundamentals/dynamic-modules)
- [Server-Sent Events](https://docs.nestjs.com/techniques/server-sent-events)
- [Authentication](https://docs.nestjs.com/security/authentication)
- [Passport Recipe](https://docs.nestjs.com/recipes/passport)

### Plugin Architecture
- [Plugin Loader (GitHub)](https://github.com/bitgamma/plugin-loader)
- [Build a Plugin System with Node.js](https://stateful.com/blog/build-a-plugin-system-with-node)
- [Plugin-Based Architecture in Node.js](https://www.n-school.com/plugin-based-architecture-in-node-js/)
- [Node.js Advanced Patterns: Plugin Manager](https://v-checha.medium.com/node-js-advanced-patterns-plugin-manager-44adb72aa6bb)
- [Plugin Architecture in JavaScript](https://www.adaltas.com/en/2020/08/28/node-js-plugin-architecture/)

### Dynamic Routes
- [NestJS Issue #1438](https://github.com/nestjs/nest/issues/1438)
- [Dynamic Routes Gist](https://gist.github.com/faboulaws/9cfa959baa2b7bcf9d77cbb2a750ae91)
- [Dynamic Imports in NestJS](https://www.bithost.in/blog/tech-2/enhancing-nest-js-application-with-dynamic-imports-and-dynamic-routes-34)
- [Dynamic NestJS Listeners](https://dev.to/this-is-learning/dynamic-nestjs-listeners-discover-the-power-of-lazy-loading-53i2)

### Server-Sent Events
- [SSE with NestJS and Angular](https://medium.com/@piotrkorowicki/server-sent-events-sse-with-nestjs-and-angular-d90635783d8c)
- [NestJS SSE Use Cases](https://medium.com/@kumar.gowtham/nestjs-server-sent-events-sse-and-its-use-cases-9f7316e78fa0)
- [Real-Time Communication with SSE](https://devkamal.medium.com/real-time-communication-made-simple-building-server-sent-events-sse-with-nestjs-f6a8f5715d18)
- [SSE on NestJS](https://iliabedian.com/blog/server-side-events-on-nestjs-emitting-events-to-clients)
- [SSE 101](https://sevic.dev/notes/sse-101/)

### Authentication & Security
- [JWT Authentication in NestJS](https://fintech.theodo.com/blog-posts/implementing-authentication-in-nestjs-using-passport-and-jwt)
- [Secure REST API with JWT](https://blog.logrocket.com/secure-rest-api-jwt-authentication/)
- [JWT Best Practices](https://blog.openreplay.com/jwt-authentication-best-practices/)
- [Bearer Token in Node.js](https://apidog.com/blog/bearer-token-nodejs-express/)
- [Advanced Authentication in NestJS](https://bhargavacharyb.medium.com/nestjs-12-advanced-authentication-in-nestjs-with-passport-js-65d221aa16b2)

### API Design
- [REST API Extensibility](https://www.linkedin.com/advice/3/how-can-you-design-restful-api-maximum-lrv7e)
- [API Design Patterns](https://microservice-api-patterns.org/)
- [Azure API Design Best Practices](https://learn.microsoft.com/en-us/azure/architecture/best-practices/api-design)
- [Beyond REST: API Design Patterns](https://treblle.com/blog/beyond-rest-common-api-design-patterns-and-when-you-will-need-them-2)

### Plugin Discovery
- [ESLint Plugin Naming](https://eslint.org/docs/latest/extend/plugins)
- [npm package.json](https://docs.npmjs.com/cli/v7/configuring-npm/package-json/)
- [Node.js Packages](https://nodejs.org/api/packages.html)

### Example Projects
- [Awesome NestJS](https://github.com/nestjs/awesome-nestjs)
- [NestJS Real World Example](https://github.com/lujakob/nestjs-realworld-example-app)
- [NestJS Project Structure](https://github.com/CatsMiaow/nestjs-project-structure)
- [NestJS Monorepo](https://github.com/mikemajesty/nestjs-monorepo)
- [Plugin Architecture Discussion](https://github.com/nestjs/nest/issues/3277)
