import { BaseAgent, type ClaimVerdict } from './types.js';

export class LogicCritic extends BaseAgent {
  constructor(provider: any) {
    super(provider, 'LogicCritic');
  }

  async critique(verdicts: ClaimVerdict[], rawOutput: string) {
    const result = await this.call(
      `You are a logic and reasoning critic. Review the research output for:

1. Logical fallacies (strawman, ad hominem, false dichotomy, appeal to authority, etc.)
2. Methodology issues (small sample size, selection bias, survivorship bias)
3. Causal reasoning errors (correlation != causation, post hoc ergo propter hoc)
4. Overgeneralization from limited data
5. Missing alternative explanations
6. Internal contradictions

Rules:
- Only flag genuine problems, not stylistic preferences
- Rate severity: CRITICAL (undermines conclusion) / MODERATE (weakens but doesn't invalidate) / MINOR (worth noting)
- Suggest fixes where possible

Respond:
ISSUES:
1. [CRITICAL/MODERATE/MINOR] <issue description>
   Fix: <suggested improvement>
2. ...

LOGIC_SCORE: <0-100>
SUMMARY: <1-2 sentence overall assessment>`,
      `Review this research output for logical soundness:\n\n${rawOutput.slice(0, 2000)}\n\nVerdicts reached:\n${verdicts.map(v => `- "${v.claim}": ${v.verdict} (confidence: ${v.confidence})`).join('\n')}`
    );

    return {
      raw: result,
      score: this.extractScore(result),
    };
  }

  private extractScore(text: string): number {
    const m = text.match(/LOGIC_SCORE:\s*(\d+)/);
    return m ? parseInt(m[1]) : 50;
  }
}
