import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Inject } from '@nestjs/common';
import PgBoss from 'pg-boss';
import { QUEUE_MODULE_OPTIONS } from './queue.tokens.js';
import type { QueueModuleOptions } from '../types/queue.types.js';

/**
 * Service wrapping pg-boss for job queue management.
 * Handles connection lifecycle and provides typed methods for queue operations.
 */
@Injectable()
export class PgBossService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PgBossService.name);
  private boss: PgBoss | null = null;

  constructor(
    @Inject(QUEUE_MODULE_OPTIONS) private readonly options: QueueModuleOptions,
  ) {}

  async onModuleInit() {
    this.logger.log('Initializing pg-boss connection...');

    this.boss = new PgBoss({
      connectionString: this.options.connectionString,
      schema: this.options.pgBossOptions?.schema ?? 'pgboss',
      application_name: this.options.pgBossOptions?.application_name ?? 'claude-agent-queue',
      archiveCompletedAfterSeconds: this.options.pgBossOptions?.archiveCompletedAfterSeconds ?? 60 * 60, // 1 hour
      deleteAfterSeconds: this.options.pgBossOptions?.deleteAfterSeconds ?? 60 * 60 * 24 * 7, // 7 days
    });

    // Handle errors
    this.boss.on('error', (error) => {
      this.logger.error(`pg-boss error: ${error.message}`, error.stack);
    });

    await this.boss.start();
    this.logger.log('pg-boss started successfully');
  }

  async onModuleDestroy() {
    if (this.boss) {
      this.logger.log('Stopping pg-boss...');
      await this.boss.stop({ graceful: true, timeout: 30000 });
      this.logger.log('pg-boss stopped');
    }
  }

  /**
   * Get the underlying pg-boss instance.
   */
  getInstance(): PgBoss {
    if (!this.boss) {
      throw new Error('pg-boss is not initialized');
    }
    return this.boss;
  }

  /**
   * Publish a job to a queue.
   */
  async send<T extends object>(queueName: string, data: T, options?: PgBoss.SendOptions): Promise<string | null> {
    if (options) {
      return this.getInstance().send(queueName, data, options);
    }
    return this.getInstance().send(queueName, data);
  }

  /**
   * Subscribe to a queue and process jobs.
   * The handler receives jobs one at a time (batchSize: 1).
   */
  async work<T extends object>(
    queueName: string,
    handler: (job: PgBoss.Job<T>) => Promise<void>,
    options?: PgBoss.WorkOptions,
  ): Promise<string> {
    // pg-boss v10 always passes an array of jobs to the handler
    const batchHandler = async (jobs: PgBoss.Job<T>[]) => {
      for (const job of jobs) {
        await handler(job);
      }
    };
    return this.getInstance().work<T>(queueName, options ?? {}, batchHandler);
  }

  /**
   * Fetch a single job from a queue (for approval waiting).
   * Returns the first job if any exist, otherwise null.
   */
  async fetch<T extends object>(queueName: string): Promise<PgBoss.Job<T> | null> {
    const jobs = await this.getInstance().fetch<T>(queueName);
    return jobs.length > 0 ? jobs[0] : null;
  }

  /**
   * Complete a job.
   */
  async complete(queueName: string, jobId: string, data?: object): Promise<void> {
    if (data) {
      await this.getInstance().complete(queueName, jobId, data);
    } else {
      await this.getInstance().complete(queueName, jobId);
    }
  }

  /**
   * Fail a job.
   */
  async fail(queueName: string, jobId: string, data?: object): Promise<void> {
    if (data) {
      await this.getInstance().fail(queueName, jobId, data);
    } else {
      await this.getInstance().fail(queueName, jobId);
    }
  }

  /**
   * Create a queue if it doesn't exist.
   */
  async createQueue(queueName: string): Promise<void> {
    await this.getInstance().createQueue(queueName);
  }

  /**
   * Delete a queue.
   */
  async deleteQueue(queueName: string): Promise<void> {
    await this.getInstance().deleteQueue(queueName);
  }

  /**
   * Get the list of agent queue names based on configured agents.
   */
  getAgentQueueNames(): string[] {
    return Object.keys(this.options.agents).map(
      (agentName) => `claude.agents.${agentName}.requests`,
    );
  }
}
