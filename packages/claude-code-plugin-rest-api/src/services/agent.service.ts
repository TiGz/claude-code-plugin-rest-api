import { Injectable, Logger, Inject, NotFoundException } from '@nestjs/common';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { Observable } from 'rxjs';
import { AgentConfig } from '../types/plugin.types.js';
import { SDKMessage, ExecutionResult } from './plugin-execution.service.js';

export const AGENT_CONFIG = 'AGENT_CONFIG';

/**
 * Service for executing user-defined agents with full SDK options.
 * These agents are configured programmatically at module registration time
 * and exposed via /v1/agents/:name endpoints.
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
   */
  async execute(agentName: string, prompt: string): Promise<ExecutionResult> {
    const config = this.agents[agentName];
    if (!config) {
      throw new NotFoundException(`Agent '${agentName}' not found`);
    }

    this.logger.log(`Executing agent '${agentName}' with prompt: ${prompt.substring(0, 100)}...`);

    const queryOptions = this.buildQueryOptions(config);

    try {
      let finalResult: ExecutionResult = { success: false };

      for await (const message of query({ prompt, options: queryOptions })) {
        if (message.type === 'result') {
          const resultMessage = message as {
            type: 'result';
            is_error?: boolean;
            result?: string;
            structured_output?: unknown;
            total_cost_usd?: number;
            num_turns?: number;
            usage?: { input_tokens?: number; output_tokens?: number };
          };
          finalResult = {
            success: !resultMessage.is_error,
            result: resultMessage.result,
            structuredOutput: resultMessage.structured_output,
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

      this.logger.log(`Agent '${agentName}' completed: success=${finalResult.success}, turns=${finalResult.turns}`);
      return finalResult;
    } catch (error: unknown) {
      const err = error as Error;
      this.logger.error(`Agent '${agentName}' execution failed: ${err.message}`, err.stack);
      return { success: false, error: err.message };
    }
  }

  /**
   * Stream agent execution via Observable
   */
  stream(agentName: string, prompt: string): Observable<SDKMessage> {
    const config = this.agents[agentName];
    if (!config) {
      return new Observable((subscriber) => {
        subscriber.error(new NotFoundException(`Agent '${agentName}' not found`));
      });
    }

    this.logger.log(`Streaming agent '${agentName}' with prompt: ${prompt.substring(0, 100)}...`);

    const queryOptions = this.buildQueryOptions(config);

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
   */
  private buildQueryOptions(config: AgentConfig) {
    // Extract our custom extension, pass everything else to SDK
    const { requestSchema: _requestSchema, ...sdkOptions } = config;

    return {
      ...sdkOptions,
      // Default working directory to cwd if not specified
      cwd: sdkOptions.cwd ?? process.cwd(),
      // Default permission mode
      permissionMode: sdkOptions.permissionMode ?? 'default',
    };
  }
}
