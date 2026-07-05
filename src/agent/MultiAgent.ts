import type { AurixConfig } from './Config.js';
import type { ToolRegistry } from '../tools/Registry.js';
import { createProvider, type Message, type Provider } from '../providers/index.js';
import type { AgentEvent } from './AgentLoop.js';

interface SpecialistDef {
  name: string;
  team: 'coding' | 'academic' | 'meta';
  description: string;
  tools: string[];
  systemPrompt: string;
}

const SPECIALISTS: Record<string, SpecialistDef> = {
  'web-dev': {
    name: 'Web Developer',
    team: 'coding',
    description: 'Full-stack web developer for complete web applications and integrations.',
    tools: [
      'terminal',
      'read_file',
      'write_file',
      'search_files',
      'file_edit',
      'code_exec',
      'browser',
    ],
    systemPrompt:
      'You are a senior full-stack web developer. Build complete, working, production-ready code. Use tools to inspect, edit, and verify. No placeholders.',
  },
  frontend: {
    name: 'Frontend Developer',
    team: 'coding',
    description: 'Frontend specialist for React components, CSS, responsive UI, and accessibility.',
    tools: [
      'terminal',
      'read_file',
      'write_file',
      'search_files',
      'file_edit',
      'code_exec',
      'browser',
    ],
    systemPrompt:
      'You are a frontend specialist. Build responsive, accessible UI with clean React/TypeScript patterns. Use tools to inspect and verify.',
  },
  backend: {
    name: 'Backend Developer',
    team: 'coding',
    description: 'Backend specialist for APIs, databases, auth, and server architecture.',
    tools: ['terminal', 'read_file', 'write_file', 'search_files', 'file_edit', 'code_exec'],
    systemPrompt:
      'You are a backend specialist. Build robust server-side code with validation, error handling, and security in mind. Use tools to inspect and verify.',
  },
  'ui-designer': {
    name: 'UI Designer',
    team: 'coding',
    description: 'UI/UX designer for layouts, design systems, and visual polish.',
    tools: ['read_file', 'write_file', 'browser', 'web_search'],
    systemPrompt:
      'You are a UI/UX designer who codes. Design usable, accessible interfaces and explain concrete implementation choices.',
  },
  'code-reviewer': {
    name: 'Code Reviewer',
    team: 'coding',
    description:
      'Senior code reviewer for bugs, performance, security, maintainability, and tests.',
    tools: ['terminal', 'read_file', 'search_files'],
    systemPrompt:
      'You are a senior code reviewer. Find concrete bugs and risks, verify them where possible, and provide actionable fixes with file references.',
  },
  cybersecurity: {
    name: 'Cybersecurity Expert',
    team: 'coding',
    description: 'Security specialist for vulnerability assessment and secure coding review.',
    tools: ['terminal', 'read_file', 'search_files', 'code_exec', 'web_search', 'browser'],
    systemPrompt:
      'You are a cybersecurity expert. Audit authorized code/systems for vulnerabilities and provide specific remediation steps.',
  },
  researcher: {
    name: 'Research Analyst',
    team: 'academic',
    description: 'Deep researcher who gathers and verifies facts across sources.',
    tools: ['web_search', 'browser', 'read_file', 'write_file'],
    systemPrompt:
      'You are a research analyst. Gather evidence, verify claims across sources, and separate facts from uncertainty. Cite sources when available.',
  },
  'journal-writer': {
    name: 'Journal Writer',
    team: 'academic',
    description: 'Academic writer for structured papers, citations, and methodology.',
    tools: ['web_search', 'read_file', 'write_file', 'pdf'],
    systemPrompt:
      'You are an academic writer. Produce structured, citation-aware, readable academic writing without filler.',
  },
  'data-analyst': {
    name: 'Data Analyst',
    team: 'academic',
    description: 'Data analysis specialist for statistics, trends, and visualizations.',
    tools: ['terminal', 'read_file', 'write_file', 'code_exec', 'web_search'],
    systemPrompt:
      'You are a data analyst. Analyze data rigorously, show calculations/code when useful, and explain limitations.',
  },
  editor: {
    name: 'Editor',
    team: 'academic',
    description: 'Professional editor for clarity, grammar, flow, and formatting.',
    tools: ['read_file', 'write_file', 'file_edit'],
    systemPrompt:
      'You are a professional editor. Improve clarity, consistency, grammar, structure, and formatting with concrete edits.',
  },
  'user-advocate': {
    name: 'User Advocate',
    team: 'meta',
    description: 'Checks whether work actually meets the user need.',
    tools: [],
    systemPrompt:
      'You are the user advocate. Identify missing requirements, edge cases, and whether the result is practical for the user.',
  },
  judge: {
    name: 'Judge',
    team: 'meta',
    description: 'Final evaluator and synthesizer for specialist outputs.',
    tools: [],
    systemPrompt:
      'You are the judge. Evaluate specialist outputs for correctness, completeness, quality, and consistency, then synthesize the best final answer.',
  },
};

