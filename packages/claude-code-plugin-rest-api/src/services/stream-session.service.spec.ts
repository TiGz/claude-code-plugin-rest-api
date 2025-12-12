import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StreamSessionService } from './stream-session.service.js';

describe('StreamSessionService', () => {
  let service: StreamSessionService;

  beforeEach(() => {
    vi.useFakeTimers();
    service = new StreamSessionService();
  });

  afterEach(() => {
    service.onModuleDestroy();
    vi.useRealTimers();
  });

  describe('createSession', () => {
    it('should create a session and return an id', async () => {
      const sessionId = await service.createSession({
        pluginName: 'test-plugin',
        agentName: 'test-agent',
        prompt: 'Hello world',
      });

      expect(sessionId).toBeDefined();
      expect(typeof sessionId).toBe('string');
      expect(sessionId.length).toBeGreaterThan(0);
    });

    it('should create unique session ids', async () => {
      const id1 = await service.createSession({
        pluginName: 'plugin',
        agentName: 'agent',
        prompt: 'prompt1',
      });

      const id2 = await service.createSession({
        pluginName: 'plugin',
        agentName: 'agent',
        prompt: 'prompt2',
      });

      expect(id1).not.toBe(id2);
    });

    it('should store optional parameters', async () => {
      const sessionId = await service.createSession({
        pluginName: 'test-plugin',
        agentName: 'test-agent',
        prompt: 'Hello',
        maxTurns: 100,
        maxBudgetUsd: 25.0,
      });

      const session = service.getSession(sessionId);
      expect(session).toBeDefined();
      expect(session?.maxTurns).toBe(100);
      expect(session?.maxBudgetUsd).toBe(25.0);
    });
  });

  describe('getSession', () => {
    it('should retrieve an existing session', async () => {
      const sessionId = await service.createSession({
        pluginName: 'test-plugin',
        agentName: 'test-agent',
        prompt: 'Hello',
      });

      const session = service.getSession(sessionId);

      expect(session).toBeDefined();
      expect(session?.id).toBe(sessionId);
      expect(session?.pluginName).toBe('test-plugin');
      expect(session?.agentName).toBe('test-agent');
      expect(session?.prompt).toBe('Hello');
      expect(session?.consumed).toBe(false);
    });

    it('should return undefined for non-existent session', () => {
      const session = service.getSession('non-existent-id');
      expect(session).toBeUndefined();
    });

    it('should return undefined for expired session', async () => {
      const sessionId = await service.createSession({
        pluginName: 'test-plugin',
        agentName: 'test-agent',
        prompt: 'Hello',
      });

      // Advance time past TTL (5 minutes + 1ms)
      vi.advanceTimersByTime(5 * 60 * 1000 + 1);

      const session = service.getSession(sessionId);
      expect(session).toBeUndefined();
    });

    it('should return undefined for consumed session', async () => {
      const sessionId = await service.createSession({
        pluginName: 'test-plugin',
        agentName: 'test-agent',
        prompt: 'Hello',
      });

      service.markConsumed(sessionId);

      const session = service.getSession(sessionId);
      expect(session).toBeUndefined();
    });
  });

  describe('markConsumed', () => {
    it('should mark session as consumed', async () => {
      const sessionId = await service.createSession({
        pluginName: 'test-plugin',
        agentName: 'test-agent',
        prompt: 'Hello',
      });

      // Session is available before marking
      expect(service.getSession(sessionId)).toBeDefined();

      service.markConsumed(sessionId);

      // Session is no longer available after marking
      expect(service.getSession(sessionId)).toBeUndefined();
    });

    it('should handle marking non-existent session gracefully', () => {
      expect(() => service.markConsumed('non-existent')).not.toThrow();
    });
  });

  describe('session cleanup', () => {
    it('should clean up expired sessions automatically', async () => {
      const sessionId = await service.createSession({
        pluginName: 'test-plugin',
        agentName: 'test-agent',
        prompt: 'Hello',
      });

      // Session exists initially
      expect(service.getSession(sessionId)).toBeDefined();

      // Advance past expiration and trigger cleanup interval
      vi.advanceTimersByTime(6 * 60 * 1000); // 6 minutes

      // Session should be expired now
      expect(service.getSession(sessionId)).toBeUndefined();
    });
  });
});
