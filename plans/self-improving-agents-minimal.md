# feat: Self-Improving Agents (Minimal)

> **Date**: 2025-12-27
> **Type**: Enhancement
> **Status**: Ready for Implementation

## The Problem

Enable Claude agents to improve their own prompts/skills and have changes take effect without manual restarts, while maintaining stability.

## The Solution (~30 lines of code)

The solution is remarkably simple because **we already have most of what we need**:

| Need | Already Have | Gap |
|------|--------------|-----|
| Agents modifying files | `permissionMode: 'bypassPermissions'` + Write/Edit tools | None |
| Hot-reload on file change | `chokidar` watcher in PluginDiscoveryService | Add debounce, error handling |
| Version control | Git | None |
| Human review gate | Pull requests | None |
| Audit trail | `git log` | None |
| Graceful shutdown | NestJS shutdown hooks | Enable them |

## How It Works

Using **git worktrees** for isolation - the agent works in a separate directory without affecting the running server's checkout.

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Self-Improvement Flow (with Worktrees)           │
└─────────────────────────────────────────────────────────────────────┘

1. Agent receives task via POST /v1/agents/analyst
                          │
                          ▼
2. Agent executes, identifies improvement opportunity
                          │
                          ▼
3. Agent creates a worktree for isolated changes:
   git worktree add ../improve-analyst-1703683200 -b improve/analyst-1703683200
                          │
                          ▼
4. Agent changes to the worktree directory:
   cd ../improve-analyst-1703683200
                          │
                          ▼
5. Agent uses Edit tool to modify its skill in the worktree:
   .claude/plugins/analyst/skills/analysis/SKILL.md
   (Main checkout is untouched - server keeps running with current config)
                          │
                          ▼
6. Agent commits and creates PR from the worktree:
   git commit -am "improve: better error pattern detection"
   gh pr create --title "..." --body "..."
                          │
                          ▼
7. Agent cleans up the worktree:
   cd /original/path
   git worktree remove ../improve-analyst-1703683200
                          │
                          ▼
8. Human reviews PR on GitHub
                          │
        ┌─────────────────┴─────────────────┐
        ▼                                   ▼
   APPROVED                              REJECTED
        │                                   │
        ▼                                   ▼
9a. Merge to main                     9b. Close PR
        │                                   │
        ▼                                   │
10. git pull on server                     Done
    (manual or webhook)
        │
        ▼
11. Chokidar detects file change
        │
        ▼
12. discoverPlugins() reloads config
        │
        ▼
13. Next request uses improved agent
```

**Why worktrees?**
- Main checkout stays clean - server runs uninterrupted
- No branch switching that could confuse the file watcher
- Agent can make changes without affecting live config
- Multiple agents can work on improvements simultaneously
- Easy cleanup with `git worktree remove`

## Implementation

### Change 1: Enable Graceful Shutdown (1 line)

**File**: [main.ts](../examples/basic-server/src/main.ts)

```typescript
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // ADD THIS LINE
  app.enableShutdownHooks();

  // ... rest of bootstrap
}
```

**What this does**: When the process receives SIGTERM (e.g., during deployment), NestJS will:
1. Stop accepting new connections
2. Wait for in-flight requests to complete
3. Run any `onModuleDestroy` hooks
4. Exit cleanly

### Change 2: Add Debounce to File Watcher (~10 lines)

**File**: [plugin-discovery.service.ts](../packages/claude-code-plugin-rest-api/src/services/plugin-discovery.service.ts)

**Current code** (lines 225-247):
```typescript
private startFileWatcher(): void {
  // ...
  this.watcher.on('change', async (filePath) => {
    this.logger.debug(`Plugin file changed: ${filePath}`);
    await this.discoverPlugins();  // Fires on EVERY change
    this.eventEmitter.emit('plugins.reloaded');
  });
}
```

**Problem**: If an agent makes multiple edits (common during git operations), we get multiple reloads.

**Solution**: Debounce changes:
```typescript
private debounceTimer: NodeJS.Timeout | null = null;
private readonly DEBOUNCE_MS = 500;

