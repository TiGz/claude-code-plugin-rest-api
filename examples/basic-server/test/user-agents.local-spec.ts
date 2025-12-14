import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, Module } from '@nestjs/common';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ClaudePluginModule, createSdkMcpServer, tool, z } from '@tigz/claude-code-plugin-rest-api';
import { HealthController } from '../src/health.controller.js';

/**
 * Create an in-process MCP server with custom tools.
 * This runs in the same process as the NestJS application.
 */
const calculatorMcpServer = createSdkMcpServer({
  name: 'calculator',
  version: '1.0.0',
  tools: [
    tool(
      'add',
      'Add two numbers together',
      { a: z.number().describe('First number'), b: z.number().describe('Second number') },
      async (args) => ({
        content: [{ type: 'text', text: `${args.a + args.b}` }],
      }),
    ),
    tool(
      'multiply',
      'Multiply two numbers together',
      { a: z.number().describe('First number'), b: z.number().describe('Second number') },
      async (args) => ({
        content: [{ type: 'text', text: `${args.a * args.b}` }],
      }),
    ),
  ],
});

/**
 * Local-only integration tests for user-defined agents with full SDK options.
 *
 * These tests verify:
 * - User-defined agents configured in code (not markdown files)
 * - Full SDK option passthrough (permissionMode, tools, etc.)
 * - Both request/response and streaming modes
 *
 * Run with: pnpm test:local
 *
 * Prerequisites:
 * - Run `claude login` in terminal to authenticate with Claude Max
 * - Ensure ANTHROPIC_API_KEY is NOT set (uses terminal auth instead)
 */

@Module({
  imports: [
    ClaudePluginModule.forRoot({
      pluginDirectory: '.claude/plugins',
      hotReload: false,
      auth: { disabled: true },
      // User-defined agents with full SDK options
      agents: {
        'math-helper': {
          systemPrompt: 'You are a math helper. Answer math questions concisely with just the answer.',
          maxTurns: 5,
          maxBudgetUsd: 1.0,
        },
        'code-analyzer': {
          systemPrompt: 'You are a code analyzer. When asked about code, provide brief analysis.',
          allowedTools: ['Read', 'Glob', 'Grep'],
          permissionMode: 'default',
          maxTurns: 10,
        },
        'full-access-agent': {
          systemPrompt: 'You are a helpful assistant with full tool access.',
          permissionMode: 'bypassPermissions',
          tools: { type: 'preset', preset: 'claude_code' },
          maxTurns: 5,
          maxBudgetUsd: 2.0,
        },
        'structured-output-agent': {
          systemPrompt: 'You analyze numbers and return structured JSON results. Always respond with valid JSON matching the schema.',
          maxTurns: 5,
          maxBudgetUsd: 1.0,
          outputFormat: {
            type: 'json_schema',
            schema: {
              type: 'object',
              properties: {
                number: { type: 'number' },
                isEven: { type: 'boolean' },
                doubled: { type: 'number' },
              },
              required: ['number', 'isEven', 'doubled'],
              additionalProperties: false,
            },
          },
        },
        // Agent with custom MCP tools (in-process)
        'mcp-calculator': {
          systemPrompt: 'You are a calculator assistant. Use the calculator MCP tools (add, multiply) to perform calculations. Always use the tools - do not calculate mentally. Return just the numeric result.',
          maxTurns: 5,
          maxBudgetUsd: 1.0,
          permissionMode: 'bypassPermissions',
          mcpServers: {
            calculator: calculatorMcpServer,
          },
          allowedTools: ['mcp__calculator__add', 'mcp__calculator__multiply'],
        },
        // Agent that loads file-based plugins via SDK (NOT via plugin endpoints)
        'plugin-user': {
          systemPrompt: 'You are a helpful assistant. Answer questions concisely.',
          maxTurns: 5,
          maxBudgetUsd: 1.0,
          permissionMode: 'bypassPermissions',
          // Load plugin from filesystem - this works even with enablePluginEndpoints: false
          plugins: [{ type: 'local', path: '.claude/plugins/example-plugin' }],
        },
        // Agent with custom request schema (no structured output)
        'request-schema-echo': {
          systemPrompt: 'You receive order data. Echo back the orderId and count of items in the format: "Order [orderId] has [count] items"',
          maxTurns: 3,
          maxBudgetUsd: 0.5,
          requestSchema: {
            schema: {
              type: 'object',
              properties: {
                orderId: { type: 'string' },
                items: { type: 'array', items: { type: 'object' } },
              },
              required: ['orderId', 'items'],
            },
            promptTemplate: 'Process this order and echo back the orderId and item count:\n{{json}}',
          },
        },
        // Agent with both request schema and structured output
        'order-processor': {
          systemPrompt: 'You analyze orders and return structured data. Given order data, return the orderId as-is, count of items, and whether total items exceeds 5.',
          maxTurns: 3,
          maxBudgetUsd: 0.5,
          requestSchema: {
            schema: {
              type: 'object',
              properties: {
                orderId: { type: 'string' },
                items: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      sku: { type: 'string' },
                      quantity: { type: 'number' },
                    },
                  },
                },
              },
              required: ['orderId', 'items'],
            },
            promptTemplate: 'Analyze this order:\n{{json}}',
          },
          outputFormat: {
            type: 'json_schema',
            schema: {
              type: 'object',
              properties: {
                orderId: { type: 'string' },
                itemCount: { type: 'number' },
                isLargeOrder: { type: 'boolean' },
              },
              required: ['orderId', 'itemCount', 'isLargeOrder'],
              additionalProperties: false,
            },
          },
        },
      },
      // Note: enablePluginEndpoints is NOT set (defaults to false)
      // This proves agents can still use plugins via the SDK's plugins option
    }),
  ],
  controllers: [HealthController],
})
class TestAppModule {}

