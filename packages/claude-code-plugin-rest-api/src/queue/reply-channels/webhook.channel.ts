import { Logger } from '@nestjs/common';
import { BaseReplyChannel, type ReplyMessage } from './reply-channel.interface.js';
import type { ReplyChannelFactory } from './channel-resolver.service.js';

/**
 * Reply channel that sends responses to a webhook URL.
 *
 * URI format: webhook://https://example.com/callback
 *
 * The URL after webhook:// is the full webhook URL to POST to.
 *
 * Example:
 *   replyTo: "webhook://https://api.example.com/agent-callback"
 *   -> POSTs message to https://api.example.com/agent-callback
 */
export class WebhookReplyChannel extends BaseReplyChannel {
  private readonly logger = new Logger(WebhookReplyChannel.name);

  private readonly defaultHeaders: Record<string, string>;
  private readonly timeout: number;
  private readonly webhookUrl: string;

  constructor(
    uri: string,
    options?: {
      headers?: Record<string, string>;
      timeout?: number;
    },
  ) {
    super();
    this.defaultHeaders = {
      'Content-Type': 'application/json',
      ...options?.headers,
    };
    this.timeout = options?.timeout ?? 30000;

    // Extract the actual URL from the webhook:// URI
    // URI format: webhook://https://example.com/path
    this.webhookUrl = uri.replace(/^webhook:\/\//, '');

    if (!this.webhookUrl) {
      throw new Error('Webhook URL is required in webhook:// URI');
    }
  }

  matches(uri: string): boolean {
    return uri.toLowerCase().startsWith('webhook://');
  }

  async send(message: ReplyMessage): Promise<void> {
    this.logger.debug(`Sending response to webhook: ${this.webhookUrl}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: this.defaultHeaders,
        body: JSON.stringify(message),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => 'Unknown error');
        throw new Error(`Webhook request failed: ${response.status} ${response.statusText} - ${body}`);
      }

      this.logger.debug(`Webhook response: ${response.status} ${response.statusText}`);
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Webhook request timed out after ${this.timeout}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Factory for creating WebhookReplyChannel instances.
 */
export class WebhookReplyChannelFactory implements ReplyChannelFactory {
  constructor(
    private readonly options?: {
      headers?: Record<string, string>;
      timeout?: number;
    },
  ) {}

  matches(uri: string): boolean {
    return uri.toLowerCase().startsWith('webhook://');
  }

  create(uri: string): WebhookReplyChannel {
    return new WebhookReplyChannel(uri, this.options);
  }
}

/**
 * Create a WebhookReplyChannelFactory with custom options.
 */
export function createWebhookReplyChannel(options?: {
  headers?: Record<string, string>;
  timeout?: number;
}): WebhookReplyChannelFactory {
  return new WebhookReplyChannelFactory(options);
}
