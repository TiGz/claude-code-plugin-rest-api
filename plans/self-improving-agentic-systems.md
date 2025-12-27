# feat: Self-Improving Agentic Systems with Zero-Downtime Deployment

> **Date**: 2025-12-27
> **Type**: Enhancement / Architecture
> **Status**: Draft

## Overview

Enable self-improving agentic systems where Claude Code plugin agents can modify their own configurations, commit changes via GitOps for human review, and deploy without service interruption. This transforms static agent definitions into living, evolving systems that learn and improve while maintaining production stability.

## Problem Statement / Motivation

Current limitations:

1. **Static Agent Definitions**: Agents cannot improve their prompts, skills, or configurations based on feedback or learning
2. **Restart Required for Changes**: While hot-reload exists, there's no coordination with active requests, risking data loss
3. **No Graceful Shutdown**: SIGTERM kills in-flight requests immediately
4. **Single-Instance Architecture**: No gateway configuration for zero-downtime rolling restarts
5. **No Rollback Capability**: When agents break themselves, manual file editing is required
6. **No Audit Trail**: Self-modifications aren't tracked for compliance or debugging

The vision: Agents that can reason about their own performance, propose improvements, submit them for human review, and see their improvements deployed—all without service interruption.

## Proposed Solution

A three-layer architecture supporting self-improving agents:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Layer 1: Gateway                             │
│  Traefik / Kong / K8s Service with dynamic upstream management      │
│  - Connection draining                                              │
│  - Health-based routing                                             │
│  - Zero-downtime traffic shifting                                   │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                    ┌──────────────┴──────────────┐
                    ▼                              ▼
┌─────────────────────────────────┐ ┌─────────────────────────────────┐
│        Layer 2: Runtime A       │ │        Layer 2: Runtime B       │
│  NestJS + Claude Plugin Module  │ │  NestJS + Claude Plugin Module  │
│  - Double-buffered registry     │ │  - Double-buffered registry     │
│  - Graceful shutdown hooks      │ │  - Graceful shutdown hooks      │
│  - Request completion tracking  │ │  - Request completion tracking  │
│  - SSE stream management        │ │  - SSE stream management        │
└─────────────────────────────────┘ └─────────────────────────────────┘
                    │                              │
                    └──────────────┬───────────────┘
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Layer 3: Configuration Store                     │
│  Git repository (source of truth) + ConfigMaps                      │
│  - Agent/skill markdown files                                       │
│  - Version history with git                                         │
│  - Human review via PRs                                             │
│  - GitOps sync (ArgoCD/Flux or manual pull)                         │
└─────────────────────────────────────────────────────────────────────┘
```

## Technical Approach

### Architecture Options Comparison

| Approach | Complexity | Reliability | Use Case |
|----------|------------|-------------|----------|
| **A: Enhanced Hot-Reload Only** | Low | Medium | Development, single-instance |
| **B: PM2 Cluster Mode** | Medium | High | Simple production, no K8s |
| **C: Gateway + Dual Runtime** | Medium-High | Very High | Production with traffic control |
| **D: Kubernetes Native** | High | Very High | K8s-native deployments |

**Recommended**: Start with **Option A** for core functionality, add **Option C or D** for production zero-downtime.

### Option A: Enhanced Hot-Reload (Foundation)

Enhance existing hot-reload with safety and atomicity:

```typescript
// packages/claude-code-plugin-rest-api/src/services/plugin-discovery.service.ts

@Injectable()
export class PluginDiscoveryService implements OnModuleInit, OnModuleDestroy {
  // Double-buffered registry for atomic swaps
  private activePlugins = new Map<string, DiscoveredPlugin>();
  private pendingPlugins = new Map<string, DiscoveredPlugin>();
  private versionHistory: PluginVersion[] = [];
  private readonly MAX_VERSIONS = 10;

  // Read-write lock for reload coordination
  private reloadLock = new AsyncLock();
  private isReloading = false;