private startFileWatcher(): void {
  const pluginDir = this.options.pluginDirectory;

  this.watcher = chokidar.watch(pluginDir, {
    persistent: true,
    ignoreInitial: true,
    depth: 3,
  });

  const scheduleReload = () => {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(async () => {
      this.logger.log('Reloading plugins after file changes...');
      await this.discoverPlugins();
      this.eventEmitter.emit('plugins.reloaded');
    }, this.DEBOUNCE_MS);
  };

  this.watcher.on('change', (filePath) => {
    this.logger.debug(`Plugin file changed: ${filePath}`);
    scheduleReload();
  });

  this.watcher.on('add', (filePath) => {
    this.logger.debug(`Plugin file added: ${filePath}`);
    scheduleReload();
  });

  this.watcher.on('unlink', (filePath) => {
    this.logger.debug(`Plugin file removed: ${filePath}`);
    scheduleReload();
  });

  this.logger.log('Plugin hot reload enabled (500ms debounce)');
}
```

### Change 3: Add Error Handling for Reload (~5 lines)

**Problem**: If a plugin file has invalid YAML, the entire discovery fails silently.

**Solution**: Catch errors and keep the previous state:
```typescript
async discoverPlugins(): Promise<void> {
  const pluginDir = this.options.pluginDirectory;
  const absolutePluginDir = path.resolve(process.cwd(), pluginDir);

  this.logger.log(`Discovering plugins in ${absolutePluginDir}`);

  // Store previous state in case reload fails
  const previousPlugins = new Map(this.plugins);

  try {
    this.plugins.clear();  // Clear before re-scan

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
      // RESTORE previous plugins on failure
      this.logger.error(`Failed to reload plugins, keeping previous config: ${err.message}`);
      this.plugins = previousPlugins;
    }
  }
}
```

### Change 4: Optional Webhook for GitOps (~15 lines)

**File**: New controller `webhook.controller.ts` (optional)

```typescript
import { Controller, Post, HttpCode } from '@nestjs/common';
import { PluginDiscoveryService } from '../services/plugin-discovery.service.js';

@Controller('webhook')
export class WebhookController {
  constructor(private pluginDiscovery: PluginDiscoveryService) {}

  @Post('reload')
  @HttpCode(200)
  async triggerReload(): Promise<{ reloaded: boolean; pluginCount: number }> {
    await this.pluginDiscovery.discoverPlugins();
    return {
      reloaded: true,
      pluginCount: this.pluginDiscovery.getAllPlugins().length,
    };
  }
}
```

**Usage**: After merging a PR, trigger reload:
```bash
curl -X POST https://your-api.com/webhook/reload
```

Or configure GitHub webhook to hit this endpoint on merge to `main`.

## Self-Improvement Pattern (Documentation Only)

Add this to your agent's system prompt:

```markdown
## Self-Improvement Protocol

When you identify an improvement to your skills or prompts, use git worktrees to make changes without affecting the running server.

### Setup

First, note your current working directory:
```bash
ORIGINAL_DIR=$(pwd)
TIMESTAMP=$(date +%s)
WORKTREE_NAME="improve-$(basename $PWD)-$TIMESTAMP"
```

### Step 1: Create an isolated worktree

```bash
git worktree add ../$WORKTREE_NAME -b improve/skill-name-$TIMESTAMP
cd ../$WORKTREE_NAME
```

This creates a separate checkout where you can make changes without affecting the main directory.

### Step 2: Read your current configuration

```bash
cat .claude/plugins/YOUR_PLUGIN/skills/YOUR_SKILL/SKILL.md
```

### Step 3: Make your improvement

Use the Edit tool to modify the skill file in this worktree. The main checkout (where the server runs) is untouched.

### Step 4: Validate the YAML frontmatter

Ensure name, description, and allowed-tools are correctly formatted.

### Step 5: Commit with a clear message

```bash
git add -A
git commit -m "improve(skill-name): Description of improvement"
```

### Step 6: Push and create a PR for human review

```bash
git push -u origin HEAD
gh pr create \
  --title "improve(skill-name): Description" \
  --body "## What I learned

## Changes made

## Testing done"
```

