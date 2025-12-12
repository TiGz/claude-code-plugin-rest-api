import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Res,
  Sse,
  Logger,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { Response } from 'express';
import { Observable, map, catchError, of } from 'rxjs';
import { ApiTags, ApiOperation, ApiParam, ApiBody, ApiResponse } from '@nestjs/swagger';
import { PluginDiscoveryService } from '../services/plugin-discovery.service.js';
import { PluginExecutionService } from '../services/plugin-execution.service.js';
import { StreamSessionService } from '../services/stream-session.service.js';

// Attachment types for multimodal inputs
interface AttachmentSource {
  type: 'base64' | 'url' | 'file';
  /** Base64-encoded content (when type is 'base64') */
  data?: string;
  /** URL to fetch content from (when type is 'url') */
  url?: string;
  /** Anthropic file ID from upload (when type is 'file') */
  fileId?: string;
}

interface Attachment {
  /**
   * Content type matching Anthropic API types:
   * - 'image' for images (jpeg, png, gif, webp)
   * - 'document' for PDFs
   * - 'text' for plain text files
   */
  type: 'image' | 'document' | 'text';

  /** MIME type (e.g., 'image/png', 'application/pdf', 'text/plain') */
  mediaType: string;

  /** How the content is provided */
  source: AttachmentSource;

  /** Optional filename for context */
  filename?: string;
}

// DTOs
class ExecuteCommandDto {
  arguments?: string;
  context?: Record<string, unknown>;
  /** File attachments (images, PDFs, text files) */
  attachments?: Attachment[];
  maxTurns?: number;
  maxBudgetUsd?: number;
  /**
   * When true, returns the agent's output directly without wrapper.
   * Content-Type is auto-detected: JSON if parseable, otherwise text/plain.
   */
  rawResponse?: boolean;
}

class ExecuteAgentDto {
  prompt!: string;
  /** File attachments (images, PDFs, text files) */
  attachments?: Attachment[];
  maxTurns?: number;
  maxBudgetUsd?: number;
  /**
   * When true, returns the agent's output directly without wrapper.
   * Content-Type is auto-detected: JSON if parseable, otherwise text/plain.
   */
  rawResponse?: boolean;
}

class CreateStreamDto {
  pluginName!: string;
  agentName!: string;
  prompt!: string;
  /** File attachments (images, PDFs, text files) */
  attachments?: Attachment[];
  maxTurns?: number;
  maxBudgetUsd?: number;
}

interface SseMessage {
  data: {
    type: string;
    content?: string;
    error?: string;
    result?: unknown;
    timestamp?: number;
  };
  id?: string;
}

@ApiTags('plugins')
@Controller('v1/plugins')
export class PluginController {
  private readonly logger = new Logger(PluginController.name);

  constructor(
    private readonly pluginDiscovery: PluginDiscoveryService,
    private readonly pluginExecution: PluginExecutionService,
    private readonly streamSession: StreamSessionService,
  ) {}

  /**
   * List all discovered plugins
   */
  @Get()
  @ApiOperation({ summary: 'List all discovered plugins' })
  @ApiResponse({ status: 200, description: 'List of plugins with their capabilities' })
  listPlugins() {
    const plugins = this.pluginDiscovery.getAllPlugins();

    return {
      plugins: plugins.map((p) => ({
        name: p.name,
        version: p.version,
        description: p.description,
        commands: p.commands.map((c) => ({ name: c.name, description: c.description })),
        agents: p.agents.map((a) => ({ name: a.name, description: a.description })),
        skills: p.skills.map((s) => ({ name: s.name, description: s.description })),
      })),
      count: plugins.length,
    };
  }

  /**
   * Get plugin details
   */
  @Get(':pluginName')
  @ApiOperation({ summary: 'Get plugin details' })
  @ApiParam({ name: 'pluginName', description: 'Plugin name' })
  @ApiResponse({ status: 200, description: 'Plugin details' })
  @ApiResponse({ status: 404, description: 'Plugin not found' })
  getPlugin(@Param('pluginName') pluginName: string) {
    const plugin = this.pluginDiscovery.getPlugin(pluginName);

    if (!plugin) {
      throw new NotFoundException(`Plugin '${pluginName}' not found`);
    }

    return {
      name: plugin.name,
      version: plugin.version,
      description: plugin.description,
      commands: plugin.commands.map((c) => ({
        name: c.name,
        description: c.description,
        endpoint: `/v1/plugins/${plugin.name}/commands/${c.name}`,
      })),
      agents: plugin.agents.map((a) => ({
        name: a.name,
        description: a.description,
        tools: a.tools,
        model: a.model,
        endpoint: `/v1/plugins/${plugin.name}/agents/${a.name}`,
        streamEndpoint: `/v1/plugins/${plugin.name}/agents/${a.name}/stream`,
      })),
      skills: plugin.skills.map((s) => ({
        name: s.name,
        description: s.description,
        allowedTools: s.allowedTools,
        endpoint: `/v1/plugins/${plugin.name}/skills/${s.name}`,
      })),
    };
  }

