import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, Module } from '@nestjs/common';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ClaudePluginModule } from '@tigz/claude-code-plugin-api';
import { HealthController } from '../src/health.controller.js';

/**
 * Test module that disables authentication for e2e tests
 */
@Module({
  imports: [
    ClaudePluginModule.forRoot({
      pluginDirectory: '.claude/plugins',
      hotReload: false,
      auth: { disabled: true },
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
});
