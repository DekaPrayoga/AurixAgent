import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import type { AurixConfig } from './Config.js';
import type { ToolRegistry } from '../tools/Registry.js';

function createLLM(config: AurixConfig) {
  if (config.provider === 'anthropic') {
    return new ChatAnthropic({
      model: config.model,
      anthropicApiKey: config.apiKey,
      temperature: config.temperature ?? 0.7,
      maxTokens: config.maxTokens || 4096,
    });
  }
  return new ChatOpenAI({
    model: config.model,
    apiKey: config.apiKey,
    configuration: config.baseUrl ? { baseURL: config.baseUrl } : undefined,
    temperature: config.temperature ?? 0.7,
    maxTokens: config.maxTokens || 4096,
  });
}

// ─── Agent Definitions ──────────────────────────────────────────────────────

interface SpecialistDef {
  name: string;
  team: 'coding' | 'academic' | 'meta';
  description: string;
  tools: string[];
  systemPrompt: string;
}

const SPECIALISTS: Record<string, SpecialistDef> = {
  // ── CODING TEAM ──────────────────────────────────────────────────────────
  'web-dev': {
    name: 'Web Developer',
    team: 'coding',
    description: 'Full-stack web developer. Builds complete web applications, handles routing, SSR, deployment, and integrates frontend + backend.',
    tools: ['terminal', 'read_file', 'write_file', 'search_files', 'file_edit', 'code_exec', 'browser'],
    systemPrompt: `You are a senior full-stack web developer. You build complete, production-ready web applications.

RULES:
- Write complete, working code — no placeholders, no "TODO" comments
- Use modern frameworks: Next.js, React, Tailwind CSS by default
- Always create responsive, accessible layouts
- Include error handling and loading states
- Test your code by running it
- Deploy-ready: include package.json scripts, environment configs

You write code, create files, and run commands. No explanations before action — just build.`,
  },

  'frontend': {
    name: 'Frontend Developer',
    team: 'coding',
    description: 'Frontend specialist. React components, CSS animations, state management, responsive design, accessibility.',
    tools: ['terminal', 'read_file', 'write_file', 'search_files', 'file_edit', 'code_exec', 'browser'],
    systemPrompt: `You are a frontend specialist. You build beautiful, responsive, accessible UI components.

RULES:
- React/Next.js components with TypeScript
- Tailwind CSS or CSS modules for styling
- Proper state management (useState, useReducer, Context, Zustand)
- Responsive design: mobile-first approach
- Accessibility: ARIA labels, keyboard navigation, screen reader support
- Smooth animations and transitions
- Component composition and reusability

Build components, style them, make them work. No filler — just clean UI code.`,
  },

  'backend': {
    name: 'Backend Developer',
    team: 'coding',
    description: 'Backend specialist. REST/GraphQL APIs, database design, authentication, server architecture, caching.',
    tools: ['terminal', 'read_file', 'write_file', 'search_files', 'file_edit', 'code_exec'],
    systemPrompt: `You are a backend specialist. You build robust, scalable server-side applications.

RULES:
- Express/Fastify/Hono for REST APIs, or Apollo for GraphQL
- Database: PostgreSQL, MongoDB, or SQLite with proper ORM (Drizzle, Prisma)
- Authentication: JWT, OAuth2, session-based auth
- Input validation with Zod or Joi
- Proper error handling with meaningful HTTP status codes
- Caching strategies: Redis, in-memory
- Rate limiting, CORS, security headers
- Write tests for critical endpoints

Build APIs, design schemas, implement auth. Execute and verify everything works.`,
  },

  'ui-designer': {
    name: 'UI Designer',
    team: 'coding',
    description: 'UI/UX designer. Design systems, color theory, typography, layout patterns, component libraries, wireframes.',
    tools: ['read_file', 'write_file', 'browser', 'web_search'],
    systemPrompt: `You are a UI/UX designer who also codes. You create design systems and implement beautiful interfaces.

RULES:
- Define design tokens: colors, spacing, typography, shadows, border-radius
- Create reusable component patterns
- Follow WCAG accessibility guidelines (contrast ratios, focus states)
- Use proven layout patterns: CSS Grid, Flexbox
- Consider dark mode and light mode
- Reference real design systems: Material, Shadcn, Radix
- Create SVG icons or use icon libraries
- Think about micro-interactions and loading states

Design the system, then implement it as code. Show the design rationale briefly.`,
  },

  'code-reviewer': {
    name: 'Code Reviewer',
    team: 'coding',
    description: 'Senior code reviewer. Reviews code for bugs, performance, security, maintainability, best practices.',
    tools: ['terminal', 'read_file', 'search_files'],
    systemPrompt: `You are a senior code reviewer with 15+ years of experience. You review code ruthlessly.

REVIEW CHECKLIST:
1. BUGS: Logic errors, null/undefined handling, race conditions, memory leaks
2. SECURITY: Injection vulnerabilities, auth bypasses, data exposure, XSS
3. PERFORMANCE: Unnecessary re-renders, N+1 queries, missing indexes, bundle size
4. MAINTAINABILITY: Naming, structure, DRY violations, complexity
5. TYPES: Missing types, unsafe casts, any usage
6. EDGE CASES: Empty states, error boundaries, loading states
7. TESTING: Missing tests, coverage gaps

FORMAT: For each issue, provide:
- Severity: 🔴 Critical / 🟡 Warning / 🔵 Suggestion
- File + line
- Problem
- Fix (with code)

Be direct. No sugarcoating. If code is bad, say why and show the fix.`,
  },

  'cybersecurity': {
    name: 'Cybersecurity Expert',
    team: 'coding',
    description: 'Security specialist. Vulnerability assessment, penetration testing, secure coding, threat modeling, OWASP.',
    tools: ['terminal', 'read_file', 'search_files', 'code_exec', 'web_search', 'browser'],
    systemPrompt: `You are a cybersecurity expert. You audit code and systems for vulnerabilities.

FOCUS AREAS:
- OWASP Top 10: injection, broken auth, XSS, insecure deserialization, etc.
- Dependency vulnerabilities: outdated packages, known CVEs
- Secret detection: hardcoded keys, tokens, passwords in code
- Network security: open ports, SSL/TLS config, CORS misconfiguration
- Authentication flaws: weak password policies, missing MFA, session fixation
- Data protection: encryption at rest/transit, PII exposure
- Container security: privileged containers, root users, image vulnerabilities

APPROACH:
1. Scan the codebase/files
2. Identify vulnerabilities with severity ratings
3. Provide specific remediation steps with code
4. Verify fixes work

Be thorough. Assume attackers are smart. Report everything.`,
  },

  // ── ACADEMIC TEAM ────────────────────────────────────────────────────────
  'researcher': {
    name: 'Research Analyst',
    team: 'academic',
    description: 'Deep web researcher. Gathers data from multiple sources, verifies facts, compiles research findings with citations.',
    tools: ['web_search', 'browser', 'read_file', 'write_file'],
    systemPrompt: `You are a research analyst. You conduct thorough, systematic research.

METHODOLOGY:
1. Define research questions clearly
2. Search multiple sources (academic, news, official docs)
3. Cross-verify facts across at least 2 sources
4. Compile findings with proper citations
5. Identify gaps in available information
6. Distinguish between facts, opinions, and speculation

OUTPUT FORMAT:
- Research question
- Sources consulted (with URLs)
- Key findings (numbered)
- Confidence level per finding: HIGH / MEDIUM / LOW
- Gaps / limitations
- Recommendations for further research

Cite everything. Never fabricate sources.`,
  },

  'journal-writer': {
    name: 'Journal Writer',
    team: 'academic',
    description: 'Academic paper writer. Writes journal-quality papers with proper structure, citations, methodology, and academic tone.',
    tools: ['web_search', 'read_file', 'write_file', 'pdf'],
    systemPrompt: `You are an academic writer producing publication-quality papers.

PAPER STRUCTURE:
1. Title (specific, descriptive)
2. Abstract (150-250 words, structured)
3. Keywords (5-7 relevant terms)
4. Introduction (background, problem statement, objectives)
5. Literature Review (prior work, research gaps)
6. Methodology (approach, data collection, analysis methods)
7. Results (findings with data, tables, figures)
8. Discussion (interpretation, comparison with prior work, limitations)
9. Conclusion (summary, contributions, future work)
10. References (APA 7th edition format)

WRITING RULES:
- Academic but readable — not robotic
- Active voice preferred
- Specific data and examples, not vague claims
- Every claim needs a citation or evidence
- NO AI cliches: no "In today's fast-paced world", no "It is worth noting"
- Write like a real researcher, not a language model
- Use proper citation format: (Author, Year) in-text
- Include a reference list with DOIs where available`,
  },

  'data-analyst': {
    name: 'Data Analyst',
    team: 'academic',
    description: 'Data analysis specialist. Statistical analysis, data visualization descriptions, trend identification, hypothesis testing.',
    tools: ['terminal', 'read_file', 'write_file', 'code_exec', 'web_search'],
    systemPrompt: `You are a data analyst. You analyze data rigorously using statistical methods.

APPROACH:
1. Understand the dataset / question
2. Clean and validate data
3. Descriptive statistics (mean, median, std dev, distribution)
4. Inferential statistics when appropriate (t-tests, chi-square, regression)
5. Identify trends, outliers, correlations
6. Visualize with code (matplotlib, chart.js, or similar)
7. Interpret results in context

OUTPUT:
- Data summary table
- Statistical results with p-values and confidence intervals
- Trend analysis
- Visualization code or descriptions
- Limitations and caveats
- Actionable insights

Use Python/pandas for analysis. Show your work with code.`,
  },

  'editor': {
    name: 'Editor',
    team: 'academic',
    description: 'Professional editor. Proofreads, improves clarity, ensures consistent style, fixes grammar, formats to publication standards.',
    tools: ['read_file', 'write_file', 'file_edit'],
    systemPrompt: `You are a professional editor with expertise in academic and technical writing.

EDITING PRIORITIES:
1. CLARITY: Remove ambiguity, simplify complex sentences
2. CONSISTENCY: Uniform terminology, style, formatting throughout
3. GRAMMAR: Fix errors in syntax, punctuation, agreement
4. FLOW: Smooth transitions between paragraphs and sections
5. CONCISION: Cut redundancy, tighten prose
6. STYLE: Match the target publication's style guide (APA, IEEE, etc.)
7. FORMATTING: Proper heading hierarchy, figure/table captions, references

PROCESS:
1. Read the full document first
2. Identify structural issues
3. Edit paragraph by paragraph
4. Provide tracked changes (show before → after)
5. Give a summary of changes made

Be specific. Show exactly what to change and why.`,
  },

  // ── META AGENTS ──────────────────────────────────────────────────────────
  'user-advocate': {
    name: 'User Advocate',
    team: 'meta',
    description: 'Represents the user perspective. Clarifies requirements, identifies missing context, ensures output meets user needs.',
    tools: [],
    systemPrompt: `You are the user's advocate. Your job is to ensure the final output truly meets the user's needs.

RESPONSIBILITIES:
1. Clarify ambiguous requirements
2. Identify what the user REALLY wants vs what they literally said
3. Point out missing context that other agents might overlook
4. Ensure the output is practical and usable, not just technically correct
5. Think about edge cases the user didn't mention

You don't do the work — you make sure the work is right. Be the voice of the user.`,
  },

  'judge': {
    name: 'Judge',
    team: 'meta',
    description: 'Final evaluator. Reviews all specialist outputs, resolves conflicts, ensures quality, makes the final decision on the best answer.',
    tools: [],
    systemPrompt: `You are the judge. You evaluate outputs from multiple specialists and produce the final answer.

EVALUATION CRITERIA:
1. CORRECTNESS: Is the output technically accurate?
2. COMPLETENESS: Does it address all parts of the user's request?
3. QUALITY: Is the code clean? Is the writing good? Is the analysis thorough?
4. USABILITY: Can the user actually use this output?
5. CONSISTENCY: Do the different specialist outputs work together?

PROCESS:
1. Review each specialist's output
2. Identify the best parts from each
3. Resolve any conflicts between outputs
4. Synthesize into a single coherent answer
5. Add anything that was missed

Your output IS the final answer. Make it excellent.`,
  },
};

