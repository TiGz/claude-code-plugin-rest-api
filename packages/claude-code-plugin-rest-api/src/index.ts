// Main module export
export { ClaudePluginModule } from './claude-plugin.module.js';
export type { ClaudePluginModuleOptions } from './claude-plugin.module.js';

// Services (for advanced usage)
export { PluginDiscoveryService } from './services/plugin-discovery.service.js';
export { PluginExecutionService } from './services/plugin-execution.service.js';
export type { ExecutionOptions, ExecutionResult, Attachment, AttachmentSource } from './services/plugin-execution.service.js';
export { StreamSessionService } from './services/stream-session.service.js';
export type { StreamSession } from './services/stream-session.service.js';
export { AgentService, AGENT_CONFIG } from './services/agent.service.js';

// Types - Plugin discovery
export type {
  PluginManifest,
  PluginCommand,
  PluginAgent,
  PluginSkill,
  DiscoveredPlugin,
} from './types/plugin.types.js';

// Types - Agent configuration (extends SDK Options)
export type { AgentConfig, RequestSchema } from './types/plugin.types.js';

// Controllers (for custom routing)
export { PluginController, StreamController } from './controllers/plugin.controller.js';
export { AgentController } from './controllers/agent.controller.js';

// Auth exports
export type { AuthUser, AuthProvider, AuthModuleOptions } from './auth/auth.types.js';
export { YamlAuthProvider } from './auth/yaml-auth.provider.js';
export { BasicAuthGuard } from './auth/auth.guard.js';

// Claude Agent SDK re-exports for convenience
export { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';

// Re-export commonly used SDK types
export type {
  Options,
  PermissionMode,
  OutputFormat,
  SdkPluginConfig,
  McpServerConfig,
  McpStdioServerConfig,
  McpSSEServerConfig,
  McpHttpServerConfig,
  McpSdkServerConfigWithInstance,
  AgentDefinition,
  SdkBeta,
  SettingSource,
  SDKMessage,
  SDKResultMessage,
  SDKAssistantMessage,
  SDKUserMessage,
  SDKSystemMessage,
  Query,
} from '@anthropic-ai/claude-agent-sdk';

// Re-export zod for tool schema definitions
export { z } from 'zod';