  async reloadPlugins(): Promise<ReloadResult> {
    return this.reloadLock.acquire('reload', async () => {
      this.isReloading = true;
      const previousVersion = this.createSnapshot();

      try {
        // Load into pending buffer
        await this.discoverPluginsInto(this.pendingPlugins);

        // Validate before activation
        const validation = await this.validatePlugins(this.pendingPlugins);
        if (!validation.valid) {
          this.logger.warn('Plugin validation failed', validation.errors);
          return { success: false, errors: validation.errors };
        }

        // Atomic swap
        [this.activePlugins, this.pendingPlugins] =
          [this.pendingPlugins, this.activePlugins];

        // Store version for rollback
        this.versionHistory.unshift({
          timestamp: Date.now(),
          plugins: previousVersion,
          checksum: this.computeChecksum(previousVersion),
        });
        this.versionHistory = this.versionHistory.slice(0, this.MAX_VERSIONS);

        this.eventEmitter.emit('plugins.activated', {
          version: Date.now(),
          changed: this.computeDiff(previousVersion, this.activePlugins),
        });

        return { success: true };
      } catch (error) {
        this.logger.error('Reload failed, keeping previous version', error);
        return { success: false, error: error.message };
      } finally {
        this.isReloading = false;
      }
    });
  }

  async rollback(versionIndex: number = 0): Promise<boolean> {
    const version = this.versionHistory[versionIndex];
    if (!version) return false;

    this.activePlugins = new Map(version.plugins);
    this.eventEmitter.emit('plugins.rolledBack', { to: version.timestamp });
    return true;
  }
}
```

### Option C: Gateway + Dual Runtime (Zero-Downtime)

For production zero-downtime with traffic control:

```yaml
# docker-compose.gateway.yml
version: '3.8'

services:
  traefik:
    image: traefik:v3.0
    command:
      - "--api.insecure=true"
      - "--providers.file.directory=/etc/traefik/dynamic"
      - "--providers.file.watch=true"
      - "--entrypoints.web.address=:80"
    ports:
      - "80:80"
      - "8080:8080"  # Dashboard
    volumes:
      - ./traefik:/etc/traefik/dynamic

  api-blue:
    build: .
    environment:
      - INSTANCE_COLOR=blue
      - PLUGINS_HOT_RELOAD=true
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health/ready"]
      interval: 5s
      timeout: 3s
      retries: 3

  api-green:
    build: .
    environment:
      - INSTANCE_COLOR=green
      - PLUGINS_HOT_RELOAD=true
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health/ready"]
      interval: 5s
      timeout: 3s
      retries: 3
```

```yaml
# traefik/dynamic.yml (hot-reloaded by Traefik)
http:
  routers:
    api:
      rule: "PathPrefix(`/v1`)"
      service: api-service

  services:
    api-service:
      loadBalancer:
        healthCheck:
          path: /health/ready
          interval: 5s
          timeout: 3s
        servers:
          - url: "http://api-blue:3000"
            weight: 1
          - url: "http://api-green:3000"
            weight: 1
```

**Rolling Restart Orchestrator:**

```typescript
// scripts/rolling-restart.ts
import * as fs from 'fs/promises';
import * as yaml from 'yaml';

interface TraefikConfig {
  http: {
    services: {
      'api-service': {
        loadBalancer: {
          servers: Array<{ url: string; weight: number }>;
        };
      };
    };
  };
}

async function rollingRestart() {
  const configPath = './traefik/dynamic.yml';

  // Phase 1: Drain blue
  await updateWeight('api-blue', 0);
  await waitForDrain('api-blue', 30000);

  // Phase 2: Restart blue
  await exec('docker-compose restart api-blue');
  await waitForHealthy('api-blue');

  // Phase 3: Shift traffic to blue
  await updateWeight('api-blue', 1);
  await updateWeight('api-green', 0);
  await waitForDrain('api-green', 30000);

  // Phase 4: Restart green
  await exec('docker-compose restart api-green');
  await waitForHealthy('api-green');

  // Phase 5: Restore balance
  await updateWeight('api-green', 1);

  console.log('Rolling restart complete');
}

