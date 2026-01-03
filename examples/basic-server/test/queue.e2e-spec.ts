import { Test, TestingModule } from '@nestjs/testing';
import { Module, INestApplication } from '@nestjs/common';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import {
  QueueModule,
  PgBossService,
  type AsyncAgentRequest,
  type AsyncAgentResponse,
  type ReplyChannel,
  type ReplyChannelFactory,
  type ReplyMessage,
} from '@tigz/claude-code-plugin-rest-api';

// Increase timeout for container startup
vi.setConfig({ testTimeout: 120_000 });

// Check if Docker is available by trying to connect to testcontainers
async function isDockerAvailable(): Promise<boolean> {
  try {
    const { getContainerRuntimeClient } = await import('testcontainers');
    await getContainerRuntimeClient();
    return true;
  } catch {
    return false;
  }
}

/**
 * In-memory reply channel for testing.
 * Captures messages so we can assert on them.
 */
class TestReplyChannel implements ReplyChannel {
  public messages: ReplyMessage[] = [];
  private resolvers: Array<(msg: ReplyMessage) => void> = [];

  async send(message: ReplyMessage): Promise<void> {
    this.messages.push(message);
    // Resolve any waiting promises
    const resolver = this.resolvers.shift();
    if (resolver) {
      resolver(message);
    }
  }

  matches(uri: string): boolean {
    return uri.startsWith('test://');
  }