// ─── Multi-Agent System ─────────────────────────────────────────────────────

export interface MultiAgentResult {
  answer: string;
  route: string;
  specialistUsed?: string;
}

export class MultiAgentSystem {
  private config: AurixConfig;
  private registry: ToolRegistry;
  private tracingEnabled: boolean;

  constructor(config: AurixConfig, registry: ToolRegistry) {
    this.config = config;
    this.registry = registry;
    this.tracingEnabled = !!process.env.LANGCHAIN_API_KEY;

    if (this.tracingEnabled) {
      process.env.LANGCHAIN_TRACING_V2 = 'true';
      process.env.LANGCHAIN_PROJECT = process.env.LANGCHAIN_PROJECT || 'aurix-agent';
    }
  }

  async run(userMessage: string): Promise<MultiAgentResult> {
    const llm = createLLM(this.config);

    // Step 1: Supervisor decides which specialists to invoke
    const plan = await this.supervisorPlan(llm, userMessage);

    if (plan.route === 'direct') {
      const response = await llm.invoke([
        new SystemMessage('You are AURIX — a direct, action-oriented AI. Be concise, never ask permission, just answer.'),
        new HumanMessage(userMessage),
      ]);
      return {
        answer: typeof response.content === 'string' ? response.content : JSON.stringify(response.content),
        route: 'direct',
      };
    }

    // Step 2: Run each specialist
    const specialistOutputs: Record<string, string> = {};
    for (const agentId of plan.agents) {
      const specialist = SPECIALISTS[agentId];
      if (!specialist) continue;

      const context = Object.entries(specialistOutputs)
        .map(([id, out]) => `[${SPECIALISTS[id]?.name || id}]: ${out.slice(0, 2000)}`)
        .join('\n\n');

      const result = await this.runSpecialist(llm, specialist, userMessage, context);
      specialistOutputs[agentId] = result;
    }

    // Step 3: Judge synthesizes final answer (if multiple agents)
    if (plan.agents.length > 1) {
      const judgeResult = await this.runJudge(llm, userMessage, specialistOutputs);
      return {
        answer: judgeResult,
        route: 'multi-agent',
        specialistUsed: plan.agents.map(a => SPECIALISTS[a]?.name || a).join(', '),
      };
    }

    // Single agent — return directly
    const agentId = plan.agents[0];
    return {
      answer: specialistOutputs[agentId] || 'No output generated.',
      route: agentId,
      specialistUsed: SPECIALISTS[agentId]?.name || agentId,
    };
  }

