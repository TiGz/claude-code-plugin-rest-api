import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitterModule } from '@nestjs/event-emitter';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { PluginDiscoveryService, PLUGIN_DISCOVERY_OPTIONS } from './plugin-discovery.service.js';

describe('PluginDiscoveryService', () => {
  let service: PluginDiscoveryService;
  let testPluginDir: string;

  async function createTestPlugin(name: string, options: {
    commands?: Array<{ name: string; description?: string; content?: string }>;
    agents?: Array<{ name: string; description?: string; tools?: string; model?: string; content?: string }>;
    skills?: Array<{ name: string; description?: string; content?: string }>;
  } = {}) {
    const pluginPath = path.join(testPluginDir, name);
    const claudePluginPath = path.join(pluginPath, '.claude-plugin');

    await fs.mkdir(claudePluginPath, { recursive: true });

    // Create plugin manifest
    await fs.writeFile(
      path.join(claudePluginPath, 'plugin.json'),
      JSON.stringify({
        name,
        version: '1.0.0',
        description: `Test plugin: ${name}`,
      }),
    );

    // Create commands
    if (options.commands?.length) {
      const commandsPath = path.join(pluginPath, 'commands');
      await fs.mkdir(commandsPath, { recursive: true });

      for (const cmd of options.commands) {
        const frontmatter = cmd.description ? `---\ndescription: ${cmd.description}\n---\n\n` : '';
        await fs.writeFile(
          path.join(commandsPath, `${cmd.name}.md`),
          `${frontmatter}${cmd.content || `Command: ${cmd.name}`}`,
        );
      }
    }

    // Create agents
    if (options.agents?.length) {
      const agentsPath = path.join(pluginPath, 'agents');
      await fs.mkdir(agentsPath, { recursive: true });

      for (const agent of options.agents) {
        const frontmatterParts = [`name: ${agent.name}`];
        if (agent.description) frontmatterParts.push(`description: ${agent.description}`);
        if (agent.tools) frontmatterParts.push(`tools: ${agent.tools}`);
        if (agent.model) frontmatterParts.push(`model: ${agent.model}`);

        await fs.writeFile(
          path.join(agentsPath, `${agent.name}.md`),
          `---\n${frontmatterParts.join('\n')}\n---\n\n${agent.content || `Agent: ${agent.name}`}`,
        );
      }
    }

    // Create skills
    if (options.skills?.length) {
      const skillsPath = path.join(pluginPath, 'skills');
      await fs.mkdir(skillsPath, { recursive: true });

      for (const skill of options.skills) {
        const skillDir = path.join(skillsPath, skill.name);
        await fs.mkdir(skillDir, { recursive: true });

        const frontmatter = skill.description
          ? `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n\n`
          : `---\nname: ${skill.name}\n---\n\n`;

        await fs.writeFile(
          path.join(skillDir, 'SKILL.md'),
          `${frontmatter}${skill.content || `Skill: ${skill.name}`}`,
        );
      }
    }

    return pluginPath;
  }

  beforeEach(async () => {
    // Create a temporary directory for test plugins
    testPluginDir = await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-test-'));

    const module: TestingModule = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [
        PluginDiscoveryService,
        {
          provide: PLUGIN_DISCOVERY_OPTIONS,
          useValue: {
            pluginDirectory: testPluginDir,
            hotReload: false,
          },
        },
      ],
    }).compile();

    service = module.get<PluginDiscoveryService>(PluginDiscoveryService);
  });

  afterEach(async () => {
    // Clean up temp directory
    await fs.rm(testPluginDir, { recursive: true, force: true });
  });

  describe('discoverPlugins', () => {
    it('should discover plugins in the directory', async () => {
      await createTestPlugin('my-plugin', {
        commands: [{ name: 'hello', description: 'Say hello' }],
        agents: [{ name: 'helper', description: 'A helpful agent', tools: 'Read,Write' }],
      });

      await service.discoverPlugins();

      const plugins = service.getAllPlugins();
      expect(plugins).toHaveLength(1);
      expect(plugins[0].name).toBe('my-plugin');
    });

    it('should discover multiple plugins', async () => {
      await createTestPlugin('plugin-a');
      await createTestPlugin('plugin-b');
      await createTestPlugin('plugin-c');

      await service.discoverPlugins();

      const plugins = service.getAllPlugins();
      expect(plugins).toHaveLength(3);
      expect(plugins.map(p => p.name).sort()).toEqual(['plugin-a', 'plugin-b', 'plugin-c']);
    });

    it('should handle empty plugin directory', async () => {
      await service.discoverPlugins();

      const plugins = service.getAllPlugins();
      expect(plugins).toHaveLength(0);
    });

    it('should handle non-existent plugin directory gracefully', async () => {
      // Remove the temp directory to simulate non-existent
      await fs.rm(testPluginDir, { recursive: true });

      await expect(service.discoverPlugins()).resolves.not.toThrow();
      expect(service.getAllPlugins()).toHaveLength(0);
    });
  });

  describe('getPlugin', () => {
    it('should return plugin by name', async () => {
      await createTestPlugin('my-plugin');
      await service.discoverPlugins();

      const plugin = service.getPlugin('my-plugin');

      expect(plugin).toBeDefined();
      expect(plugin?.name).toBe('my-plugin');
      expect(plugin?.version).toBe('1.0.0');
    });

    it('should return undefined for non-existent plugin', async () => {
      await service.discoverPlugins();

      const plugin = service.getPlugin('non-existent');
      expect(plugin).toBeUndefined();
    });
  });

  describe('commands discovery', () => {
    it('should discover commands from commands directory', async () => {
      await createTestPlugin('my-plugin', {
        commands: [
          { name: 'hello', description: 'Say hello', content: 'Greet the user' },
          { name: 'goodbye', description: 'Say goodbye', content: 'Bid farewell' },
        ],
      });

      await service.discoverPlugins();
      const plugin = service.getPlugin('my-plugin');

      expect(plugin?.commands).toHaveLength(2);
      expect(plugin?.commands.map(c => c.name).sort()).toEqual(['goodbye', 'hello']);
    });

    it('should parse command frontmatter', async () => {
      await createTestPlugin('my-plugin', {
        commands: [{ name: 'test', description: 'Test command', content: 'Command body' }],
      });

      await service.discoverPlugins();
      const command = service.getCommand('my-plugin', 'test');

      expect(command).toBeDefined();
      expect(command?.description).toBe('Test command');
      expect(command?.content).toBe('Command body');
    });
  });

  describe('agents discovery', () => {
    it('should discover agents from agents directory', async () => {
      await createTestPlugin('my-plugin', {
        agents: [
          { name: 'agent-a', description: 'First agent' },
          { name: 'agent-b', description: 'Second agent' },
        ],
      });

      await service.discoverPlugins();
      const plugin = service.getPlugin('my-plugin');

      expect(plugin?.agents).toHaveLength(2);
    });

    it('should parse agent frontmatter including tools and model', async () => {
      await createTestPlugin('my-plugin', {
        agents: [{
          name: 'code-helper',
          description: 'Helps with code',
          tools: 'Read,Write,Glob',
          model: 'claude-sonnet-4-20250514',
          content: 'You are a helpful coding assistant.',
        }],
      });

      await service.discoverPlugins();
      const agent = service.getAgent('my-plugin', 'code-helper');

      expect(agent).toBeDefined();
      expect(agent?.name).toBe('code-helper');
      expect(agent?.description).toBe('Helps with code');
      expect(agent?.tools).toEqual(['Read', 'Write', 'Glob']);
      expect(agent?.model).toBe('claude-sonnet-4-20250514');
      expect(agent?.content).toBe('You are a helpful coding assistant.');
    });
  });

  describe('skills discovery', () => {
    it('should discover skills from skills directory', async () => {
      await createTestPlugin('my-plugin', {
        skills: [
          { name: 'skill-one', description: 'First skill' },
          { name: 'skill-two', description: 'Second skill' },
        ],
      });

      await service.discoverPlugins();
      const plugin = service.getPlugin('my-plugin');

      expect(plugin?.skills).toHaveLength(2);
    });

    it('should parse skill SKILL.md', async () => {
      await createTestPlugin('my-plugin', {
        skills: [{
          name: 'my-skill',
          description: 'A useful skill',
          content: 'This skill does something useful.',
        }],
      });

      await service.discoverPlugins();
      const skill = service.getSkill('my-plugin', 'my-skill');

      expect(skill).toBeDefined();
      expect(skill?.name).toBe('my-skill');
      expect(skill?.description).toBe('A useful skill');
      expect(skill?.content).toBe('This skill does something useful.');
    });
  });

  describe('getCommand', () => {
    it('should return command by plugin and command name', async () => {
      await createTestPlugin('my-plugin', {
        commands: [{ name: 'hello', description: 'Say hello' }],
      });

      await service.discoverPlugins();
      const command = service.getCommand('my-plugin', 'hello');

      expect(command).toBeDefined();
      expect(command?.name).toBe('hello');
    });

    it('should return undefined for non-existent command', async () => {
      await createTestPlugin('my-plugin', {
        commands: [{ name: 'hello' }],
      });

      await service.discoverPlugins();

      expect(service.getCommand('my-plugin', 'non-existent')).toBeUndefined();
      expect(service.getCommand('non-existent', 'hello')).toBeUndefined();
    });
  });

  describe('getAgent', () => {
    it('should return agent by plugin and agent name', async () => {
      await createTestPlugin('my-plugin', {
        agents: [{ name: 'helper', description: 'Helpful agent' }],
      });

      await service.discoverPlugins();
      const agent = service.getAgent('my-plugin', 'helper');

      expect(agent).toBeDefined();
      expect(agent?.name).toBe('helper');
    });

    it('should return undefined for non-existent agent', async () => {
      await createTestPlugin('my-plugin', {
        agents: [{ name: 'helper' }],
      });

      await service.discoverPlugins();

      expect(service.getAgent('my-plugin', 'non-existent')).toBeUndefined();
      expect(service.getAgent('non-existent', 'helper')).toBeUndefined();
    });
  });

  describe('getSkill', () => {
    it('should return skill by plugin and skill name', async () => {
      await createTestPlugin('my-plugin', {
        skills: [{ name: 'my-skill', description: 'A skill' }],
      });

      await service.discoverPlugins();
      const skill = service.getSkill('my-plugin', 'my-skill');

      expect(skill).toBeDefined();
      expect(skill?.name).toBe('my-skill');
    });

    it('should return undefined for non-existent skill', async () => {
      await createTestPlugin('my-plugin', {
        skills: [{ name: 'my-skill' }],
      });

      await service.discoverPlugins();

      expect(service.getSkill('my-plugin', 'non-existent')).toBeUndefined();
      expect(service.getSkill('non-existent', 'my-skill')).toBeUndefined();
    });
  });
});
