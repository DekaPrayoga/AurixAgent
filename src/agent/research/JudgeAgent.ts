import { BaseAgent, type ClaimVerdict, type Verdict, type DebateRound } from './types.js';

export class JudgeAgent extends BaseAgent {
  constructor(provider: any) {
    super(provider, 'JudgeAgent');
  }

  async judge(claim: string, debate: DebateRound, findings: string[]) {
    const result = await this.call(
      `You are a judge agent. Issue a final verdict on this claim based on all evidence and debate.

Verdicts:
- SUPPORTED: Strong evidence, multiple reliable sources, survives criticism
- PARTIAL: Some evidence supports it, but significant gaps or caveats exist
- WEAK: Limited or low-quality evidence, doesn't survive scrutiny well
- UNSOURCED: No reliable evidence found either way
- FALSE: Evidence actively contradicts the claim

Rules:
- Confidence matters more than sounding definitive
- "Not enough evidence" is a valid and honest verdict
- Consider the debate outcome but make your own assessment

Respond in this format:
VERDICT: <SUPPORTED/PARTIAL/WEAK/UNSOURCED/FALSE>
CONFIDENCE: <0-100>
REASONING: <2-4 sentences explaining the verdict>
CAVEATS: <any important limitations or areas needing more research>`,
      `Claim: "${claim}"\n\nDebate winner: ${debate.winner}\nSupporter: ${debate.supporter.slice(0, 500)}\nSkeptic: ${debate.skeptic.slice(0, 500)}\n\nFindings:\n${findings.slice(0, 10).map((f, i) => `${i + 1}. ${f}`).join('\n')}`
    );

    return this.parseVerdict(claim, result);
  }

  private parseVerdict(claim: string, text: string): ClaimVerdict {
    const verdictMatch = text.match(/VERDICT:\s*(SUPPORTED|PARTIAL|WEAK|UNSOURCED|FALSE)/i);
    const confidenceMatch = text.match(/CONFIDENCE:\s*(\d+)/);
    const reasoningMatch = text.match(/REASONING:\s*([\s\S]+?)(?=CAVEATS:|$)/);

    return {
      claim,
      verdict: (verdictMatch?.[1]?.toUpperCase() as Verdict) || 'UNSOURCED',
      confidence: parseInt(confidenceMatch?.[1] || '50'),
      reasoning: reasoningMatch?.[1]?.trim() || 'No reasoning provided.',
    };
  }
}