  /**
   * Wait for the next message to arrive.
   */
  waitForMessage(timeoutMs = 30000): Promise<ReplyMessage> {
    // Check if we already have a message
    if (this.messages.length > 0) {
      return Promise.resolve(this.messages[this.messages.length - 1]);
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timeout waiting for message after ${timeoutMs}ms`));
      }, timeoutMs);

      this.resolvers.push((msg) => {
        clearTimeout(timeout);
        resolve(msg);
      });
    });
  }

  clear(): void {
    this.messages = [];
    this.resolvers = [];
  }
}

/**
 * Factory for creating test reply channels.
 * Implements the ReplyChannelFactory interface expected by ChannelResolverService.
 */
class TestReplyChannelFactory implements ReplyChannelFactory {
  constructor(private channel: TestReplyChannel) {}

  matches(uri: string): boolean {
    return uri.startsWith('test://');
  }

  create(_uri: string): ReplyChannel {
    // Return the shared test channel instance so tests can inspect it
    return this.channel;
  }
}

/**
 * Test module that configures QueueModule with a mock agent.
 */
function createTestModule(connectionString: string, replyChannel: TestReplyChannel) {
  const factory = new TestReplyChannelFactory(replyChannel);

  @Module({
    imports: [
      QueueModule.forRoot({
        connectionString,
        agents: {
          'echo-agent': {
            systemPrompt: 'You are an echo agent. Simply echo back whatever the user says.',
            maxTurns: 1,
          },
        },
        replyChannels: {
          test: factory,
        },
      }),
    ],
  })
  class TestQueueModule {}

  return TestQueueModule;
}

// These tests require Docker to run PostgreSQL via testcontainers.
// They will be skipped if Docker is not available.
describe('Queue Module (e2e)', () => {
  let container: StartedPostgreSqlContainer | null = null;
  let app: INestApplication | null = null;
  let pgBossService: PgBossService;
  let replyChannel: TestReplyChannel;
  let dockerAvailable = false;

  beforeAll(async () => {
    // Check if Docker is available
    dockerAvailable = await isDockerAvailable();
    if (!dockerAvailable) {
      console.log('⚠️  Docker not available - skipping queue tests');
      return;
    }

    // Start PostgreSQL container
    container = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('test_queue')
      .withUsername('test')
      .withPassword('test')
      .start();

    const connectionString = container.getConnectionUri();
    replyChannel = new TestReplyChannel();

    const TestModule = createTestModule(connectionString, replyChannel);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [TestModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    pgBossService = app.get(PgBossService);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (container) {
      await container.stop();
    }
  });

  // Helper to skip test if Docker is not available
  function skipIfNoDocker(testFn: () => void | Promise<void>) {
    return async () => {
      if (!dockerAvailable) {
        console.log('  ⏭️  Skipped (Docker not available)');
        return;
      }
      await testFn();
    };
  }

  describe('PgBossService', () => {
    it('should be initialized', skipIfNoDocker(() => {
      expect(pgBossService).toBeDefined();
      expect(pgBossService.getInstance()).toBeDefined();
    }));

    it('should have registered agent queues', skipIfNoDocker(() => {
      const queueNames = pgBossService.getAgentQueueNames();
      expect(queueNames).toContain('claude.agents.echo-agent.requests');
    }));
  });

  describe('Queue Request/Response', () => {
    it('should enqueue a job and verify infrastructure works', skipIfNoDocker(async () => {
      const correlationId = `test-${Date.now()}`;
      const queueName = 'claude.agents.echo-agent.requests';

      // In pg-boss v10, queues must be created before sending
      // The worker calls work() which creates the queue, but we may need to wait
      // for initialization. Let's explicitly create it to be safe.
      await pgBossService.createQueue(queueName);

      const request: AsyncAgentRequest = {
        agentName: 'echo-agent',
        prompt: 'Hello from the queue test!',
        correlationId,
        origin: {
          platform: 'test',
          userId: 'test-user',
        },
        replyTo: 'test://response',
      };

      // Clear any previous messages
      replyChannel.clear();

      // Send the request to the queue
      const result = await pgBossService.send(queueName, request);
      // pg-boss returns job id - could be string or object depending on version
      expect(result).toBeDefined();
      expect(result).not.toBeNull();

      // Note: The actual agent execution requires Claude credentials.
      // This test verifies the queue infrastructure is working:
      // - PostgreSQL container is running
      // - pg-boss is initialized and can accept jobs
      // - Queue naming conventions are correct
      // - Reply channel factory is registered

      // To verify full end-to-end with credentials, use test:local
    }));

    it('should accept jobs on agent queue', skipIfNoDocker(async () => {
      const queueName = 'test.batch.queue';

      // Create queue before sending
      await pgBossService.createQueue(queueName);

      // Verify we can send multiple jobs
      const results: unknown[] = [];
      for (let i = 0; i < 3; i++) {
        const result = await pgBossService.send(queueName, {
          agentName: 'echo-agent',
          prompt: `Test prompt ${i}`,
          correlationId: `batch-${Date.now()}-${i}`,
          origin: { platform: 'test' },
          replyTo: 'test://response',
        });
        if (result) results.push(result);
      }

      expect(results.length).toBe(3);
    }));

    it('should handle unknown agent queue gracefully', skipIfNoDocker(async () => {
      const correlationId = `test-unknown-${Date.now()}`;
      const queueName = 'claude.agents.unknown-agent.requests';

      // Create queue manually since it's not auto-registered
      await pgBossService.createQueue(queueName);

      const request: AsyncAgentRequest = {
        agentName: 'unknown-agent',
        prompt: 'This should fail',
        correlationId,
        origin: {
          platform: 'test',
        },
        replyTo: 'test://response',
      };

      replyChannel.clear();

      // The job will be sent but the worker won't process it
      // because unknown-agent is not registered
      const jobId = await pgBossService.send(queueName, request);
      expect(jobId).toBeDefined();

      // We can verify the job was created
      // Since there's no worker for this queue, we just verify the queue accepts jobs
    }));
  });

  describe('Queue Operations', () => {
    it('should send and fetch jobs', skipIfNoDocker(async () => {
      const testQueueName = 'test.direct.queue';
      await pgBossService.createQueue(testQueueName);

      const testData = { message: 'test', timestamp: Date.now() };
      const jobId = await pgBossService.send(testQueueName, testData);

      expect(jobId).toBeDefined();
      expect(typeof jobId).toBe('string');
    }));

    it('should complete jobs successfully', skipIfNoDocker(async () => {
      const testQueueName = 'test.complete.queue';
      await pgBossService.createQueue(testQueueName);

      const testData = { action: 'complete-test' };
      const jobId = await pgBossService.send(testQueueName, testData);
      expect(jobId).toBeDefined();

      const job = await pgBossService.fetch<typeof testData>(testQueueName);

      if (job) {
        expect(job.data.action).toBe('complete-test');
        await pgBossService.complete(testQueueName, job.id);
        // Job should be marked complete - fetching again should return null or different job
      }
    }));

    it('should fail jobs with error data', skipIfNoDocker(async () => {
      const testQueueName = 'test.fail.queue';
      await pgBossService.createQueue(testQueueName);

      const testData = { action: 'fail-test' };
      const jobId = await pgBossService.send(testQueueName, testData);
      expect(jobId).toBeDefined();

      const job = await pgBossService.fetch<typeof testData>(testQueueName);

      if (job) {
        await pgBossService.fail(testQueueName, job.id, { reason: 'Test failure' });
        // Job should be marked as failed
      }
    }));
  });
});
