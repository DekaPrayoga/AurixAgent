import { BaseAgent, type Claim, type ClaimType } from './types.js';

export class ClaimExtractor extends BaseAgent {
  constructor(provider: any) {
    super(provider, 'ClaimExtractor');
  }

  async extract(findings: string[]) {
    const input = findings.map((f, i) => `${i + 1}. ${f}`).join('\n');
    const result = await this.call(
      `You are a claim classification agent. Classify every claim into one of:

- FACT: Verifiable statement about the world (can be checked against evidence)
- OPINION: Subjective judgment or preference
- ASSUMPTION: Taken for granted without explicit evidence
- PREDICTION: Statement about the future

For each claim, also rate confidence (0-100) based on:
- Source quality
- Specificity (specific numbers > vague statements)
- Consensus (do multiple sources agree?)
- Recency (recent > old for fast-changing topics)

Respond in this exact format per claim:
CLAIM: <text>
TYPE: <FACT/OPINION/ASSUMPTION/PREDICTION>
CONFIDENCE: <0-100>
REASON: <why this classification>
---`,
      `Classify these claims:\n${input}`
    );

    return this.parseClaims(result);
  }

  private parseClaims(text: string): Claim[] {
    const blocks = text.split('---').filter(b => /CLAIM\s*:/i.test(b));
    const sources = blocks.length >= 2 ? blocks : [...text.matchAll(/CLAIM\s*:[\s\S]*?(?=CLAIM\s*:|$)/gi)].map(m => m[0]);

    const claims: Claim[] = [];
    for (const block of sources) {
      const getText = (key: string) => {
        const m = block.match(new RegExp(`${key}:\\s*(.+)`, 'i'));
        return m ? m[1].trim() : '';
      };
      const claimText = getText('CLAIM');
      if (!claimText) continue;
      claims.push({
        text: claimText,
        type: (getText('TYPE') as ClaimType) || 'OPINION',
        confidence: isNaN(parseInt(getText('CONFIDENCE'))) ? 50 : parseInt(getText('CONFIDENCE')),
      });
    }
    return claims;
  }
}
