import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, Module } from '@nestjs/common';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ClaudePluginModule } from '@tigz/claude-code-plugin-rest-api';
import { HealthController } from '../src/health.controller.js';

/**
 * Local-only integration tests that require Claude Max subscription.
 *
 * These tests verify the full authentication flow using the terminal-based
 * Claude login credentials stored on your local machine.
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
    }),
  ],
  controllers: [HealthController],
})
class TestAppModule {}

describe('Agent Integration (Local)', () => {
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

  describe('Claude Max Authentication', () => {
    it('should execute agent with Claude Max subscription', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/plugins/example-plugin/agents/code-helper')
        .send({ prompt: 'What is 2 + 2? Answer with just the number.' });

      // Should succeed with Claude Max credentials
      expect([200, 201]).toContain(response.status);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('result');
      expect(response.body.result).toContain('4');

      // Verify we got usage stats back
      expect(response.body).toHaveProperty('usage');
      expect(response.body.usage).toHaveProperty('inputTokens');
      expect(response.body.usage).toHaveProperty('outputTokens');
    }, 60000);

    it('should execute command with Claude Max subscription', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/plugins/example-plugin/commands/hello')
        .send({ arguments: 'Integration Test' });

      // Should succeed with Claude Max credentials
      expect([200, 201]).toContain(response.status);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('result');
    }, 60000);

    it('should stream agent responses via SSE', async () => {
      // First create a stream session
      const sessionResponse = await request(app.getHttpServer())
        .post('/v1/plugins/stream')
        .send({
          pluginName: 'example-plugin',
          agentName: 'code-helper',
          prompt: 'Say "hello" and nothing else.',
        })
        .expect(201);

      expect(sessionResponse.body).toHaveProperty('sessionId');
      expect(sessionResponse.body).toHaveProperty('streamUrl');

      const sessionId = sessionResponse.body.sessionId;

      // Then consume the stream
      const streamResponse = await request(app.getHttpServer())
        .get(`/v1/stream/${sessionId}`)
        .set('Accept', 'text/event-stream');

      expect(streamResponse.status).toBe(200);
      expect(streamResponse.headers['content-type']).toContain('text/event-stream');
    }, 60000);
  });

  describe('Agent Response Quality', () => {
    it('should return coherent responses from code-helper agent', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/plugins/example-plugin/agents/code-helper')
        .send({
          prompt: 'Write a simple JavaScript function that adds two numbers. Just the function, no explanation.',
        });

      expect([200, 201]).toContain(response.status);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('result');

      // Verify the response contains JavaScript code
      const result = response.body.result;
      expect(result).toMatch(/function|const|=>/);
    }, 60000);
  });
});
