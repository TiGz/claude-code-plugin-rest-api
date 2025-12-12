import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as chokidar from 'chokidar';
import matter from 'gray-matter';
import {
  PluginManifest,
  PluginCommand,
  PluginAgent,
  PluginSkill,
  DiscoveredPlugin,
} from '../types/plugin.types.js';

export interface PluginDiscoveryOptions {
  pluginDirectory: string;
  hotReload: boolean;
}

export const PLUGIN_DISCOVERY_OPTIONS = 'PLUGIN_DISCOVERY_OPTIONS';

@Injectable()
export class PluginDiscoveryService implements OnModuleInit {
  private readonly logger = new Logger(PluginDiscoveryService.name);
  private plugins = new Map<string, DiscoveredPlugin>();
  private watcher: chokidar.FSWatcher | null = null;

  constructor(
    @Inject(PLUGIN_DISCOVERY_OPTIONS) private options: PluginDiscoveryOptions,
    private eventEmitter: EventEmitter2,
  ) {}

  async onModuleInit() {
    await this.discoverPlugins();

    if (this.options.hotReload) {
      this.startFileWatcher();
    }
  }

  async discoverPlugins(): Promise<void> {
    const pluginDir = this.options.pluginDirectory;
    const absolutePluginDir = path.resolve(process.cwd(), pluginDir);

    this.logger.log(`Discovering plugins in ${absolutePluginDir}`);

    try {
      const entries = await fs.readdir(absolutePluginDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const pluginPath = path.join(absolutePluginDir, entry.name);
          await this.loadPlugin(pluginPath);
        }
      }

      this.logger.log(`Discovered ${this.plugins.size} plugins`);
    } catch (error: unknown) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        this.logger.warn(`Plugin directory not found: ${absolutePluginDir}`);
      } else {
        this.logger.error(`Failed to discover plugins: ${err.message}`);
      }
    }
  }

  private async loadPlugin(pluginPath: string): Promise<void> {
    const manifestPath = path.join(pluginPath, '.claude-plugin', 'plugin.json');

    try {
      const manifestData = await fs.readFile(manifestPath, 'utf-8');
      const manifest: PluginManifest = JSON.parse(manifestData);

      const plugin: DiscoveredPlugin = {
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        rootPath: pluginPath,
        manifest,
        commands: await this.discoverCommands(pluginPath, manifest),
        agents: await this.discoverAgents(pluginPath, manifest),
        skills: await this.discoverSkills(pluginPath, manifest),
      };

      this.plugins.set(manifest.name, plugin);
      this.logger.log(`Loaded plugin: ${manifest.name} v${manifest.version}`);
      this.logger.debug(`  Commands: ${plugin.commands.map(c => c.name).join(', ') || 'none'}`);
      this.logger.debug(`  Agents: ${plugin.agents.map(a => a.name).join(', ') || 'none'}`);
      this.logger.debug(`  Skills: ${plugin.skills.map(s => s.name).join(', ') || 'none'}`);

      this.eventEmitter.emit('plugin.loaded', plugin);
    } catch (error: unknown) {
      const err = error as Error;
      this.logger.warn(`Failed to load plugin at ${pluginPath}: ${err.message}`);
    }
  }

  private async discoverCommands(
    pluginPath: string,
    manifest: PluginManifest,
  ): Promise<PluginCommand[]> {
    const commands: PluginCommand[] = [];
    const commandPaths = this.normalizePaths(manifest.commands, ['./commands/']);

    for (const cmdPath of commandPaths) {
      const absolutePath = path.join(pluginPath, cmdPath);
      const mdFiles = await this.findMarkdownFiles(absolutePath);

      for (const mdFile of mdFiles) {
        const content = await fs.readFile(mdFile, 'utf-8');
        const { data, content: body } = matter(content);

        commands.push({
          name: path.basename(mdFile, '.md'),
          description: (data.description as string) || '',
          filePath: mdFile,
          content: body.trim(),
        });
      }
    }

    return commands;
  }

  private async discoverAgents(
    pluginPath: string,
    manifest: PluginManifest,
  ): Promise<PluginAgent[]> {
    const agents: PluginAgent[] = [];
    const agentPaths = this.normalizePaths(manifest.agents, ['./agents/']);

    for (const agentPath of agentPaths) {
      const absolutePath = path.join(pluginPath, agentPath);
      const mdFiles = await this.findMarkdownFiles(absolutePath);

      for (const mdFile of mdFiles) {
        const content = await fs.readFile(mdFile, 'utf-8');
        const { data, content: body } = matter(content);

        const toolsStr = data.tools as string | undefined;
        agents.push({
          name: (data.name as string) || path.basename(mdFile, '.md'),
          description: (data.description as string) || '',
          filePath: mdFile,
          content: body.trim(),
          tools: toolsStr?.split(',').map((t: string) => t.trim()),
          model: data.model as string | undefined,
        });
      }
    }

    return agents;
  }

  private async discoverSkills(
    pluginPath: string,
    manifest: PluginManifest,
  ): Promise<PluginSkill[]> {
    const skills: PluginSkill[] = [];
    const skillPaths = this.normalizePaths(manifest.skills, ['./skills/']);

    for (const skillPath of skillPaths) {
      const absolutePath = path.join(pluginPath, skillPath);

      try {
        const entries = await fs.readdir(absolutePath, { withFileTypes: true });

        for (const entry of entries) {
          if (entry.isDirectory()) {
            const skillMdPath = path.join(absolutePath, entry.name, 'SKILL.md');

            try {
              const content = await fs.readFile(skillMdPath, 'utf-8');
              const { data, content: body } = matter(content);

              const allowedToolsStr = data['allowed-tools'] as string | undefined;
              skills.push({
                name: (data.name as string) || entry.name,
                description: (data.description as string) || '',
                dirPath: path.join(absolutePath, entry.name),
                skillMdPath,
                content: body.trim(),
                allowedTools: allowedToolsStr?.split(',').map((t: string) => t.trim()),
              });
            } catch {
              // No SKILL.md in this directory, skip
            }
          }
        }
      } catch {
        // Directory doesn't exist, skip
      }
    }

    return skills;
  }

  private normalizePaths(
    configPaths: string | string[] | undefined,
    defaults: string[],
  ): string[] {
    if (!configPaths) return defaults;
    return Array.isArray(configPaths) ? configPaths : [configPaths];
  }

  private async findMarkdownFiles(dirPath: string): Promise<string[]> {
    const files: string[] = [];

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.md')) {
          files.push(path.join(dirPath, entry.name));
        }
      }
    } catch {
      // Directory doesn't exist
    }

    return files;
  }

  private startFileWatcher(): void {
    const pluginDir = this.options.pluginDirectory;

    this.watcher = chokidar.watch(pluginDir, {
      persistent: true,
      ignoreInitial: true,
      depth: 3,
    });

    this.watcher.on('change', async (filePath) => {
      this.logger.debug(`Plugin file changed: ${filePath}`);
      await this.discoverPlugins();
      this.eventEmitter.emit('plugins.reloaded');
    });

    this.watcher.on('add', async (filePath) => {
      this.logger.debug(`Plugin file added: ${filePath}`);
      await this.discoverPlugins();
      this.eventEmitter.emit('plugins.reloaded');
    });

    this.logger.log('Plugin hot reload enabled');
  }

  // Public API

  getPlugin(name: string): DiscoveredPlugin | undefined {
    return this.plugins.get(name);
  }

  getAllPlugins(): DiscoveredPlugin[] {
    return Array.from(this.plugins.values());
  }

  getCommand(pluginName: string, commandName: string): PluginCommand | undefined {
    const plugin = this.plugins.get(pluginName);
    return plugin?.commands.find((c) => c.name === commandName);
  }

  getAgent(pluginName: string, agentName: string): PluginAgent | undefined {
    const plugin = this.plugins.get(pluginName);
    return plugin?.agents.find((a) => a.name === agentName);
  }

  getSkill(pluginName: string, skillName: string): PluginSkill | undefined {
    const plugin = this.plugins.get(pluginName);
    return plugin?.skills.find((s) => s.name === skillName);
  }
}
