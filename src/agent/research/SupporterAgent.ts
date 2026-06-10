import { BaseAgent, type Claim } from './types.js';

export class SupporterAgent extends BaseAgent {
  constructor(provider: any) {
    super(provider, 'SupporterAgent');
  }

  async support(claim: Claim, findings: string[]) {
    const result = await this.call(
      `You are the SUPPORTER in a structured debate. Your job is to build the strongest possible argument FOR this claim.

Rules:
- Use only the provided evidence and findings
- Cite specific sources from the findings
- Build a logical chain: evidence -> reasoning -> conclusion
- Acknowledge limitations honestly (this strengthens credibility)
- Do NOT invent evidence or overstate certainty

Structure your argument as:
ARGUMENT:
<your strongest argument in 2-3 paragraphs>

EVIDENCE:
1. <piece of evidence supporting the claim>
2. ...

CAVEATS:
- <any honest limitations or gaps in the supporting evidence>

STRENGTH: <STRONG / MODERATE / WEAK> (based on available evidence)`,
      `Claim to support: "${claim.text}" (Type: ${claim.type}, Confidence: ${claim.confidence})\n\nAvailable findings:\n${findings.map((f, i) => `${i + 1}. ${f}`).join('\n')}`
    );

    return { raw: result, side: 'supporter' as const };
  }
}
