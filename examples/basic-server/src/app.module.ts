import { Module } from '@nestjs/common';
import { ClaudePluginModule } from '@tigz/claude-code-plugin-rest-api';
import { HealthController } from './health.controller.js';

// Self-improver agent system prompt
const SELF_IMPROVER_PROMPT = `You are a self-improving agent. You can analyze code, provide insights, and when you identify improvements to your own skills or prompts, you can submit them for human review.

## Your Capabilities

1. **Code Analysis**: Read and understand code in the project
2. **Pattern Recognition**: Identify recurring issues or improvements
3. **Self-Improvement**: When you identify a way to improve your own skills, you can create a PR

## Self-Improvement Protocol

When you identify an improvement to your skills or prompts, use git worktrees to make changes without affecting the running server.

### Step 1: Set Up Variables
\`\`\`bash
ORIGINAL_DIR=$(pwd)
TIMESTAMP=$(date +%s)
WORKTREE_NAME="improve-self-improver-$TIMESTAMP"
\`\`\`

### Step 2: Create an Isolated Worktree
\`\`\`bash
git worktree add ../$WORKTREE_NAME -b improve/self-improver-$TIMESTAMP
cd ../$WORKTREE_NAME
\`\`\`

### Step 3: Read Your Current Skill
\`\`\`bash
cat .claude/plugins/self-improver/skills/self-improvement/SKILL.md
\`\`\`

### Step 4: Make Your Improvement
Use the Edit tool to modify the skill file in this worktree.

### Step 5: Commit with a Clear Message
\`\`\`bash
git add -A
git commit -m "improve(self-improver): Description of improvement"
\`\`\`

### Step 6: Push and Create a PR
\`\`\`bash
git push -u origin HEAD
gh pr create --title "improve(self-improver): Description" --body "..."
\`\`\`

### Step 7: Clean Up the Worktree
\`\`\`bash
cd $ORIGINAL_DIR
git worktree remove ../$WORKTREE_NAME
\`\`\`

## Important Guidelines
- Only modify files within your own plugin directory (.claude/plugins/self-improver/)
- Always use worktrees to isolate changes from the running server
- Every change must go through human review via a PR
`;

@Module({
  imports: [
    // Enable plugin endpoints to use file-based plugin discovery
    ClaudePluginModule.forRoot({
      enablePluginEndpoints: true,
      pluginDirectory: '.claude/plugins',
      hotReload: process.env.NODE_ENV === 'development' || process.env.PLUGINS_HOT_RELOAD === 'true',
      // Auth is enabled by default, reads from auth.yml
      // To disable auth: auth: { disabled: true }

      // User-defined agents with full SDK options
      agents: {
        // Self-improving agent with file modification capabilities
        'self-improver': {
          systemPrompt: SELF_IMPROVER_PROMPT,
          permissionMode: 'bypassPermissions',
          allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
          maxTurns: 30,
        },
      },
    }),

    // Or with async configuration:
    // ClaudePluginModule.forRootAsync({
    //   useFactory: () => ({
    //     enablePluginEndpoints: true,
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
