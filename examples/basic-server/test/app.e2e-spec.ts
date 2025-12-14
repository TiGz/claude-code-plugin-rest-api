import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, Module } from '@nestjs/common';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ClaudePluginModule } from '@tigz/claude-code-plugin-rest-api';
import { HealthController } from '../src/health.controller.js';

/**
 * Test module that disables authentication for e2e tests
 */
@Module({
  imports: [
    ClaudePluginModule.forRoot({
      enablePluginEndpoints: true,
      pluginDirectory: '.claude/plugins',
      hotReload: false,
      auth: { disabled: true },
      // Add agents for requestSchema testing
      agents: {
        'standard-agent': {
          systemPrompt: 'You are a helpful assistant.',
          maxTurns: 5,
        },
        'request-schema-agent': {
          systemPrompt: 'You process orders.',
          maxTurns: 5,
          requestSchema: {
            schema: {
              type: 'object',
              properties: {
                orderId: { type: 'string' },
                items: { type: 'array', items: { type: 'object' } },
              },
              required: ['orderId', 'items'],
            },
            promptTemplate: 'Process this order:\n{{json}}',
          },
        },
        'request-schema-no-template': {
          systemPrompt: 'You echo data.',
          maxTurns: 5,
          requestSchema: {
            schema: {
              type: 'object',
              properties: {
                message: { type: 'string' },
              },
              required: ['message'],
            },
            // No promptTemplate - should use default "{{json}}"
          },
        },
      },
    }),
  ],
  controllers: [HealthController],
})
class TestAppModule {}

/**
 * Integration tests for the basic-server example.
 *
 * These tests verify the happy path for:
 * - Health check endpoint
 * - Plugin discovery
 * - Agent execution (requires Claude credentials for real execution)
 */
