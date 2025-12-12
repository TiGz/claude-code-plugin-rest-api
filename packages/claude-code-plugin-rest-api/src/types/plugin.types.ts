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
// User-Defined Agent Types (Full SDK Options)
// ============================================

/** Permission modes for agent execution */
export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions';

/** Tools configuration - explicit list or preset */
export type ToolsConfig = string[] | { type: 'preset'; preset: 'claude_code' };

/** Plugin path configuration */
export interface PluginPath {
  type: 'local';
  path: string;
}

/**
 * JSON Schema output format for structured agent responses.
 * Enforces validated JSON outputs after tool-using workflows.
 */
export interface OutputFormat {
  type: 'json_schema';
  /** JSON Schema object that the agent's output must conform to */
  schema: Record<string, unknown>;
}

/**
 * Full SDK options for user-defined agents.
 * These agents are defined programmatically and exposed via /v1/agents/:name
 */
export interface AgentConfig {
  /** System prompt for the agent */
  systemPrompt: string;
  /** Model to use (default: claude-sonnet-4-5) */
  model?: string;
  /** Agent's working directory for file operations */
  workingDirectory?: string;
  /** Additional plugins to load */
  plugins?: PluginPath[];
  /**
   * Custom MCP servers.
   * Use createSdkMcpServer() from @anthropic-ai/claude-agent-sdk to create these.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mcpServers?: Record<string, any>;
  /** Tools configuration - explicit list or preset */
  tools?: ToolsConfig;
  /** Explicit tool allowlist (alternative to tools) */
  allowedTools?: string[];
  /** Tools to block */
  disallowedTools?: string[];
  /** Permission mode: 'bypassPermissions' for pre-approved actions */
  permissionMode?: PermissionMode;
  /** Load settings from filesystem */
  settingSources?: ('user' | 'project' | 'local')[];
  /** Max conversation turns */
  maxTurns?: number;
  /** Max budget in USD */
  maxBudgetUsd?: number;
  /** Beta features to enable (e.g., 'context-1m-2025-08-07') */
  betas?: ('context-1m-2025-08-07')[];
  /**
   * Output format for structured JSON responses.
   * When set, the agent's final result must conform to the provided JSON schema.
   */
  outputFormat?: OutputFormat;
}