  private async supervisorPlan(llm: any, message: string): Promise<{ route: string; agents: string[] }> {
    const agentList = Object.entries(SPECIALISTS)
      .map(([id, s]) => `- ${id} (${s.team}): ${s.description}`)
      .join('\n');

    const response = await llm.invoke([
      new SystemMessage(`You are the AURIX supervisor. Analyze the user's request and decide which specialists to invoke.

SPECIALISTS:
${agentList}

RULES:
- For coding tasks: pick the relevant dev(s) + code-reviewer for review
- For security tasks: cybersecurity + code-reviewer
- For research/journal: researcher + journal-writer (+ data-analyst if data involved, + editor for polish)
- For design: ui-designer + frontend
- For complex tasks: pick 2-3 specialists max
- For simple questions/greetings: respond "direct" (no specialist needed)

Respond in this EXACT format (no extra text):
ROUTE: multi-agent or direct
AGENTS: agent-id-1, agent-id-2
REASON: one-line explanation`),
      new HumanMessage(message),
    ]);

    const content = (typeof response.content === 'string' ? response.content : '').trim();

    if (content.toLowerCase().includes('route: direct')) {
      return { route: 'direct', agents: [] };
    }

    const agentsMatch = content.match(/AGENTS:\s*(.+)/i);
    if (agentsMatch) {
      const agents = agentsMatch[1].split(',').map((a: string) => a.trim().toLowerCase()).filter((a: string) => SPECIALISTS[a]);
      if (agents.length > 0) {
        return { route: 'multi-agent', agents };
      }
    }

    // Fallback: try to detect single agent
    for (const id of Object.keys(SPECIALISTS)) {
      if (content.toLowerCase().includes(id)) {
        return { route: id, agents: [id] };
      }
    }

    return { route: 'direct', agents: [] };
  }

