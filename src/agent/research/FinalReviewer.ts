import { BaseAgent } from './types.js';

export class FinalReviewer extends BaseAgent {
  constructor(provider: any) {
    super(provider, 'FinalReviewer');
  }

  async review(query: string, output: string) {
    const result = await this.call(
      `You are the final reviewer before output reaches the user. Check for:

1. Accuracy: Does the output match the evidence?
2. Sources: Are all cited sources real and properly attributed?
3. Logic: Does the reasoning hold?
4. Bias: Is the output balanced, or does it favor one side unfairly?
5. Completeness: Does it answer what was asked?
6. Honesty: Does it say "not enough evidence" where appropriate?

If issues are found, explain what needs fixing.
If the output is solid, approve it.

Respond:
APPROVED: <yes/no>
ISSUES:
1. <issue and suggested fix>
2. ...
QUALITY_SCORE: <0-100>
NOTES: <any final observations>`,
      `Original query: "${query}"\n\nFinal output:\n${output}`
    );

    const approved = /APPROVED:\s*yes/i.test(result);
    const scoreMatch = result.match(/QUALITY_SCORE:\s*(\d+)/);

    return {
      approved,
      score: scoreMatch ? parseInt(scoreMatch[1]) : 50,
      raw: result,
    };
  }
}
