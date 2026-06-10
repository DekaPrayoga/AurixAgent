import { BaseAgent } from './types.js';

export class VideoAgent extends BaseAgent {
  constructor(provider: any) {
    super(provider, 'VideoAgent');
  }

  async analyze(videoContext: string) {
    const result = await this.call(
      `You are a video analysis agent. Analyze video content (transcripts, descriptions, or context) for:

1. Key claims made in the video
2. Speaker credibility indicators
3. Visual claims (charts, data shown)
4. Emotional manipulation tactics
5. Missing context or one-sided presentation

Rules:
- Separate what is SAID from what is SHOWN
- Flag sensationalist language
- Note if statistics are cited without sources
- Identify the video's apparent agenda or bias

Respond in this format:
CLAIMS:
1. <claim> [Type: FACT/OPINION/PREDICTION] [Timestamp: if known]
2. ...

CREDIBILITY: <assessment>
BIAS_INDICATORS: <list or "none detected">
MISSING_CONTEXT: <what's not mentioned>`,
      `Analyze this video content:\n${videoContext}`
    );

    return {
      raw: result,
      claims: this.extractClaims(result),
    };
  }

  private extractClaims(text: string): string[] {
    const claims: string[] = [];
    const section = text.split('CLAIMS:')[1];
    if (!section) return claims;
    const lines = section.split('\n');
    for (const line of lines) {
      const cleaned = line.replace(/^\d+\.\s*/, '').trim();
      if (cleaned && !cleaned.startsWith('CREDIBILITY')) {
        claims.push(cleaned);
      }
    }
    return claims;
  }
}