export interface MultiAgentResult {
  answer: string;
  route: string;
  specialistUsed?: string;
}

export interface MultiAgentRunOptions {
  onEvent?: (event: AgentEvent) => void;
}

const MAX_SPECIALISTS = 3;
const SUBAGENT_MAX_ITERATIONS = 40;

async function runBounded<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
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

export class MultiAgentSystem {
  private config: AurixConfig;
  private registry: ToolRegistry;
  private provider: Provider;

  constructor(config: AurixConfig, registry: ToolRegistry) {
    this.config = config;
    this.registry = registry;
    this.provider = createProvider(config);
  }

  async run(userMessage: string, options: MultiAgentRunOptions = {}): Promise<MultiAgentResult> {
    const plan = await this.supervisorPlan(userMessage);

    if (plan.route === 'direct' || plan.agents.length === 0) {
      const response = await this.provider.chat([
        {
          role: 'system',
          content: 'You are AURIX — a direct, action-oriented AI. Be concise and accurate.',
        },
        { role: 'user', content: userMessage },
      ]);
      return { answer: response.text, route: 'direct' };
    }

    const selected = plan.agents.slice(0, MAX_SPECIALISTS);
    options.onEvent?.({
      type: 'route',
      data: `Selected specialists: ${selected.map((id) => SPECIALISTS[id]?.name || id).join(', ')}`,
      toolName: 'native-multiagent',
    });

    const outputs = await runBounded(selected, MAX_SPECIALISTS, async (agentId, index) => {
      const specialist = SPECIALISTS[agentId];
      if (!specialist) return { agentId, output: `Unknown specialist: ${agentId}` };
      const output = await this.runSpecialist(agentId, specialist, userMessage, index, options);
      return { agentId, output };
    });

    const specialistOutputs: Record<string, string> = {};
    for (const item of outputs) specialistOutputs[item.agentId] = item.output;

    if (outputs.length > 1) {
      const answer = await this.runJudge(userMessage, specialistOutputs);
      return {
        answer,
        route: 'multi-agent',
        specialistUsed: selected.map((id) => SPECIALISTS[id]?.name || id).join(', '),
      };
    }

    const only = outputs[0];
    return {
      answer: only?.output || 'No specialist output generated.',
      route: only?.agentId || 'multi-agent',
      specialistUsed: only ? SPECIALISTS[only.agentId]?.name || only.agentId : undefined,
    };
  }

  private async supervisorPlan(message: string): Promise<{ route: string; agents: string[] }> {
    const agentList = Object.entries(SPECIALISTS)
      .filter(([id]) => id !== 'judge')
      .map(([id, s]) => `- ${id} (${s.team}): ${s.description}`)
      .join('\n');

    const messages: Message[] = [
      {
        role: 'system',
        content: `You are the AURIX native multi-agent supervisor. Choose specialists only when they are useful.

SPECIALISTS:
${agentList}

RULES:
- For coding implementation: pick web-dev/frontend/backend as relevant plus code-reviewer.
- For security: cybersecurity plus code-reviewer.
- For research/journal: researcher plus writer/editor/data-analyst if relevant.
- For design: ui-designer plus frontend.
- For simple questions: ROUTE: direct.
- Pick 1-3 specialists maximum.

Respond exactly:
ROUTE: multi-agent or direct
AGENTS: comma-separated ids
REASON: one line`,
      },
      { role: 'user', content: message },
    ];

    const response = await this.provider.chat(messages);
    const content = response.text.trim();
    if (/route:\s*direct/i.test(content)) return { route: 'direct', agents: [] };
    const agentsMatch = content.match(/AGENTS:\s*(.+)/i);
    const agents = agentsMatch
      ? agentsMatch[1]
          .split(',')
          .map((a) => a.trim().toLowerCase())
          .filter((id) => id && SPECIALISTS[id] && id !== 'judge')
      : [];
    return agents.length > 0 ? { route: 'multi-agent', agents } : this.fallbackPlan(message);
  }

