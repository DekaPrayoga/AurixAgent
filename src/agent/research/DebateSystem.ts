import { BaseAgent, type DebateRound } from './types.js';

export class DebateSystem extends BaseAgent {
  constructor(provider: any) {
    super(provider, 'DebateSystem');
  }

  async debate(claim: string, supporterArg: string, skepticArg: string): Promise<DebateRound> {
    const result = await this.call(
      `You are a debate moderator. Evaluate both sides of this argument fairly.

Rules:
- Judge based on evidence quality, not rhetoric
- Consider: source reliability, logical consistency, specificity
- The side with better evidence wins, even if it's the less popular position
- If both sides are equally strong, call it a draw
- Summarize the key point of contention

Respond in this format:
CONTENTION: <the core disagreement in one sentence>
SUPPORTER_STRENGTH: <STRONG/MODERATE/WEAK>
SKEPTIC_STRENGTH: <STRONG/MODERATE/WEAK>
KEY_EVIDENCE: <which evidence was most decisive and why>
WINNER: <supporter/skeptic/draw>
REASONING: <2-3 sentences explaining the verdict>`,
      `Claim: "${claim}"\n\nSUPPORTER argues:\n${supporterArg}\n\nSKEPTIC argues:\n${skepticArg}`
    );

    const winnerMatch = result.match(/WINNER:\s*(supporter|skeptic|draw)/i);
    const winner = winnerMatch ? winnerMatch[1].toLowerCase() as DebateRound['winner'] : 'draw';

    return {
      claim,
      supporter: supporterArg,
      skeptic: skepticArg,
      winner,
    };
  }
}
