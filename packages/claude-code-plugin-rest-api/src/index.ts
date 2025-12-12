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

// Types
export type {
  PluginManifest,
  PluginCommand,
  PluginAgent,
  PluginSkill,
  DiscoveredPlugin,
  // User-defined agent types
  AgentConfig,
  PermissionMode,
  ToolsConfig,
  PluginPath,
  OutputFormat,
} from './types/plugin.types.js';

// Controllers (for custom routing)
export { PluginController, StreamController } from './controllers/plugin.controller.js';
export { AgentController } from './controllers/agent.controller.js';

// Auth exports
export type { AuthUser, AuthProvider, AuthModuleOptions } from './auth/auth.types.js';
export { YamlAuthProvider } from './auth/yaml-auth.provider.js';
export { BasicAuthGuard } from './auth/auth.guard.js';
