import type { Provider, Message } from '../../providers/index.js';

export type ResearchDepth = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';

export type ClaimType = 'FACT' | 'OPINION' | 'ASSUMPTION' | 'PREDICTION';
export type Verdict = 'SUPPORTED' | 'PARTIAL' | 'WEAK' | 'UNSOURCED' | 'FALSE';

export interface ResearchContext {
  query: string;
  depth: ResearchDepth;
  findings: string[];
  claims: Claim[];
  sources: Source[];
  debates: DebateRound[];
  verdicts: ClaimVerdict[];
}

export interface Claim {
  text: string;
  type: ClaimType;
  source?: string;
  confidence: number;
}

export interface Source {
  title: string;
  url?: string;
  snippet: string;
  reliability: 'high' | 'medium' | 'low' | 'unknown';
}

export interface DebateRound {
  claim: string;
  supporter: string;
  skeptic: string;
  winner?: 'supporter' | 'skeptic' | 'draw';
}

export interface ClaimVerdict {
  claim: string;
  verdict: Verdict;
  reasoning: string;
  confidence: number;
}

export interface ResearchEvent {
  type: 'agent_start' | 'agent_end' | 'finding' | 'claim' | 'debate' | 'verdict' | 'text' | 'error';
  agent: string;
  data: string;
}

export class BaseAgent {
  constructor(
    protected provider: Provider,
    protected name: string
  ) {}

  protected async call(systemPrompt: string, userMessage: string): Promise<string> {
    const messages: Message[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ];
    const res = await this.provider.chat(messages);
    return res.text;
  }
}
