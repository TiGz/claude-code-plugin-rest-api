import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Res,
  Logger,
  HttpException,
  HttpStatus,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiParam, ApiBody, ApiResponse } from '@nestjs/swagger';
import { Ajv, ErrorObject } from 'ajv';
import { AgentService } from '../services/agent.service.js';
import { StreamSessionService } from '../services/stream-session.service.js';
import { AgentConfig, SessionOptions } from '../types/plugin.types.js';

const ajv = new Ajv({ allErrors: true });

class ExecuteAgentDto {
  prompt!: string;
  /**
   * SDK session ID to resume an existing conversation.
   * When provided, the agent continues from where the previous session left off.
   */
  sessionId?: string;
  /**
   * When true and sessionId is provided, creates a new session
   * branching from the specified session instead of continuing it.
   */
  forkSession?: boolean;
  /**
   * When true, returns the agent's output directly without wrapper.
   * For agents with outputFormat, defaults to true (returns structured JSON directly).
   * For other agents, defaults to false (returns wrapped response with metadata).
   * Content-Type is auto-detected: JSON if parseable, otherwise text/plain.
   */
  rawResponse?: boolean;
}

class CreateStreamDto {
  prompt!: string;
  /**
   * SDK session ID to resume an existing conversation.
   */
  sessionId?: string;
  /**
   * When true and sessionId is provided, creates a new session branch.
   */
  forkSession?: boolean;
}

@ApiTags('agents')
@Controller('v1/agents')
export class AgentController {
  private readonly logger = new Logger(AgentController.name);

  constructor(
    private readonly agentService: AgentService,
    private readonly streamSession: StreamSessionService,
  ) {}

  /**
   * List all user-defined agents
   */
  @Get()
  @ApiOperation({ summary: 'List all user-defined agents' })
  @ApiResponse({ status: 200, description: 'List of agent names' })
  listAgents(): { agents: string[]; count: number } {
    const agents = this.agentService.getAgentNames();
    return {
      agents,
      count: agents.length,
    };
  }

  /**
   * Get agent configuration
   */
  @Get(':name')
  @ApiOperation({ summary: 'Get agent configuration' })
  @ApiParam({ name: 'name', description: 'Agent name' })
  @ApiResponse({ status: 200, description: 'Agent configuration' })
  @ApiResponse({ status: 404, description: 'Agent not found' })
  getAgent(@Param('name') name: string): AgentConfig & { endpoint: string; streamEndpoint: string } {
    const config = this.agentService.getAgentConfig(name);
    if (!config) {
      throw new NotFoundException(`Agent '${name}' not found`);
    }
    return {
      ...config,
      endpoint: `/v1/agents/${name}`,
      streamEndpoint: `/v1/agents/${name}/stream`,
    };
  }

