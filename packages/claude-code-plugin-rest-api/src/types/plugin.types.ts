import type { Options } from '@anthropic-ai/claude-agent-sdk';

export interface PluginManifest {
  name: string;
  version: string;
  description?: string;
  author?: {
    name: string;
    email?: string;
  };
  homepage?: string;
  repository?: string;
  license?: string;
  keywords?: string[];
  commands?: string | string[];
  agents?: string | string[];
  skills?: string | string[];
  hooks?: string;
  mcpServers?: string;
}

export interface PluginCommand {
  name: string;
  description: string;
  filePath: string;
  content: string;
}

export interface PluginAgent {
  name: string;
  description: string;
  filePath: string;
  content: string;
  tools?: string[];
  model?: string;
}

export interface PluginSkill {
  name: string;
  description: string;
  dirPath: string;
  skillMdPath: string;
  content: string;
  allowedTools?: string[];
}

export interface DiscoveredPlugin {
  name: string;
  version: string;
  description?: string;
  rootPath: string;
  manifest: PluginManifest;
  commands: PluginCommand[];
  agents: PluginAgent[];
  skills: PluginSkill[];
}

// ============================================
// User-Defined Agent Types (Extends SDK Options)
// ============================================

/**
 * Request schema configuration for agents that accept custom JSON bodies.
 * When configured, the agent validates incoming requests against the schema
 * and converts the JSON body to a prompt using the template.
 *
 * This is a REST API extension not present in the core SDK.
 */
export interface RequestSchema {
  /** JSON Schema for request validation */
  schema: Record<string, unknown>;
  /**
   * Template to convert request body to prompt.
   * Use {{json}} as placeholder for the prettified JSON body.
   * Default: "{{json}}"
   */
  promptTemplate?: string;
}

/**
 * Human-in-the-Loop configuration for agents that require approval for certain tools.
 * Only applies when the agent is used via QueueModule (async queue processing).
 * Ignored by ClaudePluginModule (REST API - synchronous responses).
 */
export interface HITLConfig {
  /**
   * Tool patterns that require human approval before execution.
   * Patterns can include wildcards: 'Bash:*deploy*', 'Bash:kubectl*', 'Edit:*'
   */
  requireApproval: string[];

  /**
   * Tool patterns that are automatically approved (skip HITL).
   * Evaluated after requireApproval - if a tool matches both, autoApprove wins.
   */
  autoApprove?: string[];

  /**
   * Timeout in milliseconds to wait for approval.
   * Default: 300000 (5 minutes)
   */
  approvalTimeoutMs?: number;

  /**
   * Action to take when approval times out.
   * - 'deny': Reject the tool use with a timeout message
   * - 'abort': Abort the entire agent execution
   * Default: 'deny'
   */
  onTimeout?: 'deny' | 'abort';
}

// ============================================
// Session Options for SDK Session Support
// ============================================

/**
 * Session options for resuming or forking SDK sessions.
 * Used in agent execution requests.
 */
export interface SessionOptions {
  /**
   * SDK session ID to resume. When provided, the agent continues
   * the conversation from where it left off.
   */
  sessionId?: string;

  /**
   * When true and sessionId is provided, creates a new session
   * branching from the specified session instead of continuing it.
   * Default: false
   */
  forkSession?: boolean;
}

/**
 * Extended execution result that includes session information.
 * Returned by agent execution endpoints.
 */
export interface AgentExecutionResult {
  success: boolean;
  result?: string;
  structuredOutput?: unknown;
  /** SDK session ID for resumption */
  sessionId?: string;
  error?: string;
  cost?: number;
  turns?: number;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * Agent configuration extending the Claude Agent SDK Options type.
 *
 * Provides full access to all SDK options plus REST API-specific extensions.
 * Options that don't make sense in a REST context are omitted:
 * - `abortController`: Managed internally by request handlers
 * - `canUseTool`: No interactive prompting in REST APIs, use `permissionMode` instead
 * - `stderr`: Server-side logging concern
 * - `spawnClaudeCodeProcess`: Internal transport concern
 *
 * @see https://docs.anthropic.com/en/docs/claude-code/sdk for full SDK documentation
 */
export type AgentConfig = Omit<
  Options,
  | 'abortController'
  | 'canUseTool'
  | 'stderr'
  | 'spawnClaudeCodeProcess'
> & {
  /**
   * Request schema for custom JSON request bodies (REST API extension).
   * When set, the agent accepts custom JSON bodies instead of {prompt: string}.
   * The body is validated against the schema and converted to a prompt using the template.
   */
  requestSchema?: RequestSchema;
};
