import { Injectable, Logger, Inject } from '@nestjs/common';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { Observable } from 'rxjs';
import { PluginDiscoveryService } from './plugin-discovery.service.js';
import { PluginCommand, PluginAgent, PluginSkill } from '../types/plugin.types.js';

/** SDK message type from claude-agent-sdk streaming responses */
export interface SDKMessage {
  type: string;
  content?: string | Array<{ type: string; text?: string }>;
  [key: string]: unknown;
}

export interface AttachmentSource {
  type: 'base64' | 'url' | 'file';
  data?: string;
  url?: string;
  /** Anthropic file ID from upload (when type is 'file') */
  fileId?: string;
}

export interface Attachment {
  type: 'image' | 'document' | 'text';
  mediaType: string;
  source: AttachmentSource;
  filename?: string;
}

export interface ExecutionOptions {
  arguments?: string;
  context?: Record<string, unknown>;
  attachments?: Attachment[];
  maxTurns?: number;
  maxBudgetUsd?: number;
  cwd?: string;
}

export interface ExecutionResult {
  success: boolean;
  result?: string;
  error?: string;
  cost?: number;
  turns?: number;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface PluginExecutionOptions {
  maxTurns: number;
  maxBudgetUsd: number;
}

export const PLUGIN_EXECUTION_OPTIONS = 'PLUGIN_EXECUTION_OPTIONS';

@Injectable()
export class PluginExecutionService {
  private readonly logger = new Logger(PluginExecutionService.name);

  constructor(
    @Inject(PLUGIN_EXECUTION_OPTIONS) private options: PluginExecutionOptions,
    private pluginDiscovery: PluginDiscoveryService,
  ) {}

  /**
   * Execute a plugin command
   */
  async executeCommand(
    pluginName: string,
    commandName: string,
    options: ExecutionOptions = {},
  ): Promise<ExecutionResult> {
    const command = this.pluginDiscovery.getCommand(pluginName, commandName);

    if (!command) {
      return {
        success: false,
        error: `Command '${commandName}' not found in plugin '${pluginName}'`,
      };
    }

    const prompt = this.buildCommandPrompt(command, options);

    return this.execute(prompt, {
      systemPrompt: command.content,
      ...options,
    });
  }

  /**
   * Execute a plugin agent
   */
  async executeAgent(
    pluginName: string,
    agentName: string,
    options: ExecutionOptions = {},
  ): Promise<ExecutionResult> {
    const agent = this.pluginDiscovery.getAgent(pluginName, agentName);

    if (!agent) {
      return {
        success: false,
        error: `Agent '${agentName}' not found in plugin '${pluginName}'`,
      };
    }

    const prompt = options.arguments || 'Execute the agent task';

    return this.execute(prompt, {
      systemPrompt: agent.content,
      allowedTools: agent.tools,
      ...options,
    });
  }

  /**
   * Stream agent execution via Observable
   */
  streamAgent(
    pluginName: string,
    agentName: string,
    options: ExecutionOptions = {},
  ): Observable<SDKMessage> {
    const agent = this.pluginDiscovery.getAgent(pluginName, agentName);

    if (!agent) {
      return new Observable((subscriber) => {
        subscriber.error(new Error(`Agent '${agentName}' not found in plugin '${pluginName}'`));
      });
    }

    const prompt = options.arguments || 'Execute the agent task';

    return this.stream(prompt, {
      systemPrompt: agent.content,
      allowedTools: agent.tools,
      ...options,
    });
  }

  /**
   * Execute a plugin skill
   */
  async executeSkill(
    pluginName: string,
    skillName: string,
    options: ExecutionOptions = {},
  ): Promise<ExecutionResult> {
    const skill = this.pluginDiscovery.getSkill(pluginName, skillName);

    if (!skill) {
      return {
        success: false,
        error: `Skill '${skillName}' not found in plugin '${pluginName}'`,
      };
    }

    const prompt = options.arguments || 'Execute the skill';

    return this.execute(prompt, {
      systemPrompt: skill.content,
      allowedTools: skill.allowedTools,
      ...options,
    });
  }

  private async execute(
    prompt: string,
    options: {
      systemPrompt?: string;
      allowedTools?: string[];
      maxTurns?: number;
      maxBudgetUsd?: number;
      cwd?: string;
    },
  ): Promise<ExecutionResult> {
    const queryOptions = this.buildQueryOptions(options);

    try {
      let finalResult: ExecutionResult = { success: false };

      for await (const message of query({
        prompt,
        options: queryOptions,
      })) {
        if (message.type === 'result') {
          const resultMessage = message as SDKMessage & {
            is_error?: boolean;
            result?: string;
            total_cost_usd?: number;
            num_turns?: number;
            usage?: { input_tokens?: number; output_tokens?: number };
          };
          finalResult = {
            success: !resultMessage.is_error,
            result: resultMessage.result,
            cost: resultMessage.total_cost_usd,
            turns: resultMessage.num_turns,
            usage: {
              inputTokens: resultMessage.usage?.input_tokens || 0,
              outputTokens: resultMessage.usage?.output_tokens || 0,
            },
          };
        }
      }

      return finalResult;
    } catch (error: unknown) {
      const err = error as Error;
      this.logger.error(`Execution failed: ${err.message}`, err.stack);
      return {
        success: false,
        error: err.message,
      };
    }
  }

  private stream(
    prompt: string,
    options: {
      systemPrompt?: string;
      allowedTools?: string[];
      maxTurns?: number;
      maxBudgetUsd?: number;
      cwd?: string;
    },
  ): Observable<SDKMessage> {
    const queryOptions = this.buildQueryOptions(options);

    return new Observable((subscriber) => {
      (async () => {
        try {
          for await (const message of query({
            prompt,
            options: queryOptions,
          })) {
            subscriber.next(message);

            if (message.type === 'result') {
              subscriber.complete();
            }
          }
        } catch (error: unknown) {
          const err = error as Error;
          this.logger.error(`Stream failed: ${err.message}`, err.stack);
          subscriber.error(error);
        }
      })();
    });
  }

  private buildQueryOptions(options: {
    systemPrompt?: string;
    allowedTools?: string[];
    maxTurns?: number;
    maxBudgetUsd?: number;
    cwd?: string;
  }) {
    return {
      allowedTools: options.allowedTools || ['Read', 'Glob', 'Grep'],
      maxTurns: options.maxTurns || this.options.maxTurns,
      maxBudgetUsd: options.maxBudgetUsd || this.options.maxBudgetUsd,
      permissionMode: 'default' as const,
      workingDirectory: options.cwd || process.cwd(),
      ...(options.systemPrompt && {
        systemPrompt: options.systemPrompt,
      }),
    };
  }

  private buildCommandPrompt(command: PluginCommand, options: ExecutionOptions): string {
    let prompt = `Execute the following command: ${command.name}`;

    if (options.arguments) {
      prompt += `\n\nArguments: ${options.arguments}`;
    }

    if (options.context) {
      prompt += `\n\nContext: ${JSON.stringify(options.context, null, 2)}`;
    }

    return prompt;
  }
}
