import { Module, DynamicModule, Provider, InjectionToken, OptionalFactoryDependency } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { APP_GUARD } from '@nestjs/core';
import { PluginDiscoveryService, PLUGIN_DISCOVERY_OPTIONS } from './services/plugin-discovery.service.js';
import { PluginExecutionService, PLUGIN_EXECUTION_OPTIONS } from './services/plugin-execution.service.js';
import { StreamSessionService } from './services/stream-session.service.js';
import { PluginController, StreamController } from './controllers/plugin.controller.js';
import { FilesController } from './controllers/files.controller.js';
import { BasicAuthGuard } from './auth/auth.guard.js';
import { YamlAuthProvider } from './auth/yaml-auth.provider.js';
import { AuthModuleOptions, AUTH_OPTIONS, AUTH_PROVIDER } from './auth/auth.types.js';

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

  /**
   * Authentication configuration
   * Set to { disabled: true } to disable built-in auth
   */
  auth?: AuthModuleOptions;
}

const CLAUDE_PLUGIN_OPTIONS = 'CLAUDE_PLUGIN_OPTIONS';

@Module({})
export class ClaudePluginModule {
  /**
   * Configure the Claude Plugin module with options
   */
  static forRoot(options: ClaudePluginModuleOptions = {}): DynamicModule {
    const resolvedOptions = {
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

    const controllers = resolvedOptions.includeControllers
      ? [PluginController, StreamController, FilesController]
      : [];

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

    return {
      module: ClaudePluginModule,
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        EventEmitterModule.forRoot(),
        ...(asyncOptions.imports as DynamicModule[] || []),
      ],
      controllers: [PluginController, StreamController, FilesController],
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
        PluginDiscoveryService,
        PluginExecutionService,
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