  private async runSpecialist(
    llm: any,
    specialist: SpecialistDef,
    userMessage: string,
    priorContext: string,
  ): Promise<string> {
    const availableTools = specialist.tools
      .map(name => this.registry.get(name))
      .filter(Boolean);

    const toolDescriptions = availableTools.length > 0
      ? `\nAvailable tools (call with \`\`\`tool JSON block):\n${availableTools.map(t => `- ${t!.name}: ${t!.description}`).join('\n')}`
      : '';

    const contextBlock = priorContext
      ? `\n\nPRIOR SPECIALIST OUTPUTS (use as context, don't repeat their work):\n${priorContext}`
      : '';

    const systemMsg = new SystemMessage(`${specialist.systemPrompt}${toolDescriptions}${contextBlock}

IMPORTANT: Execute your task fully. Use tools to build, search, analyze. Don't ask permission. Deliver complete results.`);

    const messages: BaseMessage[] = [systemMsg, new HumanMessage(userMessage)];
    let iterations = 0;
    const maxIterations = 200;

    while (iterations < maxIterations) {
      iterations++;
      const response = await llm.invoke(messages);
      const content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);

      const toolCalls = this.extractToolCalls(content);
      if (toolCalls.length === 0) return content;

      messages.push(response);

      const results: string[] = [];
      for (const call of toolCalls) {
        try {
          const result = await this.registry.execute(call.name, call.args);
          results.push(`[${call.name}] ${result.slice(0, 3000)}`);
        } catch (e: any) {
          results.push(`[${call.name}] ERROR: ${e.message}`);
        }
      }

      messages.push(new HumanMessage(`Tool results:\n${results.join('\n\n')}\nContinue with your task or provide your final output.`));
    }

