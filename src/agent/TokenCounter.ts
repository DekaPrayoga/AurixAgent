import { getEncoding, type Tiktoken } from 'js-tiktoken';

type Encoding = 'cl100k_base' | 'o200k_base';

const encCache = new Map<string, Tiktoken>();

function getEnc(name: Encoding): Tiktoken {
  let enc = encCache.get(name);
  if (!enc) {
    enc = getEncoding(name);
    encCache.set(name, enc);
  }
  return enc;
}

function fallbackCount(text: string): number {
  return Math.ceil(text.length / 4);
}

export function countTokens(text: string, encoding?: Encoding): number {
  try {
    return getEnc(encoding || 'cl100k_base').encode(text).length;
  } catch {
    return fallbackCount(text);
  }
}

export function countTokensBatch(texts: string[], encoding?: Encoding): number[] {
  try {
    const enc = getEnc(encoding || 'cl100k_base');
    return texts.map(t => enc.encode(t).length);
  } catch {
    return texts.map(t => fallbackCount(t));
  }
}

const CATEGORIES = [
  'systemPrompt',
  'userInput',
  'agentText',
  'toolCalls',
  'toolResults',
  'skills',
] as const;

const LABELS: Record<string, string> = {
  systemPrompt: 'System prompt',
  userInput: 'User input',
  agentText: 'Agent text',
  toolCalls: 'Tool calls',
  toolResults: 'Tool results',
  skills: 'Skills',
};

type Category = typeof CATEGORIES[number];

export class TokenLedger {
  private counts = new Map<string, number>();
  private _apiInput = 0;
  private _apiOutput = 0;

  constructor() {
    this.reset();
  }

  add(category: Category | string, text: string): number {
    const tokens = countTokens(text);
    this.counts.set(category, (this.counts.get(category) || 0) + tokens);
    return tokens;
  }

  set(category: Category | string, tokens: number): void {
    this.counts.set(category, tokens);
  }

  get(category: Category | string): number {
    return this.counts.get(category) || 0;
  }

  setApiUsage(input: number, output: number): void {
    // Both input and output must be accumulated across the session
    // because every request resends the history (LLMs are stateless)
    this._apiInput += input;
    this._apiOutput += output;
  }

  getApiInput(): number { return this._apiInput; }
  getApiOutput(): number { return this._apiOutput; }

  // Returns current API input for the *last* turn only
  // Used for context window percentage checks
  setLastTurnInput(input: number): void {
    this.counts.set('lastTurnInput', input);
  }
  getLastTurnInput(): number {
    return this.counts.get('lastTurnInput') || 0;
  }

  total(): number {
    let sum = 0;
    for (const v of this.counts.values()) sum += v;
    return sum;
  }

  getAll(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const cat of CATEGORIES) {
      result[cat] = this.counts.get(cat) || 0;
    }
    return result;
  }

  format(contextTotal?: number, contextPct?: number): string {
    const lines: string[] = ['Session Token Ledger:'];
    const all = this.getAll();
    const maxLabel = Math.max(...Object.values(LABELS).map(l => l.length));
    const maxVal = Math.max(...Object.values(all), 1);
    const valWidth = maxVal.toLocaleString().length;

    for (const cat of CATEGORIES) {
      const label = LABELS[cat] || cat;
      const val = all[cat].toLocaleString().padStart(valWidth);
      const suffix = cat === 'systemPrompt' ? ' (cached)' : '';
      lines.push(`  ${label.padEnd(maxLabel)}: ${val}${suffix}`);
    }

    const totalTracked = this.total();
    lines.push(`  ${'─'.repeat(maxLabel + valWidth + 2)}`);
    lines.push(`  ${'Total tracked'.padEnd(maxLabel)}: ${totalTracked.toLocaleString()}`);
    lines.push(`  ${'Total API Input'.padEnd(maxLabel)}: ${this._apiInput.toLocaleString()}`);
    lines.push(`  ${'Total API Output'.padEnd(maxLabel)}: ${this._apiOutput.toLocaleString()}`);

    // Very rough cost estimate based on Claude 3.5 Sonnet (3/M in, 15/M out)
    const cost = (this._apiInput / 1000000 * 3.0) + (this._apiOutput / 1000000 * 15.0);
    lines.push(`  ${'Est. Cost'.padEnd(maxLabel)}: $${cost.toFixed(4)}`);

    if (contextTotal !== undefined) {
      const lastInput = this.getLastTurnInput();
      const pct = contextTotal > 0 ? Math.round((lastInput / contextTotal) * 100) : 0;
      lines.push(`  ${'Context window'.padEnd(maxLabel)}: ${lastInput.toLocaleString()} / ${contextTotal.toLocaleString()} (~${pct}%)`);
    }

    return lines.join('\n');
  }

  reset(): void {
    for (const cat of CATEGORIES) {
      this.counts.set(cat, 0);
    }
    this._apiInput = 0;
    this._apiOutput = 0;
  }
}