async function updateWeight(instance: string, weight: number) {
  const config = yaml.parse(await fs.readFile(configPath, 'utf-8'));
  const servers = config.http.services['api-service'].loadBalancer.servers;
  const server = servers.find(s => s.url.includes(instance));
  if (server) server.weight = weight;
  await fs.writeFile(configPath, yaml.stringify(config));
  // Traefik will hot-reload automatically
}
```

### Self-Modification Pattern

Agent capable of improving itself:

```typescript
// Example agent configuration
ClaudePluginModule.forRoot({
  agents: {
    'self-improving-analyst': {
      systemPrompt: `You are a code analyst that continuously improves.

After each analysis:
1. Reflect on what worked well and what could be better
2. If you identify a pattern you keep missing, update your skill file
3. Create a git branch for the improvement
4. Submit for human review via PR

Your skill file is at: .claude/plugins/analyst/skills/analysis/SKILL.md
Only modify files in your own plugin directory.`,
      permissionMode: 'bypassPermissions',
      tools: { type: 'preset', preset: 'claude_code' },
      allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
      maxTurns: 30,
    },
  },
})
```

**Self-Improvement Workflow:**

```typescript
// The agent can execute this workflow autonomously
const selfImprovementPrompt = `
When you identify an improvement to your skills:

1. Create a feature branch:
   git checkout -b improve/analyst-{timestamp}

2. Read your current skill file:
   Read .claude/plugins/analyst/skills/analysis/SKILL.md

3. Make the improvement:
   Edit the skill file with your enhancement

4. Validate the YAML frontmatter is correct:
   Ensure name, description, and allowed-tools are properly formatted

5. Commit with a clear message:
   git add -A && git commit -m "improve(analyst): Add pattern for X"

6. Push and create PR:
   git push -u origin improve/analyst-{timestamp}
   gh pr create --title "improve(analyst): Add pattern for X" --body "..."

7. Wait for human approval before the change goes live.
`;
```

### Graceful Shutdown Implementation

```typescript
// packages/claude-code-plugin-rest-api/src/services/shutdown.service.ts

@Injectable()
export class ShutdownService implements OnApplicationShutdown {
  private isShuttingDown = false;
  private activeRequests = new Set<string>();
  private readonly shutdownTimeout: number;

  constructor(
    @Inject(MODULE_OPTIONS) private options: ClaudePluginModuleOptions,
    private streamSessionService: StreamSessionService,
  ) {
    this.shutdownTimeout = options.gracefulShutdownTimeoutMs ?? 60000;
  }

  registerRequest(requestId: string): void {
    this.activeRequests.add(requestId);
  }

  completeRequest(requestId: string): void {
    this.activeRequests.delete(requestId);
  }

  isAcceptingRequests(): boolean {
    return !this.isShuttingDown;
  }