  /**
   * Execute a plugin command
   *
   * By default, returns a wrapped response with metadata (success, result, cost, turns, usage).
   * When `rawResponse: true`, returns the command's output directly with auto-detected Content-Type.
   */
  @Post(':pluginName/commands/:commandName')
  @ApiOperation({ summary: 'Execute a plugin command' })
  @ApiParam({ name: 'pluginName', description: 'Plugin name' })
  @ApiParam({ name: 'commandName', description: 'Command name' })
  @ApiBody({ type: ExecuteCommandDto })
  async executeCommand(
    @Param('pluginName') pluginName: string,
    @Param('commandName') commandName: string,
    @Body() dto: ExecuteCommandDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.logger.log(`Executing command: ${pluginName}/${commandName}`);

    const result = await this.pluginExecution.executeCommand(pluginName, commandName, {
      arguments: dto.arguments,
      context: dto.context,
      maxTurns: dto.maxTurns,
      maxBudgetUsd: dto.maxBudgetUsd,
    });

    if (!result.success && result.error?.includes('not found')) {
      throw new NotFoundException(result.error);
    }

    if (!result.success) {
      throw new HttpException(
        { success: false, error: result.error },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // Handle raw response mode with auto-detect Content-Type
    if (dto.rawResponse && result.result) {
      try {
        // Try to parse as JSON
        const parsed = JSON.parse(result.result);
        res.setHeader('Content-Type', 'application/json');
        return parsed;
      } catch {
        // Not valid JSON, return as plain text
        res.setHeader('Content-Type', 'text/plain');
        return result.result;
      }
    }

    // Default: return wrapped response
    return result;
  }

  /**
   * Execute a plugin agent (non-streaming)
   *
   * By default, returns a wrapped response with metadata (success, result, cost, turns, usage).
   * When `rawResponse: true`, returns the agent's output directly with auto-detected Content-Type.
   */
  @Post(':pluginName/agents/:agentName')
  @ApiOperation({ summary: 'Execute a plugin agent' })
  @ApiParam({ name: 'pluginName', description: 'Plugin name' })
  @ApiParam({ name: 'agentName', description: 'Agent name' })
  @ApiBody({ type: ExecuteAgentDto })
  async executeAgent(
    @Param('pluginName') pluginName: string,
    @Param('agentName') agentName: string,
    @Body() dto: ExecuteAgentDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.logger.log(`Executing agent: ${pluginName}/${agentName}`);

    const result = await this.pluginExecution.executeAgent(pluginName, agentName, {
      arguments: dto.prompt,
      maxTurns: dto.maxTurns,
      maxBudgetUsd: dto.maxBudgetUsd,
    });

    if (!result.success && result.error?.includes('not found')) {
      throw new NotFoundException(result.error);
    }

    if (!result.success) {
      throw new HttpException(
        { success: false, error: result.error },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // Handle raw response mode with auto-detect Content-Type
    if (dto.rawResponse && result.result) {
      try {
        // Try to parse as JSON
        const parsed = JSON.parse(result.result);
        res.setHeader('Content-Type', 'application/json');
        return parsed;
      } catch {
        // Not valid JSON, return as plain text
        res.setHeader('Content-Type', 'text/plain');
        return result.result;
      }
    }

    // Default: return wrapped response
    return result;
  }

  /**
   * Create a stream session for agent execution
   */
  @Post('stream')
  @ApiOperation({ summary: 'Create a stream session for agent execution' })
  @ApiBody({ type: CreateStreamDto })
  async createStreamSession(@Body() dto: CreateStreamDto) {
    const agent = this.pluginDiscovery.getAgent(dto.pluginName, dto.agentName);

    if (!agent) {
      throw new NotFoundException(`Agent '${dto.agentName}' not found in plugin '${dto.pluginName}'`);
    }

    const sessionId = await this.streamSession.createSession({
      pluginName: dto.pluginName,
      agentName: dto.agentName,
      prompt: dto.prompt,
      maxTurns: dto.maxTurns,
      maxBudgetUsd: dto.maxBudgetUsd,
    });

    return {
      sessionId,
      streamUrl: `/v1/stream/${sessionId}`,
      expiresIn: 300, // 5 minutes
    };
  }

  /**
   * Execute a plugin skill
   *
   * By default, returns a wrapped response with metadata (success, result, cost, turns, usage).
   * When `rawResponse: true`, returns the skill's output directly with auto-detected Content-Type.
   */
  @Post(':pluginName/skills/:skillName')
  @ApiOperation({ summary: 'Execute a plugin skill' })
  @ApiParam({ name: 'pluginName', description: 'Plugin name' })
  @ApiParam({ name: 'skillName', description: 'Skill name' })
  @ApiBody({ type: ExecuteCommandDto })
  async executeSkill(
    @Param('pluginName') pluginName: string,
    @Param('skillName') skillName: string,
    @Body() dto: ExecuteCommandDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.logger.log(`Executing skill: ${pluginName}/${skillName}`);

    const result = await this.pluginExecution.executeSkill(pluginName, skillName, {
      arguments: dto.arguments,
      context: dto.context,
      maxTurns: dto.maxTurns,
      maxBudgetUsd: dto.maxBudgetUsd,
    });

    if (!result.success && result.error?.includes('not found')) {
      throw new NotFoundException(result.error);
    }

    if (!result.success) {
      throw new HttpException(
        { success: false, error: result.error },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // Handle raw response mode with auto-detect Content-Type
    if (dto.rawResponse && result.result) {
      try {
        // Try to parse as JSON
        const parsed = JSON.parse(result.result);
        res.setHeader('Content-Type', 'application/json');
        return parsed;
      } catch {
        // Not valid JSON, return as plain text
        res.setHeader('Content-Type', 'text/plain');
        return result.result;
      }
    }

    // Default: return wrapped response
    return result;
  }
}

/**
 * Separate controller for SSE streaming to avoid mixing with REST endpoints
 */
@ApiTags('streaming')
@Controller('v1/stream')
export class StreamController {
  private readonly logger = new Logger(StreamController.name);

  constructor(
    private readonly pluginExecution: PluginExecutionService,
    private readonly streamSession: StreamSessionService,
  ) {}

  /**
   * Consume a stream session via SSE
   */
  @Sse(':sessionId')
  @ApiOperation({ summary: 'Stream agent responses via SSE' })
  @ApiParam({ name: 'sessionId', description: 'Stream session ID from POST /v1/plugins/stream' })
  consumeStream(@Param('sessionId') sessionId: string): Observable<SseMessage> {
    const session = this.streamSession.getSession(sessionId);

    if (!session) {
      return of({
        data: { type: 'error', error: 'Session not found or expired' },
      });
    }

    // Mark session as consumed
    this.streamSession.markConsumed(sessionId);

    this.logger.log(`Streaming agent: ${session.pluginName}/${session.agentName}`);

    return this.pluginExecution.streamAgent(session.pluginName, session.agentName, {
      arguments: session.prompt,
      maxTurns: session.maxTurns,
      maxBudgetUsd: session.maxBudgetUsd,
    }).pipe(
      map((message) => {
        if (message.type === 'assistant') {
          const assistantMessage = message as { type: 'assistant'; message: { content: Array<{ type: string; text?: string }> } };
          const text = assistantMessage.message.content
            .filter((c) => c.type === 'text')
            .map((c) => c.text || '')
            .join('');

          return {
            data: {
              type: 'delta',
              content: text,
              timestamp: Date.now(),
            },
          };
        }

        if (message.type === 'result') {
          const resultMessage = message as {
            type: 'result';
            is_error?: boolean;
            result?: string;
            total_cost_usd?: number;
            num_turns?: number;
          };
          return {
            data: {
              type: 'complete',
              result: {
                success: !resultMessage.is_error,
                result: resultMessage.result,
                cost: resultMessage.total_cost_usd,
                turns: resultMessage.num_turns,
              },
              timestamp: Date.now(),
            },
          };
        }

        return {
          data: {
            type: message.type,
            timestamp: Date.now(),
          },
        };
      }),
      catchError((error: Error) => {
        this.logger.error(`Stream error: ${error.message}`);
        return of({
          data: { type: 'error', error: error.message, timestamp: Date.now() },
        });
      }),
    );
  }
}