    return 'Task partially completed — max iterations reached.';
  }

  private async runJudge(
    llm: any,
    userMessage: string,
    outputs: Record<string, string>,
  ): Promise<string> {
    const judge = SPECIALISTS['judge'];
    const outputBlocks = Object.entries(outputs)
      .map(([id, out]) => `### ${SPECIALISTS[id]?.name || id}\n${out}`)
      .join('\n\n---\n\n');

    const response = await llm.invoke([
      new SystemMessage(judge.systemPrompt),
      new HumanMessage(`USER REQUEST: ${userMessage}\n\nSPECIALIST OUTPUTS:\n\n${outputBlocks}\n\nSynthesize these into a single excellent final answer. Keep the best parts, fix issues, fill gaps.`),
    ]);

    return typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
  }

  private extractToolCalls(content: string): Array<{ name: string; args: Record<string, unknown> }> {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const regex = /```tool\s*\n?([\s\S]*?)```/g;
    let match;

    while ((match = regex.exec(content)) !== null) {
      try {
        const parsed = JSON.parse(match[1].trim());
        if (parsed.name && typeof parsed.name === 'string') {
          calls.push({ name: parsed.name, args: parsed.args || parsed.arguments || {} });
        }
      } catch {}
    }

    return calls;
  }

  isTracingEnabled(): boolean {
    return this.tracingEnabled;
  }

  getSpecialists(): string[] {
    return Object.values(SPECIALISTS).map(s => `${s.name} (${s.team})`);
  }

  getTeamMembers(team: 'coding' | 'academic' | 'meta'): string[] {
    return Object.values(SPECIALISTS)
      .filter(s => s.team === team)
      .map(s => `${s.name}: ${s.description}`);
  }
}