  private fallbackPlan(message: string): { route: string; agents: string[] } {
    const lower = message.toLowerCase();
    if (/security|vulnerab|exploit|auth|secret/.test(lower))
      return { route: 'multi-agent', agents: ['cybersecurity', 'code-reviewer'] };
    if (/frontend|react|ui|css|component/.test(lower))
      return { route: 'multi-agent', agents: ['frontend', 'ui-designer', 'code-reviewer'] };
    if (/backend|api|database|server|auth/.test(lower))
      return { route: 'multi-agent', agents: ['backend', 'code-reviewer'] };
    if (/research|source|citation|paper|journal|study/.test(lower))
      return { route: 'multi-agent', agents: ['researcher', 'editor'] };
    if (/code|bug|fix|implement|refactor|audit|repo/.test(lower))
      return { route: 'multi-agent', agents: ['web-dev', 'code-reviewer'] };
    return { route: 'direct', agents: [] };
  }

  private async runSpecialist(
    agentId: string,
    specialist: SpecialistDef,
    userMessage: string,
    _index: number,
    options: MultiAgentRunOptions
  ): Promise<string> {
    const { AgentLoop } = await import('./AgentLoop.js');
    const { ToolRegistry } = await import('../tools/Registry.js');
    const subRegistry = new ToolRegistry();
    const allowed = new Set(specialist.tools);
    for (const tool of this.registry.list()) {
      if (allowed.has(tool.name) && tool.name !== 'spawn_agent') subRegistry.register(tool);
    }

    const subConfig = { ...this.config, researchMode: 'low' as const };
    const sub = new AgentLoop(subConfig, subRegistry);
    sub.setMaxIterations(SUBAGENT_MAX_ITERATIONS);
    const prompt = `[MULTI-AGENT SPECIALIST: ${specialist.name}]
${specialist.systemPrompt}

USER REQUEST:
${userMessage}

Return your specialist result only. Use tools when needed; do not claim actions you did not perform.`;

    const chunks: string[] = [];
    options.onEvent?.({ type: 'route', data: `${specialist.name} started`, toolName: agentId });
    try {
      for await (const event of sub.run(prompt)) {
        if (event.type === 'tool_start' || event.type === 'tool_end' || event.type === 'error') {
          options.onEvent?.({ ...event, toolName: event.toolName || agentId });
        }
        if (event.type === 'text' && event.data) chunks.push(event.data);
      }
    } catch (e: any) {
      options.onEvent?.({ type: 'error', data: `${specialist.name} failed: ${e.message}` });
      return `[${specialist.name} failed] ${e.message}`;
    }
    options.onEvent?.({ type: 'route', data: `${specialist.name} finished`, toolName: agentId });
    return chunks.join('\n') || `[${specialist.name}] No output generated.`;
  }

  private async runJudge(userMessage: string, outputs: Record<string, string>): Promise<string> {
    const outputBlocks = Object.entries(outputs)
      .map(([id, out]) => `### ${SPECIALISTS[id]?.name || id}\n${out}`)
      .join('\n\n---\n\n');

    const response = await this.provider.chat([
      { role: 'system', content: SPECIALISTS.judge.systemPrompt },
      {
        role: 'user',
        content: `USER REQUEST: ${userMessage}\n\nSPECIALIST OUTPUTS:\n\n${outputBlocks}\n\nSynthesize these into one final answer. Use only what is supported by the specialist outputs.`,
      },
    ]);
    return response.text;
  }

  isTracingEnabled(): boolean {
    return false;
  }

  getSpecialists(): string[] {
    return Object.values(SPECIALISTS).map((s) => `${s.name} (${s.team})`);
  }

  getTeamMembers(team: 'coding' | 'academic' | 'meta'): string[] {
    return Object.values(SPECIALISTS)
      .filter((s) => s.team === team)
      .map((s) => `${s.name}: ${s.description}`);
  }
}
