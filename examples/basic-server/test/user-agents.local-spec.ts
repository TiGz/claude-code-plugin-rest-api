import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, Module } from '@nestjs/common';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ClaudePluginModule } from '@tigz/claude-code-plugin-rest-api';
import { HealthController } from '../src/health.controller.js';

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
      },
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
      expect(response.body).toHaveProperty('count', 3);
      expect(Array.isArray(response.body.agents)).toBe(true);
      expect(response.body.agents).toContain('math-helper');
      expect(response.body.agents).toContain('code-analyzer');
      expect(response.body.agents).toContain('full-access-agent');
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
});
