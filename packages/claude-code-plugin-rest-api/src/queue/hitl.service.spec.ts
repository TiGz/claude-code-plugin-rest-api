import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HITLService } from './hitl.service.js';
import type { PgBossService } from './pgboss.service.js';

describe('HITLService', () => {
  let service: HITLService;
  let mockPgBoss: Partial<PgBossService>;

  beforeEach(() => {
    mockPgBoss = {
      fetch: vi.fn(),
      complete: vi.fn(),
      send: vi.fn(),
    };

    service = new HITLService(mockPgBoss as PgBossService, {});
  });

  describe('matchesPattern', () => {
    it('should return false for undefined patterns', () => {
      expect(service.matchesPattern('Bash', undefined)).toBe(false);
    });

    it('should return false for empty patterns array', () => {
      expect(service.matchesPattern('Bash', [])).toBe(false);
    });

    it('should match exact tool names', () => {
      expect(service.matchesPattern('Bash', ['Bash'])).toBe(true);
      expect(service.matchesPattern('Read', ['Read'])).toBe(true);
      expect(service.matchesPattern('Edit', ['Edit'])).toBe(true);
    });

    it('should not match different tool names', () => {
      expect(service.matchesPattern('Bash', ['Read'])).toBe(false);
      expect(service.matchesPattern('Write', ['Edit'])).toBe(false);
    });

    it('should match case-insensitively', () => {
      expect(service.matchesPattern('bash', ['Bash'])).toBe(true);
      expect(service.matchesPattern('BASH', ['bash'])).toBe(true);
      expect(service.matchesPattern('BaSh', ['bAsH'])).toBe(true);
    });

    it('should match with wildcard at end', () => {
      expect(service.matchesPattern('Bash:kubectl apply', ['Bash:kubectl*'])).toBe(true);
      expect(service.matchesPattern('Bash:kubectl', ['Bash:kubectl*'])).toBe(true);
      expect(service.matchesPattern('Bash:docker', ['Bash:kubectl*'])).toBe(false);
    });

    it('should match with wildcard at start', () => {
      expect(service.matchesPattern('Bash:deploy-production', ['*production'])).toBe(true);
      expect(service.matchesPattern('production', ['*production'])).toBe(true);
      expect(service.matchesPattern('Bash:deploy-staging', ['*production'])).toBe(false);
    });

    it('should match with wildcard in middle', () => {
      expect(service.matchesPattern('Bash:kubectl apply -n production', ['Bash:*production'])).toBe(true);
      expect(service.matchesPattern('Bash:deploy-to-production', ['Bash:*production'])).toBe(true);
    });

    it('should match multiple wildcards', () => {
      expect(service.matchesPattern('Bash:kubectl apply -n prod', ['Bash:*apply*prod*'])).toBe(true);
      expect(service.matchesPattern('Bash:helm install prod', ['Bash:*apply*prod*'])).toBe(false);
    });

    it('should match standalone wildcard', () => {
      expect(service.matchesPattern('AnyTool', ['*'])).toBe(true);
      expect(service.matchesPattern('Bash:anything', ['*'])).toBe(true);
    });

    it('should match colon-separated patterns', () => {
      expect(service.matchesPattern('Edit:src/config.ts', ['Edit:*'])).toBe(true);
      expect(service.matchesPattern('Edit:anything', ['Edit:*'])).toBe(true);
      expect(service.matchesPattern('Write:anything', ['Edit:*'])).toBe(false);
    });

    it('should match if any pattern matches', () => {
      const patterns = ['Bash:kubectl*', 'Bash:docker*', 'Edit:*'];
      expect(service.matchesPattern('Bash:kubectl apply', patterns)).toBe(true);
      expect(service.matchesPattern('Bash:docker run', patterns)).toBe(true);
      expect(service.matchesPattern('Edit:file.ts', patterns)).toBe(true);
      expect(service.matchesPattern('Read:file.ts', patterns)).toBe(false);
    });

    it('should escape regex special characters except *', () => {
      expect(service.matchesPattern('Tool.name', ['Tool.name'])).toBe(true);
      expect(service.matchesPattern('Tool+name', ['Tool+name'])).toBe(true);
      expect(service.matchesPattern('Tool?name', ['Tool?name'])).toBe(true);
      expect(service.matchesPattern('Tool(name)', ['Tool(name)'])).toBe(true);
      expect(service.matchesPattern('Tool[name]', ['Tool[name]'])).toBe(true);
      expect(service.matchesPattern('Tool{name}', ['Tool{name}'])).toBe(true);
      expect(service.matchesPattern('Tool|name', ['Tool|name'])).toBe(true);
      expect(service.matchesPattern('Tool^name', ['Tool^name'])).toBe(true);
      expect(service.matchesPattern('Tool$name', ['Tool$name'])).toBe(true);
    });

    it('should not treat . as any character', () => {
      expect(service.matchesPattern('ToolXname', ['Tool.name'])).toBe(false);
    });
  });

  describe('createApprovalHandler', () => {
    it('should return null if no HITL config', () => {
      const handler = service.createApprovalHandler(
        { systemPrompt: 'test' },
        { correlationId: '123', agentName: 'test', prompt: 'test', replyTo: 'queue://test', origin: { platform: 'test' } },
        { send: vi.fn(), matches: () => true },
      );
      expect(handler).toBeNull();
    });

    it('should return a handler if HITL config exists', () => {
      const handler = service.createApprovalHandler(
        {
          systemPrompt: 'test',
          hitl: { requireApproval: ['Bash:*'] },
        },
        { correlationId: '123', agentName: 'test', prompt: 'test', replyTo: 'queue://test', origin: { platform: 'test' } },
        { send: vi.fn(), matches: () => true },
      );
      expect(handler).not.toBeNull();
      expect(typeof handler).toBe('function');
    });

    it('should auto-approve tools matching autoApprove patterns', async () => {
      const handler = service.createApprovalHandler(
        {
          systemPrompt: 'test',
          hitl: {
            requireApproval: ['*'],
            autoApprove: ['Read:*', 'Glob:*'],
          },
        },
        { correlationId: '123', agentName: 'test', prompt: 'test', replyTo: 'queue://test', origin: { platform: 'test' } },
        { send: vi.fn(), matches: () => true },
      );

      const result = await handler!('Read:file.ts', {});
      expect(result.behavior).toBe('allow');
    });

    it('should allow tools not matching requireApproval', async () => {
      const handler = service.createApprovalHandler(
        {
          systemPrompt: 'test',
          hitl: { requireApproval: ['Bash:*'] },
        },
        { correlationId: '123', agentName: 'test', prompt: 'test', replyTo: 'queue://test', origin: { platform: 'test' } },
        { send: vi.fn(), matches: () => true },
      );

      const result = await handler!('Read:file.ts', {});
      expect(result.behavior).toBe('allow');
    });
  });

  describe('submitApproval', () => {
    it('should send approval decision to queue', async () => {
      await service.submitApproval('test-queue', {
        approvalId: 'approval-123',
        decision: 'approve',
        decidedBy: {
          userId: 'user@test.com',
          platform: 'test',
          timestamp: new Date().toISOString(),
        },
      });

      expect(mockPgBoss.send).toHaveBeenCalledWith('test-queue', {
        approvalId: 'approval-123',
        decision: 'approve',
        decidedBy: {
          userId: 'user@test.com',
          platform: 'test',
          timestamp: expect.any(String),
        },
      });
    });
  });
});
