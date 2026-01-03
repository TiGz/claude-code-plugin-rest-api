import { Injectable, Logger, Inject } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PgBossService } from './pgboss.service.js';
import { QUEUE_MODULE_OPTIONS } from './queue.tokens.js';
import type { ReplyChannel } from '../types/queue.types.js';
import type { HITLConfig, AgentConfig } from '../types/plugin.types.js';
import type {
  AsyncAgentRequest,
  ApprovalDecision,
  ApprovalRequestMessage,
  ToolApprovalInfo,
} from '../types/queue.types.js';

/**
 * Result from the canUseTool callback.
 */
export interface ToolApprovalResult {
  behavior: 'allow' | 'deny' | 'abort';
  message?: string;
  updatedInput?: unknown;
}

/**
 * Service for Human-in-the-Loop tool approval.
 * Handles pattern matching, approval requests, and waiting for decisions.
 */
@Injectable()
export class HITLService {
  private readonly logger = new Logger(HITLService.name);

  constructor(
    private readonly pgBoss: PgBossService,
    @Inject(QUEUE_MODULE_OPTIONS) private readonly options: { defaultHitl?: { approvalTimeoutMs?: number; onTimeout?: 'deny' | 'abort' } },
  ) {}

  /**
   * Check if a tool matches any of the given patterns.
   * Patterns support wildcards: 'Bash:*deploy*', 'Bash:kubectl*', 'Edit:*'
   */
  matchesPattern(toolName: string, patterns: string[] | undefined): boolean {
    if (!patterns || patterns.length === 0) {
      return false;
    }

    return patterns.some((pattern) => this.matchSinglePattern(toolName, pattern));
  }

  /**
   * Match a tool name against a single pattern.
   * Supports * as a wildcard for any characters.
   */
  private matchSinglePattern(toolName: string, pattern: string): boolean {
    // Convert pattern to regex
    // Escape regex special characters except *
    const regexPattern = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');

    const regex = new RegExp(`^${regexPattern}$`, 'i');
    return regex.test(toolName);
  }

  /**
   * Create a canUseTool callback for HITL approval.
   * Returns null if no HITL is configured for this agent.
   */
  createApprovalHandler(
    config: AgentConfig & { hitl?: HITLConfig },
    request: AsyncAgentRequest,
    channel: ReplyChannel,
  ): ((toolName: string, input: unknown) => Promise<ToolApprovalResult>) | null {
    const hitl = config.hitl;

    if (!hitl) {
      return null;
    }

    return async (toolName: string, input: unknown): Promise<ToolApprovalResult> => {
      // Check auto-approve first (takes precedence)
      if (this.matchesPattern(toolName, hitl.autoApprove)) {
        this.logger.debug(`Tool '${toolName}' auto-approved for request ${request.correlationId}`);
        return { behavior: 'allow', updatedInput: input };
      }

      // Check if tool requires approval
      if (!this.matchesPattern(toolName, hitl.requireApproval)) {
        return { behavior: 'allow', updatedInput: input };
      }

      this.logger.log(`Tool '${toolName}' requires approval for request ${request.correlationId}`);

      // Send approval request via reply channel
      const approvalId = randomUUID();
      const approvalQueueName = `claude.approvals.${request.correlationId}`;
      const timeoutMs = hitl.approvalTimeoutMs ?? this.options.defaultHitl?.approvalTimeoutMs ?? 300_000;
      const onTimeout = hitl.onTimeout ?? this.options.defaultHitl?.onTimeout ?? 'deny';

      const approvalRequest: ApprovalRequestMessage = {
        type: 'approval_request',
        correlationId: request.correlationId,
        origin: request.origin,
        payload: {
          approvalId,
          tool: { name: toolName, input },
          expiresAt: new Date(Date.now() + timeoutMs).toISOString(),
          approvalQueueName,
        },
      };

      await channel.send(approvalRequest);

      // Wait for approval decision
      try {
        const decision = await this.waitForApproval(approvalQueueName, timeoutMs);

        this.logger.log(`Approval decision for ${toolName}: ${decision.decision}`);

        if (decision.decision === 'approve') {
          return {
            behavior: 'allow',
            updatedInput: decision.updatedInput ?? input,
          };
        } else if (decision.decision === 'deny') {
          return {
            behavior: 'deny',
            message: decision.reason ?? 'Tool use denied by approver',
          };
        } else {
          return {
            behavior: 'abort',
            message: decision.reason ?? 'Execution aborted by approver',
          };
        }
      } catch (error) {
        const err = error as Error;
        if (err.message === 'Approval timeout') {
          this.logger.warn(`Approval timeout for tool '${toolName}' in request ${request.correlationId}`);

          if (onTimeout === 'deny') {
            return {
              behavior: 'deny',
              message: `Approval timed out after ${timeoutMs / 1000} seconds`,
            };
          } else {
            return {
              behavior: 'abort',
              message: `Execution aborted: approval timed out after ${timeoutMs / 1000} seconds`,
            };
          }
        }
        throw error;
      }
    };
  }

  /**
   * Wait for an approval decision on the specified queue.
   * Times out after the specified duration.
   */
  private async waitForApproval(queueName: string, timeoutMs: number): Promise<ApprovalDecision> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Approval timeout'));
      }, timeoutMs);

      // Poll for approval with exponential backoff
      const pollInterval = 1000; // Start at 1 second
      let currentInterval = pollInterval;

      const poll = async () => {
        try {
          const job = await this.pgBoss.fetch<ApprovalDecision>(queueName);

          if (job) {
            clearTimeout(timeout);
            await this.pgBoss.complete(queueName, job.id);
            resolve(job.data);
            return;
          }

          // Exponential backoff with max of 5 seconds
          currentInterval = Math.min(currentInterval * 1.5, 5000);
          setTimeout(poll, currentInterval);
        } catch (error) {
          clearTimeout(timeout);
          reject(error);
        }
      };

      // Start polling
      poll();
    });
  }

  /**
   * Submit an approval decision to the specified queue.
   * Called by external services (e.g., Slack button handler).
   */
  async submitApproval(queueName: string, decision: ApprovalDecision): Promise<void> {
    await this.pgBoss.send(queueName, decision);
    this.logger.log(`Approval decision submitted to ${queueName}: ${decision.decision}`);
  }
}
