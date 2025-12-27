import { Module, DynamicModule, Provider, InjectionToken, OptionalFactoryDependency, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { APP_GUARD } from '@nestjs/core';
import { PluginDiscoveryService, PLUGIN_DISCOVERY_OPTIONS } from './services/plugin-discovery.service.js';
import { PluginExecutionService, PLUGIN_EXECUTION_OPTIONS } from './services/plugin-execution.service.js';
import { StreamSessionService } from './services/stream-session.service.js';
import { AgentService, AGENT_CONFIG } from './services/agent.service.js';
import { PluginController, StreamController } from './controllers/plugin.controller.js';
import { AgentController } from './controllers/agent.controller.js';
import { WebhookController } from './controllers/webhook.controller.js';
import { BasicAuthGuard } from './auth/auth.guard.js';
import { YamlAuthProvider } from './auth/yaml-auth.provider.js';
import { AuthModuleOptions, AUTH_OPTIONS, AUTH_PROVIDER } from './auth/auth.types.js';
import { AgentConfig } from './types/plugin.types.js';

export interface ClaudePluginModuleOptions {
  /**
   * Enable plugin discovery and plugin-related endpoints (/v1/plugins/*)
   * When false, only user-defined agents are available via /v1/agents/*
   * @default false
   */
  enablePluginEndpoints?: boolean;

  /**
   * Directory containing Claude Code plugins
   * Only used when enablePluginEndpoints is true
   * @default '.claude/plugins'
   */
  pluginDirectory?: string;

  /**
   * Enable hot reload of plugins when files change
   * Only used when enablePluginEndpoints is true
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

  /**
   * Authentication configuration
   * Set to { disabled: true } to disable built-in auth
   */
  auth?: AuthModuleOptions;

  /**
   * User-defined agents with full SDK options.
   * Each agent gets exposed via /v1/agents/:name endpoint.
   *
   * @example
   * ```typescript
   * agents: {
   *   'uber-agent': {
   *     systemPrompt: 'You have full access to all tools.',
   *     permissionMode: 'bypassPermissions',
   *     tools: { type: 'preset', preset: 'claude_code' },
   *   }
   * }
   * ```
   */
  agents?: Record<string, AgentConfig>;
}

const CLAUDE_PLUGIN_OPTIONS = 'CLAUDE_PLUGIN_OPTIONS';

@Module({})
export class ClaudePluginModule implements OnModuleInit {
  constructor(private moduleRef: ModuleRef) {}

  async onModuleInit() {
    // Wire up AgentService to StreamController for streaming user-defined agents
    try {
      const streamController = this.moduleRef.get(StreamController, { strict: false });
      const agentService = this.moduleRef.get(AgentService, { strict: false });
      if (streamController && agentService) {
        streamController.setAgentService(agentService);
      }
    } catch {
      // AgentService may not be registered if no agents configured
    }
  }

  /**
   * Configure the Claude Plugin module with options
   */
  static forRoot(options: ClaudePluginModuleOptions = {}): DynamicModule {
    const enablePluginEndpoints = options.enablePluginEndpoints ?? false;
    const resolvedOptions = {
      enablePluginEndpoints,
      pluginDirectory: options.pluginDirectory ?? '.claude/plugins',
      hotReload: options.hotReload ?? false,
      maxTurns: options.maxTurns ?? 50,
      maxBudgetUsd: options.maxBudgetUsd ?? 10.0,
      routePrefix: options.routePrefix ?? 'v1',
      includeControllers: options.includeControllers ?? true,
    };

    const optionsProvider: Provider = {
      provide: CLAUDE_PLUGIN_OPTIONS,
      useValue: resolvedOptions,
    };

    // Determine which controllers to include
    const hasAgents = options.agents && Object.keys(options.agents).length > 0;
    const controllers: any[] = [];
    if (resolvedOptions.includeControllers) {
      // Always include StreamController (used by both agents and plugins)
      controllers.push(StreamController);
      // Always include WebhookController for GitOps reload trigger
      controllers.push(WebhookController);
      // Include AgentController if agents are configured
      if (hasAgents) {
        controllers.push(AgentController);
      }
      // Include PluginController only if plugin endpoints are enabled
      if (enablePluginEndpoints) {
        controllers.push(PluginController);
      }
    }

    // Auth configuration
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

    // Agent providers (only if agents are configured)
    const agentProviders: Provider[] = hasAgents
      ? [
          {
            provide: AGENT_CONFIG,
            useValue: options.agents || {},
          },
          AgentService,
        ]
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
        ...authProviders,
        ...agentProviders,
        {
          provide: PLUGIN_DISCOVERY_OPTIONS,
          useValue: {
            pluginDirectory: resolvedOptions.pluginDirectory,
            hotReload: resolvedOptions.hotReload,
          },
        },
        {
          provide: PLUGIN_EXECUTION_OPTIONS,
          useValue: {
            maxTurns: resolvedOptions.maxTurns,
            maxBudgetUsd: resolvedOptions.maxBudgetUsd,
          },
        },
        PluginDiscoveryService,
        PluginExecutionService,
        StreamSessionService,
      ],
      exports: [
        PluginDiscoveryService,
        PluginExecutionService,
        StreamSessionService,
        ...(hasAgents ? [AgentService] : []),
        CLAUDE_PLUGIN_OPTIONS,
      ],
      global: true,
    };
  }

  /**
   * Configure the module asynchronously (e.g., from ConfigService)
   */
  static forRootAsync(asyncOptions: {
    useFactory: (...args: any[]) => ClaudePluginModuleOptions | Promise<ClaudePluginModuleOptions>;
    inject?: (InjectionToken | OptionalFactoryDependency)[];
    imports?: any[];
  }): DynamicModule {
    const optionsProvider: Provider = {
      provide: CLAUDE_PLUGIN_OPTIONS,
      useFactory: async (...args: unknown[]) => {
        const opts = await asyncOptions.useFactory(...args);
        return {
          enablePluginEndpoints: opts.enablePluginEndpoints ?? false,
          pluginDirectory: opts.pluginDirectory ?? '.claude/plugins',
          hotReload: opts.hotReload ?? false,
          maxTurns: opts.maxTurns ?? 50,
          maxBudgetUsd: opts.maxBudgetUsd ?? 10.0,
          routePrefix: opts.routePrefix ?? 'v1',
          includeControllers: opts.includeControllers ?? true,
        };
      },
      inject: asyncOptions.inject || [],
    };

    // For async, we need to handle auth options dynamically
    const authOptionsProvider: Provider = {
      provide: AUTH_OPTIONS,
      useFactory: async (...args: unknown[]) => {
        const opts = await asyncOptions.useFactory(...args);
        return {
          disabled: opts.auth?.disabled ?? false,
          excludePaths: opts.auth?.excludePaths ?? ['/health', '/api/docs*'],
          authFilePath: opts.auth?.authFilePath ?? 'auth.yml',
        };
      },
      inject: asyncOptions.inject || [],
    };

    const authProvider: Provider = {
      provide: AUTH_PROVIDER,
      useFactory: async (...args: unknown[]) => {
        const opts = await asyncOptions.useFactory(...args);
        if (opts.auth?.provider) {
          return opts.auth.provider;
        }
        return new YamlAuthProvider(opts.auth?.authFilePath ?? 'auth.yml');
      },
      inject: asyncOptions.inject || [],
    };

    const discoveryOptionsProvider: Provider = {
      provide: PLUGIN_DISCOVERY_OPTIONS,
      useFactory: async (...args: unknown[]) => {
        const opts = await asyncOptions.useFactory(...args);
        return {
          pluginDirectory: opts.pluginDirectory ?? '.claude/plugins',
          hotReload: opts.hotReload ?? false,
        };
      },
      inject: asyncOptions.inject || [],
    };

    const executionOptionsProvider: Provider = {
      provide: PLUGIN_EXECUTION_OPTIONS,
      useFactory: async (...args: unknown[]) => {
        const opts = await asyncOptions.useFactory(...args);
        return {
          maxTurns: opts.maxTurns ?? 50,
          maxBudgetUsd: opts.maxBudgetUsd ?? 10.0,
        };
      },
      inject: asyncOptions.inject || [],
    };

    // Agent config provider for async usage
    const agentConfigProvider: Provider = {
      provide: AGENT_CONFIG,
      useFactory: async (...args: unknown[]) => {
        const opts = await asyncOptions.useFactory(...args);
        return opts.agents || {};
      },
      inject: asyncOptions.inject || [],
    };

    return {
      module: ClaudePluginModule,
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        EventEmitterModule.forRoot(),
        ...(asyncOptions.imports as DynamicModule[] || []),
      ],
      // For async config, all controllers are included since we can't determine
      // enablePluginEndpoints at module registration time. Use forRoot() for
      // static configuration if you need to disable plugin endpoints.
      controllers: [PluginController, StreamController, AgentController, WebhookController],
      providers: [
        optionsProvider,
        authOptionsProvider,
        authProvider,
        {
          provide: APP_GUARD,
          useClass: BasicAuthGuard,
        },
        discoveryOptionsProvider,
        executionOptionsProvider,
        agentConfigProvider,
        PluginDiscoveryService,
        PluginExecutionService,
        StreamSessionService,
        AgentService,
      ],
      exports: [
        PluginDiscoveryService,
        PluginExecutionService,
        StreamSessionService,
        AgentService,
        CLAUDE_PLUGIN_OPTIONS,
      ],
      global: true,
    };
  }
}
