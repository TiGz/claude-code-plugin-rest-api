import { Module } from '@nestjs/common';
import { ClaudePluginModule } from '@tigz/claude-code-plugin-api';
import { HealthController } from './health.controller.js';

@Module({
  imports: [
    // Simple usage with defaults
    ClaudePluginModule.forRoot({
      pluginDirectory: '.claude/plugins',
      hotReload: process.env.NODE_ENV === 'development',
      // Auth is enabled by default, reads from auth.yml
      // To disable auth: auth: { disabled: true }
    }),

    // Or with async configuration:
    // ClaudePluginModule.forRootAsync({
    //   useFactory: () => ({
    //     pluginDirectory: process.env.PLUGINS_DIR || '.claude/plugins',
    //     hotReload: process.env.NODE_ENV === 'development',
    //     maxTurns: 100,
    //     maxBudgetUsd: 25,
    //     auth: { disabled: process.env.DISABLE_AUTH === 'true' },
    //   }),
    // }),
  ],
  controllers: [HealthController],
})
export class AppModule {}