### Step 7: Clean up the worktree

```bash
cd $ORIGINAL_DIR
git worktree remove ../$WORKTREE_NAME
```

### Step 8: Wait for human approval

Do not merge your own PRs. A human must review and approve the changes.
```

### Why Worktrees Instead of Branch Switching?

| Approach | Problem |
|----------|---------|
| `git checkout -b` | Switches files in place, could trigger hot-reload with incomplete changes |
| `git stash` + checkout | Risk of conflicts, affects working directory |
| **git worktree** | Completely isolated, main checkout untouched, server runs normally |

## What We're NOT Building

| Feature | Why Not |
|---------|---------|
| Double-buffered registry | JavaScript is single-threaded; Map.set() is atomic |
| Version history in memory | Git has infinite history: `git log --oneline` |
| Rollback API | Use git: `git revert HEAD` or `git checkout HEAD~1 -- path` |
| AsyncLock | No concurrency in Node.js event loop |
| SelfModificationGuard | PR review is the security gate |
| Rate limiting | If agent loops, that's a prompt problem |
| Audit logging | `git log --all --oneline -- path/to/file` |
| Gateway/Traefik config | Deployment concern, not app concern |
| Kubernetes manifests | Deployment concern, not app concern |
| Prometheus metrics | Add when someone asks for it |

## Testing

### Manual Test: Hot Reload

```bash
# Terminal 1: Start server with hot reload
cd examples/basic-server
PLUGINS_HOT_RELOAD=true pnpm dev

# Terminal 2: Modify a plugin file
echo "# Test change" >> .claude/plugins/example/skills/test/SKILL.md

# Terminal 1 should show:
# [PluginDiscoveryService] Plugin file changed: ...
# [PluginDiscoveryService] Reloading plugins after file changes...
# [PluginDiscoveryService] Discovered N plugins
```

### Manual Test: Graceful Shutdown

```bash
# Terminal 1: Start server
pnpm dev

# Terminal 2: Start a long-running request
curl -N http://localhost:3000/v1/agents/analyst/stream -d '{"prompt":"analyze codebase"}'

# Terminal 3: Send SIGTERM
kill -TERM $(pgrep -f "node.*basic-server")

# Terminal 1 should show graceful shutdown
# Terminal 2 request should complete, not be killed
```

### Manual Test: Self-Improvement Flow

```bash
# 1. Create an agent that can modify files
# (Already works with permissionMode: 'bypassPermissions')

# 2. Give it a task that triggers self-improvement
curl -X POST http://localhost:3000/v1/agents/self-improver \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Analyze your recent performance and suggest one improvement to your skill file"}'

# 3. Check for PR
gh pr list

# 4. Review and merge the PR

# 5. Trigger reload (or wait for file watcher)
curl -X POST http://localhost:3000/webhook/reload
```

## Files Changed

| File | Change | Lines |
|------|--------|-------|
| `examples/basic-server/src/main.ts` | Add `app.enableShutdownHooks()` | +1 |
| `packages/.../plugin-discovery.service.ts` | Add debounce + error handling | +15 |
| `packages/.../controllers/webhook.controller.ts` | New file (optional) | +15 |

**Total: ~31 lines of code**

## Acceptance Criteria

- [ ] `app.enableShutdownHooks()` is called in main.ts
- [ ] File watcher debounces multiple changes within 500ms
- [ ] Failed plugin reload keeps previous working config
- [ ] Hot reload works: modify file → see "Discovered N plugins" log within 1 second
- [ ] Graceful shutdown works: in-flight requests complete before exit
- [ ] Documentation explains self-improvement pattern

## What This Enables

With just ~30 lines of code, you get:

1. **Self-improving agents**: Agents can modify their own prompts and skills
2. **Human-in-the-loop**: All changes go through PR review
3. **Audit trail**: Full git history of every change
4. **Instant rollback**: `git revert` undoes any bad change
5. **Zero-downtime reload**: File changes take effect without restart
6. **Graceful deployments**: Kubernetes/Docker can restart without dropping requests

The simplest thing that could possibly work.

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)