describe('Basic Server (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [TestAppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Health Check', () => {
    it('/health (GET) should return healthy status', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'ok');
      expect(response.body).toHaveProperty('timestamp');
    });
  });

  describe('Plugin Discovery', () => {
    it('/v1/plugins (GET) should list discovered plugins', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/plugins')
        .expect(200);

      expect(response.body).toHaveProperty('plugins');
      expect(response.body).toHaveProperty('count');
      expect(Array.isArray(response.body.plugins)).toBe(true);
    });

    it('/v1/plugins/example-plugin (GET) should return example plugin details', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/plugins/example-plugin')
        .expect(200);

      expect(response.body).toHaveProperty('name', 'example-plugin');
      expect(response.body).toHaveProperty('commands');
      expect(response.body).toHaveProperty('agents');
      expect(Array.isArray(response.body.commands)).toBe(true);
      expect(Array.isArray(response.body.agents)).toBe(true);

      // Check that hello command exists
      const helloCommand = response.body.commands.find(
        (c: { name: string }) => c.name === 'hello',
      );
      expect(helloCommand).toBeDefined();
      expect(helloCommand.endpoint).toBe(
        '/v1/plugins/example-plugin/commands/hello',
      );

      // Check that code-helper agent exists
      const codeHelperAgent = response.body.agents.find(
        (a: { name: string }) => a.name === 'code-helper',
      );
      expect(codeHelperAgent).toBeDefined();
      expect(codeHelperAgent.endpoint).toBe(
        '/v1/plugins/example-plugin/agents/code-helper',
      );
    });

    it('/v1/plugins/nonexistent (GET) should return 404', async () => {
      await request(app.getHttpServer())
        .get('/v1/plugins/nonexistent')
        .expect(404);
    });
  });

  describe('Agent Execution', () => {
    // Note: This test requires Claude credentials to actually run the agent.
    // In CI without credentials, we expect a specific error response.
    it('/v1/plugins/example-plugin/agents/code-helper (POST) should accept execution request', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/plugins/example-plugin/agents/code-helper')
        .send({ prompt: 'What is 2 + 2?' });

      // Either succeeds (with credentials) or fails gracefully (without)
      // NestJS returns 201 for POST by default when successful
      expect([200, 201, 500]).toContain(response.status);

      if (response.status === 200 || response.status === 201) {
        expect(response.body).toHaveProperty('success', true);
        expect(response.body).toHaveProperty('result');
      } else {
        // Without credentials, expect an error response
        expect(response.body).toHaveProperty('success', false);
        expect(response.body).toHaveProperty('error');
      }
    });

    it('/v1/plugins/example-plugin/agents/nonexistent (POST) should return 404', async () => {
      await request(app.getHttpServer())
        .post('/v1/plugins/example-plugin/agents/nonexistent')
        .send({ prompt: 'test' })
        .expect(404);
    });
  });

  describe('Command Execution', () => {
    it('/v1/plugins/example-plugin/commands/hello (POST) should accept execution request', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/plugins/example-plugin/commands/hello')
        .send({ arguments: 'World' });

      // Either succeeds (with credentials) or fails gracefully (without)
      // NestJS returns 201 for POST by default when successful
      expect([200, 201, 500]).toContain(response.status);

      if (response.status === 200 || response.status === 201) {
        expect(response.body).toHaveProperty('success', true);
      } else {
        expect(response.body).toHaveProperty('success', false);
        expect(response.body).toHaveProperty('error');
      }
    });

    it('/v1/plugins/example-plugin/commands/nonexistent (POST) should return 404', async () => {
      await request(app.getHttpServer())
        .post('/v1/plugins/example-plugin/commands/nonexistent')
        .send({})
        .expect(404);
    });
  });

  describe('Stream Session', () => {
    it('/v1/plugins/stream (POST) should create a stream session', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/plugins/stream')
        .send({
          pluginName: 'example-plugin',
          agentName: 'code-helper',
          prompt: 'What is 2 + 2?',
        })
        .expect(201);

      expect(response.body).toHaveProperty('sessionId');
      expect(response.body).toHaveProperty('streamUrl');
      expect(response.body).toHaveProperty('expiresIn');
      expect(response.body.streamUrl).toMatch(/^\/v1\/stream\//);
    });

    it('/v1/plugins/stream (POST) should return 404 for nonexistent agent', async () => {
      await request(app.getHttpServer())
        .post('/v1/plugins/stream')
        .send({
          pluginName: 'example-plugin',
          agentName: 'nonexistent',
          prompt: 'test',
        })
        .expect(404);
    });
  });

  describe('Request Schema Validation', () => {
    it('GET /v1/agents should list agents including request-schema-agent', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/agents')
        .expect(200);

      expect(response.body.agents).toContain('standard-agent');
      expect(response.body.agents).toContain('request-schema-agent');
      expect(response.body.agents).toContain('request-schema-no-template');
    });

    it('GET /v1/agents/request-schema-agent should show requestSchema in config', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/agents/request-schema-agent')
        .expect(200);

      expect(response.body).toHaveProperty('requestSchema');
      expect(response.body.requestSchema).toHaveProperty('schema');
      expect(response.body.requestSchema).toHaveProperty('promptTemplate', 'Process this order:\n{{json}}');
      expect(response.body.requestSchema.schema.properties).toHaveProperty('orderId');
      expect(response.body.requestSchema.schema.properties).toHaveProperty('items');
    });

    it('standard-agent should accept standard {prompt} format', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/agents/standard-agent')
        .send({ prompt: 'Hello' });

      // Either succeeds (with credentials) or fails gracefully (without)
      expect([200, 201, 500]).toContain(response.status);
    });

    it('standard-agent should reject request without prompt', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/agents/standard-agent')
        .send({ notPrompt: 'Hello' })
        .expect(400);

      expect(response.body.message).toContain('prompt');
    });

    it('request-schema-agent should accept valid custom JSON body', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/agents/request-schema-agent')
        .send({
          orderId: '12345',
          items: [{ sku: 'ABC', quantity: 2 }],
        });

      // Either succeeds (with credentials) or fails gracefully (without)
      expect([200, 201, 500]).toContain(response.status);
    });

    it('request-schema-agent should reject missing required field', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/agents/request-schema-agent')
        .send({
          // Missing orderId
          items: [{ sku: 'ABC', quantity: 2 }],
        })
        .expect(400);

      expect(response.body.message).toBe('Request body validation failed');
      expect(response.body.errors).toBeDefined();
      expect(Array.isArray(response.body.errors)).toBe(true);
      // Should have an error about missing orderId
      const hasOrderIdError = response.body.errors.some(
        (e: { keyword: string }) => e.keyword === 'required',
      );
      expect(hasOrderIdError).toBe(true);
    });

    it('request-schema-agent should reject wrong type', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/agents/request-schema-agent')
        .send({
          orderId: 12345, // Should be string, not number
          items: [{ sku: 'ABC', quantity: 2 }],
        })
        .expect(400);

      expect(response.body.message).toBe('Request body validation failed');
      expect(response.body.errors).toBeDefined();
      // Should have an error about type mismatch
      const hasTypeError = response.body.errors.some(
        (e: { keyword: string }) => e.keyword === 'type',
      );
      expect(hasTypeError).toBe(true);
    });

    it('request-schema-agent should reject {prompt} format', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/agents/request-schema-agent')
        .send({ prompt: 'This is a prompt' })
        .expect(400);

      expect(response.body.message).toBe('Request body validation failed');
    });

    it('request-schema-no-template agent should work with default template', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/agents/request-schema-no-template')
        .send({ message: 'Hello World' });

      // Either succeeds (with credentials) or fails gracefully (without)
      expect([200, 201, 500]).toContain(response.status);
    });

    it('request-schema-agent streaming should validate request body', async () => {
      // Valid request should create session
      const validResponse = await request(app.getHttpServer())
        .post('/v1/agents/request-schema-agent/stream')
        .send({
          orderId: '12345',
          items: [{ sku: 'ABC', quantity: 2 }],
        })
        .expect(201);

      expect(validResponse.body).toHaveProperty('sessionId');
      expect(validResponse.body).toHaveProperty('streamUrl');
    });

    it('request-schema-agent streaming should reject invalid request body', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/agents/request-schema-agent/stream')
        .send({
          // Missing required fields
          invalidField: 'test',
        })
        .expect(400);

      expect(response.body.message).toBe('Request body validation failed');
    });
  });
});
