import type { Tool, ToolRegistry } from './Registry.js';
import type { AurixConfig } from '../agent/Config.js';

// Orchestrator: lets the main agent fan out work to parallel sub-agents.
// Each sub-agent is a fresh AgentLoop with the same tools MINUS spawn_agent
// (prevents infinite recursion), run with a concurrency cap to respect rate
// limits. No langchain — pure native AgentLoop + provider.

const MAX_CONCURRENCY = 3;
const MAX_AGENTS = 12;
const SUBAGENT_MAX_ITERATIONS = 40;

// Build a registry for sub-agents: clone parent tools, drop spawn_agent.
function buildSubRegistry(parent: ToolRegistry, RegistryClass: any): ToolRegistry {
  const sub = new RegistryClass() as ToolRegistry;
  for (const t of parent.list()) {
    if (t.name === 'spawn_agent') continue;
    sub.register(t);
  }
  return sub;
}

// Run async jobs with a bounded concurrency. Preserves input order in results.
async function runBounded<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

// Drain a sub-agent's run() generator and collect its final text output.
async function collectAgentResult(agent: any, prompt: string): Promise<string> {
  let lastText = '';
  const chunks: string[] = [];
  try {
    for await (const evt of agent.run(prompt)) {
      if (evt.type === 'text' && evt.data) {
        lastText = evt.data;
        chunks.push(evt.data);
      } else if (evt.type === 'error') {
        return `[sub-agent error] ${evt.data}`;
      } else if (evt.type === 'done') {
        break;
      }
    }
  } catch (e: any) {
    return `[sub-agent crashed] ${e?.message || String(e)}`;
  }
  // prefer the final assistant message; fall back to the joined stream
  return lastText || chunks.join('\n') || '(sub-agent produced no output)';
}

export function createSpawnAgentTool(config: AurixConfig, registry: ToolRegistry): Tool {
  return {
    name: 'spawn_agent',
    description: `Run one or more autonomous sub-agents in parallel to handle independent subtasks, then collect their results. Use this to decompose a large task (research many files, check many candidates, run independent investigations) and cover them concurrently. Each sub-agent has the same tools as you EXCEPT it cannot spawn further agents. Up to ${MAX_AGENTS} sub-agents; at most ${MAX_CONCURRENCY} run at once. Each "task" string is a complete, self-contained instruction for one sub-agent — be specific about what to do and what to report back.`,
    parameters: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of self-contained task prompts, one per sub-agent. Each runs independently and in parallel.',
        },
      },
      required: ['tasks'],
    },
    async execute(args) {
      const rawTasks = args.tasks;
      if (!Array.isArray(rawTasks) || rawTasks.length === 0) {
        return 'Error: spawn_agent requires a non-empty "tasks" array of prompt strings.';
      }
      const tasks = rawTasks.map(t => String(t)).filter(t => t.trim().length > 0).slice(0, MAX_AGENTS);
      if (tasks.length === 0) return 'Error: all tasks were empty.';

      // Lazy imports to avoid a circular dependency (AgentLoop imports tools).
      const { AgentLoop } = await import('../agent/AgentLoop.js');
      const { ToolRegistry } = await import('./Registry.js');

      const subRegistry = buildSubRegistry(registry, ToolRegistry);

      const results = await runBounded(tasks, MAX_CONCURRENCY, async (prompt) => {
        const sub = new AgentLoop(config, subRegistry);
        if (typeof sub.setMaxIterations === 'function') sub.setMaxIterations(SUBAGENT_MAX_ITERATIONS);
        return collectAgentResult(sub, prompt);
      });

      const out = results
        .map((r, i) => `## Sub-agent ${i + 1}\nTask: ${tasks[i].slice(0, 120)}\n\n${r}`)
        .join('\n\n---\n\n');
      return `Spawned ${tasks.length} sub-agent(s) (max ${MAX_CONCURRENCY} concurrent). Results:\n\n${out}`;
    },
  };
}
