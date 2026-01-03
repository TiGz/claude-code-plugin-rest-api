import { Injectable, Logger, Inject, NotFoundException } from '@nestjs/common';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { Observable } from 'rxjs';
import { AgentConfig, SessionOptions, AgentExecutionResult } from '../types/plugin.types.js';
import type { SDKMessage } from './plugin-execution.service.js';

export const AGENT_CONFIG = 'AGENT_CONFIG';

/**
 * Service for executing user-defined agents with full SDK options.
 * These agents are configured programmatically at module registration time
 * and exposed via /v1/agents/:name endpoints.
 *
 * Supports SDK session management for multi-turn conversations:
 * - Session IDs are captured from the SDK init message and returned in results
 * - Sessions can be resumed by passing the sessionId in execute/stream calls
 * - Sessions can be forked to create new branches from existing conversations
 */
@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    @Inject(AGENT_CONFIG) private agents: Record<string, AgentConfig>,
  ) {
    const agentNames = Object.keys(this.agents);
    if (agentNames.length > 0) {
      this.logger.log(`Registered ${agentNames.length} user-defined agents: ${agentNames.join(', ')}`);
    }
  }

  /**
   * Get all registered agent names
   */
  getAgentNames(): string[] {
    return Object.keys(this.agents);
  }

  /**
   * Get configuration for a specific agent
   */
  getAgentConfig(name: string): AgentConfig | undefined {
    return this.agents[name];
  }

  /**
   * Execute an agent (request/response mode)
   *
   * @param agentName - Name of the registered agent
   * @param prompt - User prompt to send to the agent
   * @param sessionOptions - Optional session options for resume/fork
   * @returns Execution result including sessionId for subsequent calls
   */
  async execute(
    agentName: string,
    prompt: string,
    sessionOptions?: SessionOptions,
  ): Promise<AgentExecutionResult> {
    const config = this.agents[agentName];
    if (!config) {
      throw new NotFoundException(`Agent '${agentName}' not found`);
    }

    const sessionInfo = sessionOptions?.sessionId
      ? ` (resuming session ${sessionOptions.sessionId}${sessionOptions.forkSession ? ', fork' : ''})`
      : '';
    this.logger.log(`Executing agent '${agentName}'${sessionInfo} with prompt: ${prompt.substring(0, 100)}...`);

    const queryOptions = this.buildQueryOptions(config, sessionOptions);

    try {
      let sessionId: string | undefined;
      let finalResult: AgentExecutionResult = { success: false };

      for await (const message of query({ prompt, options: queryOptions })) {
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

      this.logger.log(
        `Agent '${agentName}' completed: success=${finalResult.success}, turns=${finalResult.turns}, sessionId=${finalResult.sessionId}`,
      );
      return finalResult;
    } catch (error: unknown) {
      const err = error as Error;
      this.logger.error(`Agent '${agentName}' execution failed: ${err.message}`, err.stack);
      return { success: false, error: err.message };
    }
  }

  /**
   * Stream agent execution via Observable
   *
   * @param agentName - Name of the registered agent
   * @param prompt - User prompt to send to the agent
   * @param sessionOptions - Optional session options for resume/fork
   * @returns Observable of SDK messages including session info in init and result
   */
  stream(
    agentName: string,
    prompt: string,
    sessionOptions?: SessionOptions,
  ): Observable<SDKMessage> {
    const config = this.agents[agentName];
    if (!config) {
      return new Observable((subscriber) => {
        subscriber.error(new NotFoundException(`Agent '${agentName}' not found`));
      });
    }

    const sessionInfo = sessionOptions?.sessionId
      ? ` (resuming session ${sessionOptions.sessionId}${sessionOptions.forkSession ? ', fork' : ''})`
      : '';
    this.logger.log(`Streaming agent '${agentName}'${sessionInfo} with prompt: ${prompt.substring(0, 100)}...`);

    const queryOptions = this.buildQueryOptions(config, sessionOptions);

    return new Observable((subscriber) => {
      (async () => {
        try {
          for await (const message of query({ prompt, options: queryOptions })) {
            subscriber.next(message);

            if (message.type === 'result') {
              subscriber.complete();
            }
          }
        } catch (error: unknown) {
          const err = error as Error;
          this.logger.error(`Agent '${agentName}' stream failed: ${err.message}`, err.stack);
          subscriber.error(error);
        }
      })();
    });
  }

  /**
   * Build query options from agent config.
   * Spreads SDK options directly and sets defaults for cwd and permissionMode.
   * Adds session resume/fork options if provided.
   */
  private buildQueryOptions(config: AgentConfig, sessionOptions?: SessionOptions) {
    // Extract our custom extension, pass everything else to SDK
    const { requestSchema: _requestSchema, ...sdkOptions } = config;

    const options: Record<string, unknown> = {
      ...sdkOptions,
      // Default working directory to cwd if not specified
      cwd: sdkOptions.cwd ?? process.cwd(),
      // Default permission mode
      permissionMode: sdkOptions.permissionMode ?? 'default',
    };

    // Add session options if resuming
    if (sessionOptions?.sessionId) {
      options.resume = sessionOptions.sessionId;
      if (sessionOptions.forkSession) {
        options.forkSession = true;
      }
    }

    return options;
  }
}
