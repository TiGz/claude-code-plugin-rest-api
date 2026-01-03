import type { ReplyMessage, ReplyChannel } from '../../types/queue.types.js';

// Re-export the interface for convenience
export type { ReplyChannel, ReplyMessage };

/**
 * Abstract base class for reply channels.
 * Provides common functionality and enforces the ReplyChannel interface.
 */
export abstract class BaseReplyChannel implements ReplyChannel {
  /**
   * Check if this channel handles the given URI.
   * Typically checks the URI scheme.
   */
  abstract matches(uri: string): boolean;

  /**
   * Send a message via this channel.
   */
  abstract send(message: ReplyMessage): Promise<void>;

  /**
   * Parse a replyTo URI into its components.
   */
  protected parseUri(uri: string): { scheme: string; path: string; query: URLSearchParams } {
    // Handle custom schemes by replacing with https for URL parsing
    const match = uri.match(/^([a-z0-9-]+):\/\/(.+)$/i);
    if (!match) {
      throw new Error(`Invalid replyTo URI: ${uri}`);
    }

    const [, scheme, rest] = match;
    const url = new URL(`https://${rest}`);

    return {
      scheme: scheme.toLowerCase(),
      path: url.pathname,
      query: url.searchParams,
    };
  }
}
