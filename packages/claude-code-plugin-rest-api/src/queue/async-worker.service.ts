import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Inject } from '@nestjs/common';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { PgBossService } from './pgboss.service.js';
import { ChannelResolverService } from './reply-channels/channel-resolver.service.js';
import { HITLService } from './hitl.service.js';
import { QUEUE_MODULE_OPTIONS, QUEUE_AGENT_CONFIG } from './queue.tokens.js';
import type { AgentConfig, HITLConfig, AgentExecutionResult } from '../types/plugin.types.js';
import type {
  QueueModuleOptions,
  AsyncAgentRequest,
  AsyncAgentSuccessResponse,
  AsyncAgentErrorResponse,
} from '../types/queue.types.js';
import type PgBoss from 'pg-boss';

/**
 * Agent configuration with optional HITL support.
 */
type AgentConfigWithHITL = AgentConfig & { hitl?: HITLConfig };

/**
 * Async worker service that processes agent requests from pg-boss queues.
 * Supports session management and HITL approval workflows.
 */
@Injectable()
export class AsyncWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AsyncWorkerService.name);
  private workerIds: string[] = [];

  constructor(
    private readonly pgBoss: PgBossService,
    private readonly channelResolver: ChannelResolverService,
    private readonly hitlService: HITLService,
    @Inject(QUEUE_MODULE_OPTIONS) private readonly options: QueueModuleOptions,
    @Inject(QUEUE_AGENT_CONFIG) private readonly agents: Record<string, AgentConfigWithHITL>,
  ) {}

  async onModuleInit() {
    // Register workers for each configured agent
    for (const agentName of Object.keys(this.agents)) {
      const queueName = `claude.agents.${agentName}.requests`;

      this.logger.log(`Starting worker for agent '${agentName}' on queue '${queueName}'`);

      const workerId = await this.pgBoss.work<AsyncAgentRequest>(
        queueName,
        async (job: PgBoss.Job<AsyncAgentRequest>) => this.processRequest(queueName, job),
        {
          batchSize: 1, // Process one job at a time per agent
        },
      );

      this.workerIds.push(workerId);
      this.logger.log(`Worker started for agent '${agentName}'`);
    }
  }

  async onModuleDestroy() {
    // Workers are automatically stopped when pg-boss stops
    this.logger.log(`Stopping ${this.workerIds.length} workers...`);
  }

  /**
   * Process an async agent request.
   */
  private async processRequest(queueName: string, job: PgBoss.Job<AsyncAgentRequest>): Promise<void> {
    const request = job.data;
    const startTime = Date.now();

    this.logger.log(`Processing request ${request.correlationId} for agent '${request.agentName}'`);

    const config = this.agents[request.agentName];
    if (!config) {
      const errorResponse = this.createErrorResponse(
        request,
        `Agent '${request.agentName}' not configured`,
        startTime,
      );
      await this.sendResponse(request.replyTo, errorResponse);
      return;
    }

    // Resolve reply channel
    let channel;
    try {
      channel = this.channelResolver.resolve(request.replyTo);
    } catch (error) {
      this.logger.error(`Failed to resolve reply channel: ${(error as Error).message}`);
      // Can't send response without a channel
      throw error;
    }

    try {
      const result = await this.executeAgent(config, request, channel);

      const response: AsyncAgentSuccessResponse = {
        type: 'result',
        correlationId: request.correlationId,
        sessionId: result.sessionId,
        origin: request.origin,
        payload: {
          success: true,
          output: result.result,
          structuredOutput: result.structuredOutput,
        },
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
      };

      await channel.send(response);
      this.logger.log(`Request ${request.correlationId} completed successfully`);
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Request ${request.correlationId} failed: ${err.message}`, err.stack);

      const errorResponse = this.createErrorResponse(request, err.message, startTime);
      await channel.send(errorResponse);
    }
  }

  /**
   * Execute an agent with HITL support.
   */
  private async executeAgent(
    config: AgentConfigWithHITL,
    request: AsyncAgentRequest,
    channel: import('../types/queue.types.js').ReplyChannel,
  ): Promise<AgentExecutionResult> {
    const { hitl, requestSchema: _requestSchema, ...sdkOptions } = config;

    // Build query options
    const queryOptions: Record<string, unknown> = {
      ...sdkOptions,
      cwd: sdkOptions.cwd ?? process.cwd(),
      permissionMode: sdkOptions.permissionMode ?? 'default',
    };

    // Add session options if resuming
    if (request.sessionId) {
      queryOptions.resume = request.sessionId;
      if (request.forkSession) {
        queryOptions.forkSession = true;
      }
    }

    // Add HITL callback if configured
    const approvalHandler = this.hitlService.createApprovalHandler(config, request, channel);
    if (approvalHandler) {
      queryOptions.canUseTool = async (toolName: string, toolInput: unknown) => {
        const result = await approvalHandler(toolName, toolInput);

        // Convert our result format to SDK format
        if (result.behavior === 'allow') {
          return { behavior: 'allow' as const, updatedInput: result.updatedInput };
        } else if (result.behavior === 'deny') {
          return { behavior: 'deny' as const, message: result.message };
        } else {
          // abort
          return { behavior: 'deny' as const, message: result.message };
        }
      };
    }

    // Execute the agent
    let sessionId: string | undefined;
    let finalResult: AgentExecutionResult = { success: false };

    for await (const message of query({ prompt: request.prompt, options: queryOptions })) {
      // Capture session ID from init message
      if (message.type === 'system' && 'subtype' in message && message.subtype === 'init') {
        sessionId = (message as { session_id: string }).session_id;
      }

      if (message.type === 'result') {
        const resultMessage = message as {
          type: 'result';
          is_error?: boolean;
          result?: string;
          structured_output?: unknown;
          total_cost_usd?: number;
          num_turns?: number;
          session_id?: string;
          usage?: { input_tokens?: number; output_tokens?: number };
        };

        // Use session_id from result if we didn't get it from init
        sessionId = sessionId || resultMessage.session_id;

        finalResult = {
          success: !resultMessage.is_error,
          result: resultMessage.result,
          structuredOutput: resultMessage.structured_output,
          sessionId,
          cost: resultMessage.total_cost_usd,
          turns: resultMessage.num_turns,
          usage: resultMessage.usage
            ? {
                inputTokens: resultMessage.usage.input_tokens || 0,
                outputTokens: resultMessage.usage.output_tokens || 0,
              }
            : undefined,
        };
      }
    }

    if (!finalResult.success && finalResult.error) {
      throw new Error(finalResult.error);
    }

    return finalResult;
  }

  /**
   * Create an error response.
   */
  private createErrorResponse(
    request: AsyncAgentRequest,
    error: string,
    startTime: number,
  ): AsyncAgentErrorResponse {
    return {
      type: 'error',
      correlationId: request.correlationId,
      origin: request.origin,
      payload: {
        success: false,
        error,
      },
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Send a response via the appropriate channel.
   */
  private async sendResponse(
    replyTo: string,
    response: AsyncAgentSuccessResponse | AsyncAgentErrorResponse,
  ): Promise<void> {
    try {
      await this.channelResolver.send(replyTo, response);
    } catch (error) {
      this.logger.error(`Failed to send response: ${(error as Error).message}`);
      throw error;
    }
  }
}