  async onApplicationShutdown(signal: string): Promise<void> {
    this.logger.log(`Received ${signal}, initiating graceful shutdown`);
    this.isShuttingDown = true;

    // Notify SSE clients
    await this.streamSessionService.notifyShutdown();

    // Wait for active requests with timeout
    const startTime = Date.now();
    while (this.activeRequests.size > 0) {
      if (Date.now() - startTime > this.shutdownTimeout) {
        this.logger.warn(
          `Shutdown timeout, ${this.activeRequests.size} requests interrupted`
        );
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    this.logger.log('Graceful shutdown complete');
  }
}
```

### Health Check Endpoints

```typescript
// packages/claude-code-plugin-rest-api/src/controllers/health.controller.ts

@Controller('health')
export class HealthController {
  constructor(
    private shutdownService: ShutdownService,
    private pluginDiscoveryService: PluginDiscoveryService,
  ) {}

  @Get()
  getLiveness(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  getReadiness(): { ready: boolean; reason?: string } {
    if (!this.shutdownService.isAcceptingRequests()) {
      throw new HttpException(
        { ready: false, reason: 'shutting_down' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    if (this.pluginDiscoveryService.isReloading()) {
      throw new HttpException(
        { ready: false, reason: 'reloading_plugins' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return { ready: true };
  }

  @Get('info')
  getInfo(): HealthInfo {
    return {
      status: 'ok',
      plugins: this.pluginDiscoveryService.getPluginCount(),
      activeRequests: this.shutdownService.getActiveRequestCount(),
      lastReload: this.pluginDiscoveryService.getLastReloadTime(),
      version: process.env.npm_package_version,
    };
  }
}
```

## Implementation Phases

### Phase 1: Core Safety and Stability

**Goal**: Make hot-reload safe and reversible

- [ ] Implement double-buffered plugin registry in `PluginDiscoveryService`
- [ ] Add plugin validation before activation (YAML syntax, schema, semantic)
- [ ] Implement version history with configurable retention (default: 10 versions)
- [ ] Add rollback API endpoint: `POST /v1/admin/plugins/rollback`
- [ ] Enable NestJS shutdown hooks in `main.ts`
- [ ] Implement `ShutdownService` with request tracking
- [ ] Add health endpoints (`/health`, `/health/ready`, `/health/info`)
- [ ] Add debounced file watching (500ms delay to batch changes)

**Files to modify:**
- [plugin-discovery.service.ts](packages/claude-code-plugin-rest-api/src/services/plugin-discovery.service.ts)
- [claude-plugin.module.ts](packages/claude-code-plugin-rest-api/src/claude-plugin.module.ts)
- `shutdown.service.ts` (new)
- `health.controller.ts` (new)
- [main.ts](examples/basic-server/src/main.ts)

### Phase 2: Self-Modification Framework

**Goal**: Enable agents to safely modify themselves

- [ ] Create `SelfModificationGuard` to restrict file access to own plugin directory
- [ ] Add validation hook that runs before Write/Edit tools modify plugin files
- [ ] Implement `plugins.modified` event with agent attribution
- [ ] Add modification rate limiting (configurable, default: 5/hour per agent)
- [ ] Create audit log for all self-modifications
- [ ] Document self-improvement patterns in README

**Files to create:**
- `self-modification.guard.ts`
- `modification-audit.service.ts`

### Phase 3: GitOps Integration

**Goal**: Human-in-the-loop for agent improvements

- [ ] Create `GitOpsService` with helper methods for common operations
- [ ] Implement branch creation from agent context
- [ ] Add PR creation with structured templates
- [ ] Create webhook endpoint for merge events (triggers reload)
- [ ] Add dry-run validation before git operations
- [ ] Document GitOps workflow

**Files to create:**
- `gitops.service.ts`
- `webhook.controller.ts`

### Phase 4: Zero-Downtime Deployment

**Goal**: Production-ready deployment with traffic control

- [ ] Create Traefik configuration templates
- [ ] Implement rolling restart orchestrator script
- [ ] Add connection draining coordination
- [ ] Create Kubernetes manifests with proper probes
- [ ] Add preStop hook delay configuration
- [ ] Document deployment patterns

**Files to create:**
- `docker-compose.gateway.yml`
- `traefik/dynamic.yml`
- `scripts/rolling-restart.ts`
- `k8s/` directory with manifests

### Phase 5: Observability and Polish

**Goal**: Production monitoring and debugging

- [ ] Add structured logging for all lifecycle events
- [ ] Implement metrics endpoint (`/metrics` for Prometheus)
- [ ] Add SSE event for reload notifications to clients
- [ ] Create admin dashboard endpoint for plugin status
- [ ] Performance optimize incremental reloads
- [ ] Add comprehensive documentation

## Alternative Approaches Considered

### 1. Module Hot Replacement (Like webpack HMR)

**Approach**: Invalidate Node.js module cache and re-import changed modules.

**Why rejected**:
- Complex with NestJS dependency injection
- Risk of memory leaks from orphaned module instances
- Plugin files are data (markdown), not code modules

### 2. External Configuration Service

**Approach**: Store agent configs in Redis/etcd, poll for changes.

**Why rejected**:
- Adds infrastructure complexity
- Git provides better versioning than KV stores
- File-based approach already works with Claude Code plugin conventions

### 3. Blue-Green with DNS Switching

**Approach**: Run two complete deployments, switch DNS on update.

**Why rejected**:
- Requires duplicate infrastructure
- DNS TTL causes delayed switching
- Gateway approach is more granular and faster

### 4. Process-Level Hot Swap (like Erlang)

**Approach**: Replace running code without restarting process.

**Why rejected**:
- Node.js doesn't support this natively
- Would require complete architecture redesign
- File-based config reload is simpler and sufficient

## Acceptance Criteria

### Functional Requirements

- [ ] Agent can modify its own plugin files using Write/Edit tools
- [ ] Modified plugins are automatically reloaded within 2 seconds
- [ ] Invalid modifications are rejected without affecting running version
- [ ] Admin can rollback to any of the last 10 plugin versions
- [ ] Active SSE streams continue during reload (old config)
- [ ] New requests get new plugin configuration immediately after reload
- [ ] Graceful shutdown waits for active requests (configurable timeout)
- [ ] Health endpoints return correct status during lifecycle events

### Non-Functional Requirements

- [ ] Plugin reload completes in < 500ms for 50 plugins
- [ ] Zero dropped requests during rolling restart
- [ ] Memory overhead < 50MB for version history
- [ ] Modification audit log retained for 30 days

### Quality Gates

- [ ] Unit tests for double-buffered registry
- [ ] E2E tests for self-modification workflow
- [ ] Integration tests for graceful shutdown
- [ ] Load tests for concurrent reload scenarios
- [ ] Security review of file access restrictions

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Reload success rate | > 99.9% | Failed reloads / total reloads |
| Mean time to reload | < 500ms | p95 of reload duration |
| Dropped requests during restart | 0 | Requests that received 5xx during rolling restart |
| Self-improvement adoption | > 3 agents | Agents using self-modification within 30 days |
| Human approval rate | > 80% | Merged PRs / submitted PRs from agents |

## Dependencies & Prerequisites

**Required:**
- [ ] Claude Max subscription with Agent SDK access
- [ ] Git repository for plugin source of truth
- [ ] Docker for gateway deployment (optional for dev)

**Nice to have:**
- [ ] Kubernetes cluster for production deployment
- [ ] GitHub/GitLab for PR-based review workflow
- [ ] Prometheus/Grafana for metrics

## Risk Analysis & Mitigation

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Agent writes invalid config, breaks itself | High | Medium | Validation before activation, automatic rollback |
| Infinite self-modification loop | Medium | High | Rate limiting, human approval gate |
| Memory leak from version history | Low | Medium | Configurable max versions, periodic cleanup |
| Race condition during reload | Medium | Medium | Read-write lock, request queuing |
| Gateway misconfiguration drops traffic | Low | High | Health checks, automatic failover |

## References & Research

### Internal References
- [plugin-discovery.service.ts:225-247](packages/claude-code-plugin-rest-api/src/services/plugin-discovery.service.ts#L225-L247) - Current chokidar implementation
- [claude-plugin.module.ts:109-119](packages/claude-code-plugin-rest-api/src/claude-plugin.module.ts#L109-L119) - Hot reload option
- [agent.service.ts:44-91](packages/claude-code-plugin-rest-api/src/services/agent.service.ts#L44-L91) - Agent execution flow

### External References
- [NestJS Lifecycle Events](https://docs.nestjs.com/fundamentals/lifecycle-events)
- [NestJS Terminus Health Checks](https://docs.nestjs.com/recipes/terminus)
- [Chokidar Documentation](https://github.com/paulmillr/chokidar)
- [Traefik Dynamic Configuration](https://doc.traefik.io/traefik/providers/file/)
- [Kubernetes Graceful Shutdown](https://cloud.google.com/blog/products/containers-kubernetes/kubernetes-best-practices-terminating-with-grace)
- [Claude Agent SDK Documentation](https://docs.anthropic.com/en/docs/claude-code/sdk)

### Research Documents
- [self-evolving-agents-best-practices.md](plans/self-evolving-agents-best-practices.md)
- [plugin-system-research.md](plans/plugin-system-research.md)

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)