  /**
   * Execute an agent (request/response mode)
   *
   * Supports SDK session management for multi-turn conversations:
   * - New sessions: Omit sessionId to start a fresh conversation
   * - Resume: Include sessionId to continue from where you left off
   * - Fork: Include sessionId + forkSession:true to branch the conversation
   *
   * By default, returns a wrapped response with metadata (success, result, cost, turns, usage, sessionId).
   * For agents with outputFormat, rawResponse defaults to true (returns structured JSON directly).
   * When `rawResponse: true`, returns the agent's output directly with auto-detected Content-Type.
   *
   * For agents with requestSchema configured, the request body is validated against the schema
   * and converted to a prompt using the configured template.
   */
  @Post(':name')
  @ApiOperation({ summary: 'Execute an agent' })
  @ApiParam({ name: 'name', description: 'Agent name' })
  @ApiBody({ type: ExecuteAgentDto })
  @ApiResponse({ status: 200, description: 'Execution result including sessionId for resumption' })
  @ApiResponse({ status: 400, description: 'Request validation failed' })
  @ApiResponse({ status: 404, description: 'Agent not found' })
  async executeAgent(
    @Param('name') name: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.logger.log(`Executing agent: ${name}`);

    // Get agent config to check for outputFormat and requestSchema
    const config = this.agentService.getAgentConfig(name);
    if (!config) {
      throw new NotFoundException(`Agent '${name}' not found`);
    }

    let prompt: string;
    let rawResponse: boolean | undefined;
    let sessionOptions: SessionOptions | undefined;

    if (config.requestSchema) {
      // Validate request body against JSON schema
      const validate = ajv.compile(config.requestSchema.schema);
      const valid = validate(body);

      if (!valid) {
        throw new BadRequestException({
          message: 'Request body validation failed',
          errors: validate.errors?.map((err: ErrorObject) => ({
            path: err.instancePath || '/',
            message: err.message,
            keyword: err.keyword,
            params: err.params,
          })),
        });
      }

      // Convert request body to prompt using template
      const template = config.requestSchema.promptTemplate ?? '{{json}}';
      prompt = template.replace('{{json}}', JSON.stringify(body, null, 2));

      // For requestSchema agents, rawResponse defaults based on outputFormat
      rawResponse = config.outputFormat !== undefined;
    } else {
      // Standard behavior: expect {prompt, sessionId?, forkSession?, rawResponse?}
      const dto = body as ExecuteAgentDto;
      if (!dto.prompt || typeof dto.prompt !== 'string') {
        throw new BadRequestException('Request body must include a "prompt" string');
      }
      prompt = dto.prompt;
      rawResponse = dto.rawResponse;

      // Extract session options
      if (dto.sessionId) {
        sessionOptions = {
          sessionId: dto.sessionId,
          forkSession: dto.forkSession,
        };
      }
    }

    const result = await this.agentService.execute(name, prompt, sessionOptions);

    if (!result.success && result.error?.includes('not found')) {
      throw new NotFoundException(result.error);
    }

    if (!result.success) {
      throw new HttpException(
        { success: false, error: result.error, sessionId: result.sessionId },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // Default rawResponse to true for agents with outputFormat
    const shouldReturnRaw = rawResponse ?? (config.outputFormat !== undefined);

    // Handle raw response mode with auto-detect Content-Type
    if (shouldReturnRaw) {
      // Add session ID header for raw responses
      if (result.sessionId) {
        res.setHeader('X-Session-ID', result.sessionId);
      }

      // For structured output, prefer structuredOutput over result
      if (result.structuredOutput !== undefined) {
        res.setHeader('Content-Type', 'application/json');
        return result.structuredOutput;
      }

      if (result.result) {
        try {
          const parsed = JSON.parse(result.result);
          res.setHeader('Content-Type', 'application/json');
          return parsed;
        } catch {
          res.setHeader('Content-Type', 'text/plain');
          return result.result;
        }
      }
    }

    // Return full result including sessionId
    return result;
  }

  /**
   * Create a stream session for agent execution
   *
   * Returns a stream session ID that can be used with GET /v1/stream/:sessionId to consume the SSE stream.
   * The SSE stream will include sessionId in the init and result events for session resumption.
   *
   * Supports SDK session management:
   * - New sessions: Omit sessionId to start a fresh conversation
   * - Resume: Include sessionId to continue from where you left off
   * - Fork: Include sessionId + forkSession:true to branch the conversation
   *
   * For agents with requestSchema configured, the request body is validated against the schema
   * and converted to a prompt using the configured template.
   */
  @Post(':name/stream')
  @ApiOperation({ summary: 'Create a stream session for agent execution' })
  @ApiParam({ name: 'name', description: 'Agent name' })
  @ApiBody({ type: CreateStreamDto })
  @ApiResponse({
    status: 200,
    description: 'Stream session created',
    schema: {
      properties: {
        streamSessionId: { type: 'string', description: 'ID for consuming the SSE stream' },
        streamUrl: { type: 'string' },
        expiresIn: { type: 'number' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Request validation failed' })
  @ApiResponse({ status: 404, description: 'Agent not found' })
  async createStreamSession(
    @Param('name') name: string,
    @Body() body: unknown,
  ) {
    // Verify agent exists
    const config = this.agentService.getAgentConfig(name);
    if (!config) {
      throw new NotFoundException(`Agent '${name}' not found`);
    }

    let prompt: string;
    let sessionOptions: SessionOptions | undefined;

    if (config.requestSchema) {
      // Validate request body against JSON schema
      const validate = ajv.compile(config.requestSchema.schema);
      const valid = validate(body);

      if (!valid) {
        throw new BadRequestException({
          message: 'Request body validation failed',
          errors: validate.errors?.map((err: ErrorObject) => ({
            path: err.instancePath || '/',
            message: err.message,
            keyword: err.keyword,
            params: err.params,
          })),
        });
      }

      // Convert request body to prompt using template
      const template = config.requestSchema.promptTemplate ?? '{{json}}';
      prompt = template.replace('{{json}}', JSON.stringify(body, null, 2));
    } else {
      // Standard behavior: expect {prompt, sessionId?, forkSession?}
      const dto = body as CreateStreamDto;
      if (!dto.prompt || typeof dto.prompt !== 'string') {
        throw new BadRequestException('Request body must include a "prompt" string');
      }
      prompt = dto.prompt;

      // Extract session options
      if (dto.sessionId) {
        sessionOptions = {
          sessionId: dto.sessionId,
          forkSession: dto.forkSession,
        };
      }
    }

    this.logger.log(`Creating stream session for agent: ${name}`);

    // Create session with special marker for user-defined agents
    const streamSessionId = await this.streamSession.createSession({
      pluginName: '__agent__', // Special marker to distinguish from plugin agents
      agentName: name,
      prompt,
      sessionOptions,
      // Note: maxTurns and maxBudgetUsd are defined in the agent config, not per-request
    });

    return {
      streamSessionId,
      streamUrl: `/v1/stream/${streamSessionId}`,
      expiresIn: 300, // 5 minutes
    };
  }
}
