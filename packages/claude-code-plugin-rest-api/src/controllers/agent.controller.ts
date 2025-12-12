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
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiParam, ApiBody, ApiResponse } from '@nestjs/swagger';
import { AgentService } from '../services/agent.service.js';
import { StreamSessionService } from '../services/stream-session.service.js';
import { AgentConfig } from '../types/plugin.types.js';

class ExecuteAgentDto {
  prompt!: string;
  /**
   * When true, returns the agent's output directly without wrapper.
   * Content-Type is auto-detected: JSON if parseable, otherwise text/plain.
   */
  rawResponse?: boolean;
}

class CreateStreamDto {
  prompt!: string;
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
   * By default, returns a wrapped response with metadata (success, result, cost, turns, usage).
   * When `rawResponse: true`, returns the agent's output directly with auto-detected Content-Type.
   */
  @Post(':name')
  @ApiOperation({ summary: 'Execute an agent' })
  @ApiParam({ name: 'name', description: 'Agent name' })
  @ApiBody({ type: ExecuteAgentDto })
  @ApiResponse({ status: 200, description: 'Execution result' })
  @ApiResponse({ status: 404, description: 'Agent not found' })
  async executeAgent(
    @Param('name') name: string,
    @Body() dto: ExecuteAgentDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.logger.log(`Executing agent: ${name}`);

    const result = await this.agentService.execute(name, dto.prompt);

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
        const parsed = JSON.parse(result.result);
        res.setHeader('Content-Type', 'application/json');
        return parsed;
      } catch {
        res.setHeader('Content-Type', 'text/plain');
        return result.result;
      }
    }

    return result;
  }

  /**
   * Create a stream session for agent execution
   *
   * Returns a session ID that can be used with GET /v1/stream/:sessionId to consume the SSE stream.
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
        sessionId: { type: 'string' },
        streamUrl: { type: 'string' },
        expiresIn: { type: 'number' },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Agent not found' })
  async createStreamSession(
    @Param('name') name: string,
    @Body() dto: CreateStreamDto,
  ) {
    // Verify agent exists
    const config = this.agentService.getAgentConfig(name);
    if (!config) {
      throw new NotFoundException(`Agent '${name}' not found`);
    }

    this.logger.log(`Creating stream session for agent: ${name}`);

    // Create session with special marker for user-defined agents
    const sessionId = await this.streamSession.createSession({
      pluginName: '__agent__', // Special marker to distinguish from plugin agents
      agentName: name,
      prompt: dto.prompt,
      // Note: maxTurns and maxBudgetUsd are defined in the agent config, not per-request
    });

    return {
      sessionId,
      streamUrl: `/v1/stream/${sessionId}`,
      expiresIn: 300, // 5 minutes
    };
  }
}
