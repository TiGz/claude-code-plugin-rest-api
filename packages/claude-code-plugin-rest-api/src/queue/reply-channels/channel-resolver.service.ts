import { Injectable, Inject, Logger } from '@nestjs/common';
import { REPLY_CHANNELS } from '../queue.tokens.js';
import type { ReplyChannel, ReplyMessage } from '../../types/queue.types.js';

/**
 * A factory that can create ReplyChannel instances for matching URIs.
 */
export interface ReplyChannelFactory {
  matches(uri: string): boolean;
  create(uri: string): ReplyChannel;
}

/**
 * Service for resolving reply channels from URIs.
 * Uses factories to create channel instances with URI-specific configuration.
 */
@Injectable()
export class ChannelResolverService {
  private readonly logger = new Logger(ChannelResolverService.name);
  private readonly factories: ReplyChannelFactory[];

  constructor(
    @Inject(REPLY_CHANNELS) factories: Record<string, ReplyChannelFactory>,
  ) {
    this.factories = Object.values(factories);
    this.logger.log(`Registered ${this.factories.length} reply channel factories`);
  }

  /**
   * Resolve a replyTo URI to a reply channel.
   * Creates a new channel instance with the URI configuration.
   * @throws Error if no matching factory is found
   */
  resolve(replyTo: string): ReplyChannel {
    const factory = this.factories.find((f) => f.matches(replyTo));

    if (!factory) {
      throw new Error(`No reply channel factory found for URI: ${replyTo}`);
    }

    return factory.create(replyTo);
  }

  /**
   * Check if a replyTo URI can be resolved to a channel.
   */
  canResolve(replyTo: string): boolean {
    return this.factories.some((f) => f.matches(replyTo));
  }

  /**
   * Send a message to a replyTo URI.
   * Convenience method that resolves and sends in one step.
   */
  async send(replyTo: string, message: ReplyMessage): Promise<void> {
    const channel = this.resolve(replyTo);
    await channel.send(message);
  }
}
