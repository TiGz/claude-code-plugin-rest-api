import { Logger } from '@nestjs/common';
import { BaseReplyChannel, type ReplyMessage } from './reply-channel.interface.js';
import type { PgBossService } from '../pgboss.service.js';
import type { ReplyChannelFactory } from './channel-resolver.service.js';

/**
 * Reply channel that sends responses to a pg-boss queue.
 *
 * URI format: queue://queue-name
 *
 * Example:
 *   replyTo: "queue://my-response-queue"
 *   -> Publishes message to pg-boss queue "my-response-queue"
 */
export class QueueReplyChannel extends BaseReplyChannel {
  private readonly logger = new Logger(QueueReplyChannel.name);
  private queueName: string;

  constructor(
    private readonly pgBoss: PgBossService,
    uri: string,
  ) {
    super();
    const { path } = this.parseUri(uri);
    // Extract queue name from path (remove leading slash)
    this.queueName = path.replace(/^\//, '');

    if (!this.queueName) {
      throw new Error('Queue name is required in queue:// URI');
    }
  }

  matches(uri: string): boolean {
    return uri.toLowerCase().startsWith('queue://');
  }

  async send(message: ReplyMessage): Promise<void> {
    this.logger.debug(`Sending response to queue: ${this.queueName}`);
    // Cast message to object since ReplyMessage is already an object type
    await this.pgBoss.send(this.queueName, message as unknown as object);
  }
}

/**
 * Factory for creating QueueReplyChannel instances.
 */
export class QueueReplyChannelFactory implements ReplyChannelFactory {
  constructor(private readonly pgBoss: PgBossService) {}

  matches(uri: string): boolean {
    return uri.toLowerCase().startsWith('queue://');
  }

  create(uri: string): QueueReplyChannel {
    return new QueueReplyChannel(this.pgBoss, uri);
  }
}

/**
 * Factory function to create a QueueReplyChannelFactory.
 * Used when the PgBossService is injected.
 */
export function createQueueReplyChannel(pgBoss: PgBossService): QueueReplyChannelFactory {
  return new QueueReplyChannelFactory(pgBoss);
}
