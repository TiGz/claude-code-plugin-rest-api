import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import type { SessionOptions } from '../types/plugin.types.js';

export interface StreamSession {
  id: string;
  pluginName: string;
  agentName: string;
  prompt: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
  /** SDK session options for resume/fork */
  sessionOptions?: SessionOptions;
  createdAt: number;
  consumed: boolean;
}

@Injectable()
export class StreamSessionService {
  private readonly logger = new Logger(StreamSessionService.name);
  private sessions = new Map<string, StreamSession>();
  private readonly SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Cleanup expired sessions every minute
    this.cleanupInterval = setInterval(() => this.cleanupExpiredSessions(), 60 * 1000);
  }

  async createSession(params: {
    pluginName: string;
    agentName: string;
    prompt: string;
    maxTurns?: number;
    maxBudgetUsd?: number;
    /** SDK session options for resume/fork */
    sessionOptions?: SessionOptions;
  }): Promise<string> {
    const id = uuidv4();

    const session: StreamSession = {
      id,
      ...params,
      createdAt: Date.now(),
      consumed: false,
    };

    this.sessions.set(id, session);
    this.logger.debug(`Created stream session: ${id}`);

    return id;
  }

  getSession(id: string): StreamSession | undefined {
    const session = this.sessions.get(id);

    if (!session) {
      return undefined;
    }

    // Check if expired
    if (Date.now() - session.createdAt > this.SESSION_TTL_MS) {
      this.sessions.delete(id);
      return undefined;
    }

    // Check if already consumed
    if (session.consumed) {
      return undefined;
    }

    return session;
  }

  markConsumed(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.consumed = true;
    }
  }

  private cleanupExpiredSessions(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, session] of this.sessions.entries()) {
      if (now - session.createdAt > this.SESSION_TTL_MS) {
        this.sessions.delete(id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.debug(`Cleaned up ${cleaned} expired stream sessions`);
    }
  }

  onModuleDestroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}
