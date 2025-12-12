import { Controller, Get, Optional } from '@nestjs/common';
import { PluginDiscoveryService } from '@tigz/claude-code-plugin-rest-api';

@Controller('health')
export class HealthController {
  constructor(
    @Optional() private readonly pluginDiscovery?: PluginDiscoveryService,
  ) {}

  @Get()
  check() {
    const plugins = this.pluginDiscovery?.getAllPlugins() ?? [];

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      plugins: {
        count: plugins.length,
        names: plugins.map((p) => p.name),
      },
    };
  }
}
