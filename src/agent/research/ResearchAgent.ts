import { BaseAgent, type Source } from './types.js';

export class ResearchAgent extends BaseAgent {
  constructor(provider: any) {
    super(provider, 'ResearchAgent');
  }

  async research(query: string, topics: string[]) {
    const result = await this.call(
      `You are a research agent. Your job is to gather knowledge from multiple perspectives.

Rules:
- Search for supporting AND opposing information
- Compare sources for consistency
- Extract specific facts with attribution
- Note where sources disagree
- Rate source reliability (high/medium/low)
- Never invent sources. Only cite what you actually know.

Respond in this format:
FINDINGS:
1. <fact> [Source: <source>, Reliability: <high/medium/low>]
2. ...

DISAGREEMENTS:
- <topic>: Source A says X, Source B says Y

GAPS:
- <what information is missing or uncertain>

SOURCES:
1. <title> | <url if known> | <reliability>`,
      `Research query: ${query}\nKey topics: ${topics.join(', ')}`
    );

    return {
      raw: result,
      findings: this.extractFindings(result),
      sources: this.extractSources(result),
    };
  }

  private extractFindings(text: string): string[] {
    const findings: string[] = [];
    const matches = text.matchAll(/\d+\.\s+(.+?)(?:\[Source:|\n)/g);
    for (const m of matches) {
      findings.push(m[1].trim());
    }
    return findings;
  }

  private extractSources(text: string): Source[] {
    const sources: Source[] = [];
    const section = text.split('SOURCES:')[1];
    if (!section) return sources;
    const lines = section.trim().split('\n');
    for (const line of lines) {
      const parts = line.replace(/^\d+\.\s*/, '').split('|').map(s => s.trim());
      if (parts[0]) {
        sources.push({
          title: parts[0],
          url: parts[1] || undefined,
          snippet: '',
          reliability: (parts[2] as Source['reliability']) || 'unknown',
        });
      }
    }
    return sources;
  }
}
