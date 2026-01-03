/**
 * Async Agent Queue Types
 *
 * These types define the message schemas for asynchronous agent processing
 * via pg-boss queues. Agents can be invoked asynchronously and results
 * delivered via configurable reply channels (Slack, webhooks, queues, etc.)
 */

import type { SessionOptions } from './plugin.types.js';

// ============================================
// Request Types
// ============================================

/**
 * Origin information for tracking where a request came from.
 * Used for routing responses and providing context.
 */
export interface RequestOrigin {
  /** Platform the request originated from */
  platform: 'slack' | 'nostr' | 'discord' | 'api' | 'webhook' | string;

  /** User identifier on the originating platform */
  userId?: string;

  /** Channel/room identifier */
  channelId?: string;

  /** Thread identifier for threaded conversations */
  threadId?: string;

  /** Additional platform-specific metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Message schema for async agent requests.
 * Published to the queue for background processing.
 */
export interface AsyncAgentRequest {
  /** Name of the agent to invoke */
  agentName: string;

  /** User prompt to send to the agent */
  prompt: string;

  /** Unique identifier for correlating request/response */
  correlationId: string;

  /** SDK session options for resume/fork */
  sessionId?: string;
  forkSession?: boolean;

  /** Origin information for response routing */
  origin: RequestOrigin;

  /**
   * URI specifying where to send the response.
   * Format: scheme://...
   * Examples:
   * - slack-socket://channel/C123?thread=1234567890.123456
   * - webhook://https://example.com/callback
   * - queue://response-queue-name
   */
  replyTo: string;

  /** Optional request metadata */
  createdAt?: string;
  priority?: number;
}

// ============================================
// Response Types
// ============================================

/**
 * Result payload for successful agent execution.
 */
export interface AsyncAgentResultPayload {
  success: true;
  output?: string;
  structuredOutput?: unknown;
}

/**
 * Error payload for failed agent execution.
 */
export interface AsyncAgentErrorPayload {
  success: false;
  error: string;
  code?: string;
}

/**
 * Base response message for async agent execution.
 */
export interface AsyncAgentResponseBase {
  /** Correlation ID from the original request */
  correlationId: string;

  /** SDK session ID for future resume */
  sessionId?: string;

  /** Origin from the original request */
  origin: RequestOrigin;

  /** When the execution completed */
  completedAt: string;

  /** Total execution time in milliseconds */
  durationMs: number;
}

/**
 * Successful async agent response.
 */
export interface AsyncAgentSuccessResponse extends AsyncAgentResponseBase {
  type: 'result';
  payload: AsyncAgentResultPayload;
}

/**
 * Failed async agent response.
 */
export interface AsyncAgentErrorResponse extends AsyncAgentResponseBase {
  type: 'error';
  payload: AsyncAgentErrorPayload;
}

/**
 * Union type for all async agent responses.
 */
export type AsyncAgentResponse = AsyncAgentSuccessResponse | AsyncAgentErrorResponse;

// ============================================
// Approval Types (HITL)
// ============================================

/**
 * Tool information requiring approval.
 */
export interface ToolApprovalInfo {
  /** Tool name (e.g., 'Bash', 'Edit', 'mcp__my-tool__action') */
  name: string;

  /** Tool input parameters */
  input: unknown;
}

/**
 * Approval request sent via reply channel when a tool needs human approval.
 */
export interface ApprovalRequestMessage {
  type: 'approval_request';
  correlationId: string;
  origin: RequestOrigin;
  payload: {
    /** Unique ID for this approval request */
    approvalId: string;

    /** Tool requiring approval */
    tool: ToolApprovalInfo;

    /** When the approval expires */
    expiresAt: string;

    /** Queue name to publish approval decision */
    approvalQueueName: string;
  };
}

/**
 * Approval decision from a human reviewer.
 */
export interface ApprovalDecision {
  /** The approval ID from the request */
  approvalId: string;

  /** Decision made by the approver */
  decision: 'approve' | 'deny' | 'abort';

  /** Optional reason for the decision */
  reason?: string;

  /** Modified input (if decision is 'approve') */
  updatedInput?: unknown;

  /** Who made the decision */
  decidedBy?: {
    userId: string;
    platform: string;
    timestamp: string;
  };
}

// ============================================
// Reply Channel Types
// ============================================

/**
 * Message types that can be sent via reply channels.
 */
export type ReplyMessage =
  | AsyncAgentSuccessResponse
  | AsyncAgentErrorResponse
  | ApprovalRequestMessage;

/**
 * Interface for reply channel implementations.
 * Reply channels handle delivering messages back to the request origin.
 */
export interface ReplyChannel {
  /** Send a message via this channel */
  send(message: ReplyMessage): Promise<void>;

  /** Check if this channel handles the given URI */
  matches(uri: string): boolean;
}

// ============================================
// Queue Configuration Types
// ============================================

/**
 * A factory that can create ReplyChannel instances for matching URIs.
 */
export interface ReplyChannelFactory {
  matches(uri: string): boolean;
  create(uri: string): ReplyChannel;
}

/**
 * Configuration for the QueueModule.
 */
export interface QueueModuleOptions {
  /**
   * PostgreSQL connection string for pg-boss.
   * Example: postgres://user:password@localhost:5432/database
   */
  connectionString: string;

  /**
   * Agents to register for queue processing.
   * Same format as ClaudePluginModule.forRoot({ agents: ... })
   */
  agents: Record<string, import('./plugin.types.js').AgentConfig>;

  /**
   * Reply channel factories for delivering responses.
   * Key is the channel name, value is a factory that creates channels for matching URIs.
   */
  replyChannels?: Record<string, ReplyChannelFactory>;

  /**
   * pg-boss configuration options.
   */
  pgBossOptions?: {
    /** Schema name for pg-boss tables */
    schema?: string;
    /** Application name for database connections */
    application_name?: string;
    /** Archive completed jobs instead of deleting */
    archiveCompletedAfterSeconds?: number;
    /** Delete archived jobs after this many seconds */
    deleteAfterSeconds?: number;
  };

  /**
   * Default HITL configuration applied to all agents.
   * Can be overridden per-agent.
   */
  defaultHitl?: {
    approvalTimeoutMs?: number;
    onTimeout?: 'deny' | 'abort';
  };
}

/**
 * Async factory for QueueModule configuration.
 */
export interface QueueModuleAsyncOptions {
  imports?: any[];
  useFactory: (...args: any[]) => Promise<QueueModuleOptions> | QueueModuleOptions;
  inject?: any[];
}
