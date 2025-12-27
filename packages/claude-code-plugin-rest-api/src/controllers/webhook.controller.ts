import { Controller, Post, HttpCode, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PluginDiscoveryService } from '../services/plugin-discovery.service.js';

/**
 * Webhook controller for triggering plugin reloads.
 * Useful for GitOps workflows where a GitHub webhook can trigger
 * a reload after merging PRs that modify plugin files.
 */
@ApiTags('webhook')
@Controller('webhook')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(private pluginDiscovery: PluginDiscoveryService) {}

  @Post('reload')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Trigger plugin reload',
    description:
      'Manually trigger a reload of all plugins. Useful after merging PRs that modify plugin files.',
  })
  @ApiResponse({
    status: 200,
    description: 'Plugins reloaded successfully',
    schema: {
      type: 'object',
      properties: {
        reloaded: { type: 'boolean' },
        pluginCount: { type: 'number' },
      },
    },
  })
  async triggerReload(): Promise<{ reloaded: boolean; pluginCount: number }> {
    this.logger.log('Manual plugin reload triggered via webhook');
    await this.pluginDiscovery.discoverPlugins();
    const pluginCount = this.pluginDiscovery.getAllPlugins().length;
    this.logger.log(`Reload complete. ${pluginCount} plugins loaded.`);
    return {
      reloaded: true,
      pluginCount,
    };
  }
}
