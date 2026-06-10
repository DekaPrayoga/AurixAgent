import { BaseAgent } from './types.js';

export class RequestAnalyzer extends BaseAgent {
  constructor(provider: any) {
    super(provider, 'RequestAnalyzer');
  }

  async analyze(query: string) {
    const result = await this.call(
      `You are a request analysis agent. Analyze user queries to determine:
1. Intent type: QUESTION / TASK / RESEARCH / CREATIVE / CODE / CONVERSATION
2. Required depth: low / medium / high
3. Output format: SHORT_ANSWER / DETAILED / REPORT / CODE / LIST
4. Whether citations are needed: yes / no
5. Key topics and entities

Respond in this exact format:
INTENT: <type>
DEPTH: <level>
FORMAT: <format>
CITATIONS: <yes/no>
TOPICS: <comma-separated list>
COMPLEXITY: <1-10>`,
      `Analyze this request: ${query}`
    );

    return this.parse(result);
  }

  private parse(text: string) {
    const get = (key: string) => {
      const m = text.match(new RegExp(`${key}:\\s*(.+)`, 'i'));
      return m ? m[1].trim() : '';
    };
    return {
      intent: get('INTENT'),
      depth: get('DEPTH'),
      format: get('FORMAT'),
      citations: get('CITATIONS').toLowerCase() === 'yes',
      topics: get('TOPICS').split(',').map(s => s.trim()).filter(Boolean),
      complexity: parseInt(get('COMPLEXITY')) || 5,
    };
  }
}
