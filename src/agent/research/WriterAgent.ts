import { BaseAgent, type ClaimVerdict, type Source, type ResearchDepth } from './types.js';
import { STRUCTURED_OUTPUT_PROMPT } from '../../utils/StructuredOutputFormat.js';

export class WriterAgent extends BaseAgent {
  constructor(provider: any) {
    super(provider, 'WriterAgent');
  }

  async write(
    query: string,
    verdicts: ClaimVerdict[],
    sources: Source[],
    depth: ResearchDepth,
    format: string
  ) {
    const includeSources = depth !== 'low' && depth !== 'medium';
    const sourceSection = includeSources
      ? `\n\nSOURCES:\n${sources.map((s, i) => `${i + 1}. ${s.title}${s.url ? ` (${s.url})` : ''} [${s.reliability}]`).join('\n')}`
      : '';

    const result = await this.call(
      `You are a research writer. Turn verified findings into a clear, well-structured output.

Rules:
- Write for clarity, not impressiveness
- Clearly label what is confirmed, what is uncertain, and what is opinion
- Include confidence levels inline where relevant
- Never overstate certainty. "The evidence suggests" > "It is proven that"
- Separate FACT from OPINION from PREDICTION explicitly
- Include caveats and limitations
${includeSources ? '- Cite sources inline with [Source N] notation' : ''}

${STRUCTURED_OUTPUT_PROMPT}

Output format: ${format || 'DETAILED'}
- SHORT_ANSWER: 1-3 paragraphs, direct
- DETAILED: Structured sections with headers
- REPORT: Full report with executive summary, findings, analysis, conclusion
- LIST: Bullet-point summary`,
      `Original query: "${query}"\n\nVerified claims and verdicts:\n${verdicts
        .map((v) => `- "${v.claim}": ${v.verdict} (confidence: ${v.confidence}%) — ${v.reasoning}`)
        .join('\n')}${sourceSection}`
    );

    return result;
  }
}