describe('User-Defined Agents Integration (Local)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [TestAppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  describe('Agent Discovery', () => {
    it('GET /v1/agents should list all user-defined agents', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/agents')
        .expect(200);

      expect(response.body).toHaveProperty('agents');
      expect(response.body).toHaveProperty('count', 8);
      expect(Array.isArray(response.body.agents)).toBe(true);
      expect(response.body.agents).toContain('math-helper');
      expect(response.body.agents).toContain('code-analyzer');
      expect(response.body.agents).toContain('full-access-agent');
      expect(response.body.agents).toContain('structured-output-agent');
      expect(response.body.agents).toContain('mcp-calculator');
      expect(response.body.agents).toContain('plugin-user');
      expect(response.body.agents).toContain('request-schema-echo');
      expect(response.body.agents).toContain('order-processor');
    });

    it('GET /v1/agents/:name should return agent config', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/agents/math-helper')
        .expect(200);

      expect(response.body).toHaveProperty('systemPrompt');
      expect(response.body.systemPrompt).toContain('math helper');
      expect(response.body).toHaveProperty('maxTurns', 5);
      expect(response.body).toHaveProperty('maxBudgetUsd', 1.0);
    });

    it('GET /v1/agents/:name should return 404 for nonexistent agent', async () => {
      await request(app.getHttpServer())
        .get('/v1/agents/nonexistent')
        .expect(404);
    });
  });

  describe('Agent Execution (Request/Response)', () => {
    it('POST /v1/agents/math-helper should execute and return result', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/agents/math-helper')
        .send({ prompt: 'What is 15 + 27? Answer with just the number.' });

      expect([200, 201]).toContain(response.status);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('result');
      expect(response.body.result).toContain('42');
    }, 60000);

    it('POST /v1/agents/full-access-agent should execute with bypassPermissions', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/agents/full-access-agent')
        .send({ prompt: 'What is 3 * 7? Answer with just the number.' });

      expect([200, 201]).toContain(response.status);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('result');
      expect(response.body.result).toContain('21');
    }, 60000);

    it('POST /v1/agents/:name should return 404 for nonexistent agent', async () => {
      await request(app.getHttpServer())
        .post('/v1/agents/nonexistent')
        .send({ prompt: 'test' })
        .expect(404);
    });
  });

  describe('Agent Streaming', () => {
    it('POST /v1/agents/:name/stream should create a stream session', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/agents/math-helper/stream')
        .send({ prompt: 'What is 10 + 5?' })
        .expect(201);

      expect(response.body).toHaveProperty('sessionId');
      expect(response.body).toHaveProperty('streamUrl');
      expect(response.body).toHaveProperty('expiresIn');
      expect(response.body.streamUrl).toMatch(/^\/v1\/stream\//);
    });

    it('should consume stream via SSE endpoint', async () => {
      // First create a stream session
      const sessionResponse = await request(app.getHttpServer())
        .post('/v1/agents/math-helper/stream')
        .send({ prompt: 'Say "hello" and nothing else.' })
        .expect(201);

      expect(sessionResponse.body).toHaveProperty('sessionId');
      const sessionId = sessionResponse.body.sessionId;

      // Then consume the stream
      const streamResponse = await request(app.getHttpServer())
        .get(`/v1/stream/${sessionId}`)
        .set('Accept', 'text/event-stream');

      expect(streamResponse.status).toBe(200);
      expect(streamResponse.headers['content-type']).toContain('text/event-stream');
    }, 60000);

    it('POST /v1/agents/:name/stream should return 404 for nonexistent agent', async () => {
      await request(app.getHttpServer())
        .post('/v1/agents/nonexistent/stream')
        .send({ prompt: 'test' })
        .expect(404);
    });
  });

  describe('Agent Response Quality', () => {
    it('code-analyzer should provide code analysis', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/agents/code-analyzer')
        .send({
          prompt: 'What is a JavaScript arrow function? Answer in one sentence.',
        });

      expect([200, 201]).toContain(response.status);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('result');

      // Verify the response mentions arrow functions
      const result = response.body.result.toLowerCase();
      expect(result).toMatch(/arrow|=>|function/);
    }, 60000);
  });

  describe('Structured Output', () => {
    it('structured-output-agent should return validated JSON directly (rawResponse defaults true)', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/agents/structured-output-agent')
        .send({
          prompt: 'Analyze the number 42. Return the number, whether it is even, and what it equals when doubled.',
        });

      expect([200, 201]).toContain(response.status);

      // With outputFormat defined, rawResponse defaults to true
      // So the structured output is returned directly, not wrapped
      const output = response.body;

      expect(output).toHaveProperty('number');
      expect(typeof output.number).toBe('number');
      expect(output.number).toBe(42);

      expect(output).toHaveProperty('isEven');
      expect(typeof output.isEven).toBe('boolean');
      expect(output.isEven).toBe(true);

      expect(output).toHaveProperty('doubled');
      expect(typeof output.doubled).toBe('number');
      expect(output.doubled).toBe(84);
    }, 60000);

    it('GET /v1/agents/structured-output-agent should show outputFormat in config', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/agents/structured-output-agent')
        .expect(200);

      expect(response.body).toHaveProperty('outputFormat');
      expect(response.body.outputFormat).toHaveProperty('type', 'json_schema');
      expect(response.body.outputFormat).toHaveProperty('schema');
      expect(response.body.outputFormat.schema).toHaveProperty('properties');
    });
  });

  describe('Custom MCP Tools', () => {
    it('mcp-calculator should use custom add tool', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/agents/mcp-calculator')
        .send({
          prompt: 'Use the add tool to calculate 17 + 25. Return just the number.',
        });

      expect([200, 201]).toContain(response.status);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('result');
      // The result should contain 42 (17 + 25)
      expect(response.body.result).toContain('42');
    }, 60000);

    it('mcp-calculator should use custom multiply tool', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/agents/mcp-calculator')
        .send({
          prompt: 'Use the multiply tool to calculate 6 * 7. Return just the number.',
        });

      expect([200, 201]).toContain(response.status);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('result');
      // The result should contain 42 (6 * 7)
      expect(response.body.result).toContain('42');
    }, 60000);

    it('GET /v1/agents/mcp-calculator should show mcpServers in config', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/agents/mcp-calculator')
        .expect(200);

      expect(response.body).toHaveProperty('mcpServers');
      expect(response.body.mcpServers).toHaveProperty('calculator');
      expect(response.body).toHaveProperty('allowedTools');
      expect(response.body.allowedTools).toContain('mcp__calculator__add');
      expect(response.body.allowedTools).toContain('mcp__calculator__multiply');
    });
  });

  describe('Plugin Endpoints Disabled', () => {
    it('GET /v1/plugins should return 404 when enablePluginEndpoints is false', async () => {
      // Since enablePluginEndpoints defaults to false, plugin endpoints should not be available
      await request(app.getHttpServer())
        .get('/v1/plugins')
        .expect(404);
    });

    it('plugin-user agent should still work (loads plugins via SDK, not endpoints)', async () => {
      // This agent uses the SDK's plugins option to load file-based plugins
      // This works independently of enablePluginEndpoints
      const response = await request(app.getHttpServer())
        .post('/v1/agents/plugin-user')
        .send({ prompt: 'What is 5 + 5? Answer with just the number.' });

      expect([200, 201]).toContain(response.status);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('result');
      expect(response.body.result).toContain('10');
    }, 60000);

    it('GET /v1/agents/plugin-user should show plugins in config', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/agents/plugin-user')
        .expect(200);

      expect(response.body).toHaveProperty('plugins');
      expect(Array.isArray(response.body.plugins)).toBe(true);
      expect(response.body.plugins[0]).toHaveProperty('type', 'local');
      expect(response.body.plugins[0]).toHaveProperty('path', '.claude/plugins/example-plugin');
    });
  });

  describe('Request Schema Agents', () => {
    it('GET /v1/agents/request-schema-echo should show requestSchema config', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/agents/request-schema-echo')
        .expect(200);

      expect(response.body).toHaveProperty('requestSchema');
      expect(response.body.requestSchema).toHaveProperty('schema');
      expect(response.body.requestSchema).toHaveProperty('promptTemplate');
      expect(response.body.requestSchema.promptTemplate).toContain('{{json}}');
    });

    it('GET /v1/agents/order-processor should show both requestSchema and outputFormat', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/agents/order-processor')
        .expect(200);

      expect(response.body).toHaveProperty('requestSchema');
      expect(response.body).toHaveProperty('outputFormat');
      expect(response.body.outputFormat).toHaveProperty('type', 'json_schema');
    });

    it('request-schema-echo should process custom JSON body and return result', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/agents/request-schema-echo')
        .send({
          orderId: 'ORD-12345',
          items: [
            { sku: 'ABC', quantity: 2 },
            { sku: 'DEF', quantity: 3 },
          ],
        });

      expect([200, 201]).toContain(response.status);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('result');
      // The agent should echo back the orderId and count
      const result = response.body.result.toLowerCase();
      expect(result).toMatch(/ord-12345|12345/i);
      expect(result).toMatch(/2|two/i);
    }, 60000);

    it('order-processor should accept custom JSON and return structured output', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/agents/order-processor')
        .send({
          orderId: 'ORD-99999',
          items: [
            { sku: 'WIDGET-A', quantity: 3 },
            { sku: 'WIDGET-B', quantity: 4 },
          ],
        });

      expect([200, 201]).toContain(response.status);

      // With outputFormat + requestSchema, rawResponse defaults to true
      // So response body should be the structured output directly
      expect(response.body).toHaveProperty('orderId', 'ORD-99999');
      expect(response.body).toHaveProperty('itemCount');
      expect(typeof response.body.itemCount).toBe('number');
      // Agent may count distinct items (2) or total quantity (7) - both are valid interpretations
      expect([2, 7]).toContain(response.body.itemCount);
      expect(response.body).toHaveProperty('isLargeOrder');
      expect(typeof response.body.isLargeOrder).toBe('boolean');
    }, 60000);

    it('order-processor should return isLargeOrder=true for large orders', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/agents/order-processor')
        .send({
          orderId: 'ORD-LARGE',
          items: [
            { sku: 'A', quantity: 1 },
            { sku: 'B', quantity: 1 },
            { sku: 'C', quantity: 1 },
            { sku: 'D', quantity: 1 },
            { sku: 'E', quantity: 1 },
            { sku: 'F', quantity: 1 },
          ],
        });

      expect([200, 201]).toContain(response.status);
      expect(response.body).toHaveProperty('orderId', 'ORD-LARGE');
      expect(response.body).toHaveProperty('itemCount', 6);
      expect(response.body).toHaveProperty('isLargeOrder', true);
    }, 60000);

    it('request-schema-echo streaming should work with custom JSON body', async () => {
      const sessionResponse = await request(app.getHttpServer())
        .post('/v1/agents/request-schema-echo/stream')
        .send({
          orderId: 'STREAM-001',
          items: [{ sku: 'TEST', quantity: 1 }],
        })
        .expect(201);

      expect(sessionResponse.body).toHaveProperty('sessionId');
      expect(sessionResponse.body).toHaveProperty('streamUrl');

      // Consume the stream
      const streamResponse = await request(app.getHttpServer())
        .get(`/v1/stream/${sessionResponse.body.sessionId}`)
        .set('Accept', 'text/event-stream');

      expect(streamResponse.status).toBe(200);
      expect(streamResponse.headers['content-type']).toContain('text/event-stream');
    }, 60000);
  });
});
