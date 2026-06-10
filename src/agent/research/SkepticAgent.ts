import { BaseAgent, type Claim } from './types.js';

export class SkepticAgent extends BaseAgent {
  constructor(provider: any) {
    super(provider, 'SkepticAgent');
  }

  async attack(claim: Claim, findings: string[]) {
    const result = await this.call(
      `You are the SKEPTIC in a structured debate. Your job is to find weaknesses in this claim.

Attack vectors:
- Contradictions with other evidence
- Weak or unreliable sources
- Logical fallacies
- Selection bias (cherry-picked data)
- Small sample sizes or outdated data
- Conflicts of interest in sources
- Alternative explanations

Rules:
- Be rigorous but fair. Don't manufacture false objections.
- If the claim is well-supported, say so and note only minor concerns.
- Focus on the strongest counter-arguments, not nitpicks.

Structure your response as:
OBJECTIONS:
1. <strongest objection>
2. ...

COUNTER_EVIDENCE:
- <evidence that contradicts or weakens the claim>

FALLACIES:
- <any logical fallacies detected, or "none">

WEAKNESS_LEVEL: <CRITICAL / SIGNIFICANT / MINOR / NONE>`,
      `Claim to challenge: "${claim.text}" (Type: ${claim.type}, Confidence: ${claim.confidence})\n\nAvailable findings:\n${findings.map((f, i) => `${i + 1}. ${f}`).join('\n')}`
    );

    return { raw: result, side: 'skeptic' as const };
  }
}
