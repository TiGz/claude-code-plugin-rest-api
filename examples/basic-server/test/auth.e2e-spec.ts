import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, Module } from '@nestjs/common';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { ClaudePluginModule } from '@tigz/claude-code-plugin-rest-api';
import { HealthController } from '../src/health.controller.js';

/**
 * E2E tests for Basic Auth functionality.
 *
 * Tests verify:
 * - Protected endpoints require authentication
 * - Valid credentials grant access
 * - Invalid credentials are rejected
 * - Excluded paths bypass authentication
 * - Disabled auth allows all requests
 */

describe('Basic Auth (e2e)', () => {
  let tempDir: string;
  let authFilePath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'auth-e2e-'));
    authFilePath = path.join(tempDir, 'auth.yml');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function createAuthFile(content: string) {
    await fs.writeFile(authFilePath, content);
  }

  function basicAuth(username: string, password: string): string {
    return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
  }

  describe('Auth Enabled', () => {
    let app: INestApplication;

    beforeEach(async () => {
      await createAuthFile(`
users:
  - username: admin
    password: secret123
  - username: readonly
    password: readpass
`);

      @Module({
        imports: [
          ClaudePluginModule.forRoot({
            enablePluginEndpoints: true,
            pluginDirectory: '.claude/plugins',
            hotReload: false,
            auth: {
              disabled: false,
              authFilePath: authFilePath,
              excludePaths: ['/health', '/api/docs*'],
            },
          }),
        ],
        controllers: [HealthController],
      })
      class AuthEnabledModule {}

      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AuthEnabledModule],
      }).compile();

      app = moduleFixture.createNestApplication();
      await app.init();
    });

    afterEach(async () => {
      await app.close();
    });

    it('should reject requests without Authorization header', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/plugins')
        .expect(401);

      expect(response.body.message).toBe('Missing or invalid Authorization header');
    });

    it('should reject requests with invalid credentials', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/plugins')
        .set('Authorization', basicAuth('admin', 'wrongpassword'))
        .expect(401);

      expect(response.body.message).toBe('Invalid credentials');
    });

    it('should reject requests with non-existent user', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/plugins')
        .set('Authorization', basicAuth('nonexistent', 'password'))
        .expect(401);

      expect(response.body.message).toBe('Invalid credentials');
    });

    it('should reject malformed Authorization header', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/plugins')
        .set('Authorization', 'Bearer token123')
        .expect(401);

      expect(response.body.message).toBe('Missing or invalid Authorization header');
    });

    it('should allow requests with valid credentials', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/plugins')
        .set('Authorization', basicAuth('admin', 'secret123'))
        .expect(200);

      expect(response.body).toHaveProperty('plugins');
    });

    it('should allow requests from different valid users', async () => {
      // Test admin user
      await request(app.getHttpServer())
        .get('/v1/plugins')
        .set('Authorization', basicAuth('admin', 'secret123'))
        .expect(200);

      // Test readonly user
      await request(app.getHttpServer())
        .get('/v1/plugins')
        .set('Authorization', basicAuth('readonly', 'readpass'))
        .expect(200);
    });

    it('should allow excluded path /health without auth', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'ok');
    });

    it('should protect non-excluded paths', async () => {
      // Plugin endpoints require auth
      await request(app.getHttpServer())
        .get('/v1/plugins')
        .expect(401);

      // But excluded paths don't
      await request(app.getHttpServer())
        .get('/health')
        .expect(200);
    });
  });

  describe('Auth Disabled', () => {
    let app: INestApplication;

    beforeAll(async () => {
      @Module({
        imports: [
          ClaudePluginModule.forRoot({
            enablePluginEndpoints: true,
            pluginDirectory: '.claude/plugins',
            hotReload: false,
            auth: { disabled: true },
          }),
        ],
        controllers: [HealthController],
      })
      class AuthDisabledModule {}

      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AuthDisabledModule],
      }).compile();

      app = moduleFixture.createNestApplication();
      await app.init();
    });

    afterAll(async () => {
      await app.close();
    });

    it('should allow requests without any auth when disabled', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/plugins')
        .expect(200);

      expect(response.body).toHaveProperty('plugins');
    });

    it('should still work with auth headers when disabled', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/plugins')
        .set('Authorization', basicAuth('anyuser', 'anypass'))
        .expect(200);

      expect(response.body).toHaveProperty('plugins');
    });
  });

  describe('Wildcard Exclude Paths', () => {
    let app: INestApplication;

    beforeEach(async () => {
      await createAuthFile(`
users:
  - username: admin
    password: secret
`);

      @Module({
        imports: [
          ClaudePluginModule.forRoot({
            enablePluginEndpoints: true,
            pluginDirectory: '.claude/plugins',
            hotReload: false,
            auth: {
              disabled: false,
              authFilePath: authFilePath,
              excludePaths: ['/health', '/v1/plugins*'],
            },
          }),
        ],
        controllers: [HealthController],
      })
      class WildcardExcludeModule {}

      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [WildcardExcludeModule],
      }).compile();

      app = moduleFixture.createNestApplication();
      await app.init();
    });

    afterEach(async () => {
      await app.close();
    });

    it('should exclude paths matching wildcard pattern', async () => {
      // /v1/plugins should match /v1/plugins*
      await request(app.getHttpServer())
        .get('/v1/plugins')
        .expect(200);

      // /v1/plugins/example-plugin should also match
      await request(app.getHttpServer())
        .get('/v1/plugins/example-plugin')
        .expect(200);
    });

    it('should still protect non-matching paths', async () => {
      // /v1/agents does not match /v1/plugins* - but wait, we don't have agents registered
      // Let's test with stream endpoint
      await request(app.getHttpServer())
        .get('/v1/stream/nonexistent')
        .expect(401);
    });
  });

  describe('Missing Auth File', () => {
    let app: INestApplication;

    beforeAll(async () => {
      @Module({
        imports: [
          ClaudePluginModule.forRoot({
            enablePluginEndpoints: true,
            pluginDirectory: '.claude/plugins',
            hotReload: false,
            auth: {
              disabled: false,
              authFilePath: '/nonexistent/path/auth.yml',
              excludePaths: ['/health'],
            },
          }),
        ],
        controllers: [HealthController],
      })
      class MissingAuthFileModule {}

      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [MissingAuthFileModule],
      }).compile();

      app = moduleFixture.createNestApplication();
      await app.init();
    });

    afterAll(async () => {
      await app.close();
    });

    it('should reject all auth attempts when auth file is missing', async () => {
      // Even with credentials, should fail because no users are loaded
      const response = await request(app.getHttpServer())
        .get('/v1/plugins')
        .set('Authorization', basicAuth('admin', 'password'))
        .expect(401);

      expect(response.body.message).toBe('Invalid credentials');
    });

    it('should still allow excluded paths', async () => {
      await request(app.getHttpServer())
        .get('/health')
        .expect(200);
    });
  });
});
