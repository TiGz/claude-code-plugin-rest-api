import type { AgentConfig, HITLConfig } from './types/plugin.types.js';

/**
 * Agent configuration with optional HITL support.
 * HITL config is only used when the agent is registered with QueueModule.
 */
export interface AgentDefinition extends AgentConfig {
  /**
   * Human-in-the-Loop configuration.
   * Only applies when the agent is used via QueueModule (async queue processing).
   * Ignored by ClaudePluginModule (REST API - synchronous responses).
   */
  hitl?: HITLConfig;
}

/**
 * Creates a reusable agent configuration that can be registered with
 * both ClaudePluginModule (REST) and QueueModule (async queues).
 *
 * The same agent definition can be used across multiple transports:
 * - When used with ClaudePluginModule, HITL config is ignored (REST is synchronous)
 * - When used with QueueModule, HITL config is applied for approval workflows
 *
 * @example
 * ```typescript
 * const summarizer = defineAgent({
 *   systemPrompt: 'You summarize documents.',
 *   permissionMode: 'bypassPermissions',
 * });
 *
 * const deployBot = defineAgent({
 *   systemPrompt: 'You deploy to production.',
 *   permissionMode: 'bypassPermissions',
 *   hitl: {
 *     requireApproval: ['Bash:*deploy*'],
 *     approvalTimeoutMs: 300_000,
 *   },
 * });
 *
 * // Use in module configuration
 * ClaudePluginModule.forRoot({
 *   agents: { summarizer, 'deploy-bot': deployBot },
 * })
 *
 * QueueModule.forRoot({
 *   agents: { summarizer, 'deploy-bot': deployBot },
 *   // HITL only applies here
 * })
 * ```
 */
export function defineAgent(config: AgentDefinition): AgentDefinition {
  return config;
}

/**
 * Extract the base AgentConfig from an AgentDefinition, stripping HITL config.
 * Used internally by ClaudePluginModule to get SDK-compatible options.
 */
export function toAgentConfig(definition: AgentDefinition): AgentConfig {
  const { hitl: _hitl, ...config } = definition;
  return config;
}
