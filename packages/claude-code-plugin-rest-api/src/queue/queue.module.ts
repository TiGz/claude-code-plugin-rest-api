import { Module, DynamicModule, Provider, Logger } from '@nestjs/common';
import { PgBossService } from './pgboss.service.js';
import { AsyncWorkerService } from './async-worker.service.js';
import { ChannelResolverService } from './reply-channels/channel-resolver.service.js';
import { HITLService } from './hitl.service.js';
import {
  QUEUE_MODULE_OPTIONS,
  QUEUE_AGENT_CONFIG,
  REPLY_CHANNELS,
} from './queue.tokens.js';
import type {
  QueueModuleOptions,
  QueueModuleAsyncOptions,
  ReplyChannel,
} from '../types/queue.types.js';
import type { AgentConfig, HITLConfig } from '../types/plugin.types.js';

type AgentConfigWithHITL = AgentConfig & { hitl?: HITLConfig };

/**
 * QueueModule - Async agent processing via pg-boss queues.
 *
 * Provides:
 * - Background job processing for agent requests
 * - Session management for multi-turn conversations
 * - Human-in-the-Loop (HITL) approval workflows
 * - Extensible reply channels for response delivery
 *
 * @example
 * ```typescript
 * import { QueueModule, defineAgent } from '@tigz/claude-code-plugin-rest-api';
 *
 * const deployBot = defineAgent({
 *   systemPrompt: 'You deploy to production.',
 *   permissionMode: 'bypassPermissions',
 *   hitl: {
 *     requireApproval: ['Bash:*deploy*'],
 *     approvalTimeoutMs: 300_000,
 *   },
 * });
 *
 * @Module({
 *   imports: [
 *     QueueModule.forRoot({
 *       connectionString: process.env.DATABASE_URL,
 *       agents: { 'deploy-bot': deployBot },
 *       replyChannels: {
 *         slack: new SlackReplyChannel({ ... }),
 *       },
 *     }),
 *   ],
 * })
 * export class AppModule {}
 * ```
 */
@Module({})
export class QueueModule {
  private static readonly logger = new Logger(QueueModule.name);

  /**
   * Configure the QueueModule with options.
   */
  static forRoot(options: QueueModuleOptions): DynamicModule {
    const providers = this.createProviders(options);

    return {
      module: QueueModule,
      providers,
      exports: [
        PgBossService,
        AsyncWorkerService,
        ChannelResolverService,
        HITLService,
      ],
    };
  }

  /**
   * Configure the QueueModule asynchronously.
   */
  static forRootAsync(options: QueueModuleAsyncOptions): DynamicModule {
    const providers = this.createAsyncProviders(options);

    return {
      module: QueueModule,
      imports: options.imports ?? [],
      providers,
      exports: [
        PgBossService,
        AsyncWorkerService,
        ChannelResolverService,
        HITLService,
      ],
    };
  }

  private static createProviders(options: QueueModuleOptions): Provider[] {
    // Extract agents config and ensure it's properly typed
    const agents = this.extractAgents(options);

    // Create default reply channels if not provided
    const replyChannels: Record<string, ReplyChannel> = options.replyChannels ?? {};

    return [
      {
        provide: QUEUE_MODULE_OPTIONS,
        useValue: options,
      },
      {
        provide: QUEUE_AGENT_CONFIG,
        useValue: agents,
      },
      {
        provide: REPLY_CHANNELS,
        useValue: replyChannels,
      },
      PgBossService,
      ChannelResolverService,
      HITLService,
      AsyncWorkerService,
    ];
  }

  private static createAsyncProviders(options: QueueModuleAsyncOptions): Provider[] {
    return [
      {
        provide: QUEUE_MODULE_OPTIONS,
        useFactory: options.useFactory,
        inject: options.inject ?? [],
      },
      {
        provide: QUEUE_AGENT_CONFIG,
        useFactory: (moduleOptions: QueueModuleOptions) => {
          return this.extractAgents(moduleOptions);
        },
        inject: [QUEUE_MODULE_OPTIONS],
      },
      {
        provide: REPLY_CHANNELS,
        useFactory: (moduleOptions: QueueModuleOptions) => {
          return moduleOptions.replyChannels ?? {};
        },
        inject: [QUEUE_MODULE_OPTIONS],
      },
      PgBossService,
      ChannelResolverService,
      HITLService,
      AsyncWorkerService,
    ];
  }

  /**
   * Extract agent configurations from options.
   */
  private static extractAgents(
    options: QueueModuleOptions,
  ): Record<string, AgentConfigWithHITL> {
    const agents: Record<string, AgentConfigWithHITL> = {};

    for (const [name, config] of Object.entries(options.agents)) {
      agents[name] = config as AgentConfigWithHITL;
    }

    this.logger.log(`Configured ${Object.keys(agents).length} agents for queue processing`);

    return agents;
  }
}
