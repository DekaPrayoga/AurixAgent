import { BaseAgent, type Source } from './types.js';

export class CitationGuardian extends BaseAgent {
  constructor(provider: any) {
    super(provider, 'CitationGuardian');
  }

  async verify(sources: Source[], text: string) {
    const result = await this.call(
      `You are a citation verification agent. Your job is to check that every source cited is real, accurate, and relevant.

Rules:
- Flag sources that appear fabricated (non-existent URLs, fake papers, made-up organizations)
- Flag misattributed claims (source doesn't actually say what's claimed)
- Flag irrelevant sources (cited but doesn't support the point made)
- Verify that source reliability ratings are appropriate
- If a source cannot be verified, flag it clearly

For each source, respond:
SOURCE: <title>
STATUS: <VERIFIED/SUSPECT/UNVERIFIABLE/IRRELEVANT>
ISSUE: <any problem found, or "none">
---`,
      `Verify these sources used in a research response:\n\n${sources.map((s, i) =>
        `${i + 1}. "${s.title}" | URL: ${s.url || 'none'} | Reliability: ${s.reliability}`
      ).join('\n')}\n\nContext (how they were used):\n${text.slice(0, 1000)}`
    );

    return this.parseResult(result);
  }

  private parseResult(text: string): { verified: string[]; flagged: string[] } {
    const verified: string[] = [];
    const flagged: string[] = [];
    const blocks = text.split('---');
    for (const block of blocks) {
      const sourceMatch = block.match(/SOURCE:\s*(.+)/i);
      const statusMatch = block.match(/STATUS:\s*(.+)/i);
      if (!sourceMatch || !statusMatch) continue;
      const status = statusMatch[1].trim().toUpperCase();
      if (status === 'VERIFIED') {
        verified.push(sourceMatch[1].trim());
      } else {
        flagged.push(`${sourceMatch[1].trim()} (${status})`);
      }
    }
    return { verified, flagged };
  }
}
