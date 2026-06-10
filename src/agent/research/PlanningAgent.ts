import { BaseAgent } from './types.js';

export class PlanningAgent extends BaseAgent {
  constructor(provider: any) {
    super(provider, 'PlanningAgent');
  }

  async plan(query: string, analysis: Record<string, any>) {
    const result = await this.call(
      `You are a research planning agent. Break down research queries into structured tasks.

Given an analyzed request, produce a research plan with:
1. Tasks to execute (search, analyze, compare, verify)
2. Order of execution
3. Which specialist agents to involve
4. Expected output structure

Rules:
- Only plan what's needed. Simple questions don't need 10 agents.
- Prioritize source diversity (don't rely on one source).
- Include opposing viewpoint search when the topic is debatable.

Respond in this format:
PLAN:
1. <task> -> <agent> -> <expected output>
2. ...

AGENTS_NEEDED: <comma-separated agent names>
ESTIMATED_STEPS: <number>`,
      `Query: ${query}\n\nAnalysis: ${JSON.stringify(analysis)}`
    );

    return {
      raw: result,
      agents: this.extractAgents(result),
    };
  }

  private extractAgents(text: string): string[] {
    const m = text.match(/AGENTS_NEEDED:\s*(.+)/i);
    if (!m) return [];
    return m[1].split(',').map(s => s.trim()).filter(Boolean);
  }
}
