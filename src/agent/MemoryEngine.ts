import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import type { Message } from '../providers/index.js';
import type { Provider } from '../providers/index.js';
import { countTokens } from './TokenCounter.js';

function generateUUID(): string {
  return crypto.randomUUID();
}

const MEMORIES_DIR = path.join(os.homedir(), '.aurix', 'memories');
const SUMMARY_FILE = path.join(MEMORIES_DIR, 'memory_summary.md');
const RAW_FILE = path.join(MEMORIES_DIR, 'raw_memories.md');
const MEMORY_FILE = path.join(MEMORIES_DIR, 'MEMORY.md');
const SESSIONS_DIR = path.join(MEMORIES_DIR, 'sessions');

const CREDENTIAL_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/g,
  /ghp_[a-zA-Z0-9]{36}/g,
  /xox[bpas]-[a-zA-Z0-9-]+/g,
  /AKIA[A-Z0-9]{16}/g,
  /-----BEGIN.*PRIVATE KEY-----[\s\S]*?-----END.*PRIVATE KEY-----/g,
  /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g,
];

const MAX_SUMMARY_TOKENS = 2000;
const PURGE_DAYS = 30;

function ensureDirs(): void {
  for (const dir of [MEMORIES_DIR, SESSIONS_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

function stripCredentials(text: string): string {
  let cleaned = text;
  for (const pattern of CREDENTIAL_PATTERNS) {
    cleaned = cleaned.replace(pattern, '[REDACTED]');
  }
  return cleaned;
}

function estimateTokens(text: string): number {
  return countTokens(text);
}

function trimToTokenBudget(text: string, maxTokens: number): string {
  const tokens = estimateTokens(text);
  if (tokens <= maxTokens) return text;

  const lines = text.split('\n');
  let result = '';
  let currentTokens = 0;

  for (const line of lines) {
    const lineTokens = countTokens(line);
    if (currentTokens + lineTokens > maxTokens) break;
    result += line + '\n';
    currentTokens += lineTokens;
  }

  if (currentTokens === 0 && lines.length > 0) {
    result = lines[0];
  }

  return result + '\n[... trimmed to fit context window]';
}

export class MemoryEngine {
  constructor(private provider?: Provider) {}

  loadSummary(): string {
    ensureDirs();
    if (!fs.existsSync(SUMMARY_FILE)) return '';
    const content = fs.readFileSync(SUMMARY_FILE, 'utf-8');
    return trimToTokenBudget(content, MAX_SUMMARY_TOKENS);
  }

  loadFullMemory(): string {
    ensureDirs();
    if (!fs.existsSync(MEMORY_FILE)) return '';
    return fs.readFileSync(MEMORY_FILE, 'utf-8');
  }

  appendRaw(content: string): void {
    ensureDirs();
    const cleaned = stripCredentials(content);
    const timestamp = new Date().toISOString();
    const entry = `\n## ${timestamp}\n${cleaned}\n`;

    let existing = '';
    if (fs.existsSync(RAW_FILE)) {
      existing = fs.readFileSync(RAW_FILE, 'utf-8');
    }
    fs.writeFileSync(RAW_FILE, existing + entry);
  }

  saveSession(messages: Message[], sessionId?: string): string {
    ensureDirs();
    const id = sessionId || generateUUID();
    const sessionFile = path.join(SESSIONS_DIR, `${id}.json`);

    const serializable = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role,
        content: stripCredentials(m.content),
        toolCallId: m.toolCallId,
        toolCalls: m.toolCalls,
      }));

    fs.writeFileSync(sessionFile, JSON.stringify({ id, savedAt: new Date().toISOString(), messages: serializable }, null, 2));

    const facts = this.extractNotableFacts(messages);
    if (facts.length > 0) {
      const memoryFile = path.join(SESSIONS_DIR, `${id}.memory.json`);
      fs.writeFileSync(memoryFile, JSON.stringify({ sessionId: id, updatedAt: new Date().toISOString(), facts }, null, 2));
    }

    return id;
  }

  listSessions(): { id: string; savedAt: string; messageCount: number; preview: string }[] {
    try {
      ensureDirs();
      const files = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json') && !f.endsWith('.memory.json'));
      const out: { id: string; savedAt: string; messageCount: number; preview: string }[] = [];
      for (const file of files) {
        try {
          const raw = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, file), 'utf-8'));
          const msgs: any[] = Array.isArray(raw.messages) ? raw.messages : [];
          const firstUser = msgs.find(m => m.role === 'user');
          out.push({
            id: raw.id || file.replace(/\.json$/, ''),
            savedAt: raw.savedAt || '',
            messageCount: msgs.length,
            preview: (firstUser?.content || '(empty)').replace(/\n+/g, ' ').slice(0, 50),
          });
        } catch {}
      }
      return out.sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
    } catch {
      return [];
    }
  }

  loadSession(sessionId: string): Message[] {
    ensureDirs();

    const findFile = (ext: string): string | null => {
      const exact = path.join(SESSIONS_DIR, `${sessionId}.${ext}`);
      if (fs.existsSync(exact)) return exact;

      const files = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith(`.${ext}`));
      for (const f of files) {
        const fp = path.join(SESSIONS_DIR, f);
        const basename = path.basename(f, `.${ext}`);
        if (basename.toLowerCase().includes(sessionId.toLowerCase())) return fp;
      }
      return null;
    };

    // Try JSON format first
    const jsonFile = findFile('json');
    if (jsonFile) {
      try {
        const data = JSON.parse(fs.readFileSync(jsonFile, 'utf-8'));
        if (Array.isArray(data.messages)) {
          return data.messages.map((m: any) => ({
            role: m.role as Message['role'],
            content: m.content || '',
            toolCallId: m.toolCallId,
            toolCalls: m.toolCalls,
          }));
        }
      } catch {}
    }

    // Fall back to old markdown format
    const mdFile = findFile('md');
    if (mdFile) {
      const content = fs.readFileSync(mdFile, 'utf-8');
      const messages: Message[] = [];
      const lineBlocks = content.split(/\n\n+/).slice(1);

      for (const block of lineBlocks) {
        const match = block.match(/^\*\*\[(user|assistant|tool)\]\*\*\s*([\s\S]*)$/);
        if (match) {
          messages.push({ role: match[1] as Message['role'], content: match[2] });
        }
      }
      return messages;
    }

    return [];
  }

  extractNotableFacts(messages: Message[]): string[] {
    const facts: string[] = [];

    for (const msg of messages) {
      if (msg.role === 'user') {
        const lower = msg.content.toLowerCase();
        if (/^(i am|i'm|my name is|call me|prefer|always|never|i like|i use|i work)/i.test(lower)) {
          facts.push(`[preference] ${stripCredentials(msg.content.slice(0, 300))}`);
        }
        if (/remember|keep in mind|note that/i.test(lower)) {
          facts.push(`[instruction] ${stripCredentials(msg.content.slice(0, 300))}`);
        }
        if (/jangan|don't|ga usah|gausa|stop doing|wrong|salah|bukan gitu/i.test(lower)) {
          facts.push(`[correction] ${stripCredentials(msg.content.slice(0, 300))}`);
        }
        if (/pake|gunakan|use .* instead|better to|lebih baik/i.test(lower)) {
          facts.push(`[preference] ${stripCredentials(msg.content.slice(0, 300))}`);
        }
      }

      if (msg.role === 'tool' && msg.content) {
        const content = msg.content;
        if (content.includes('Error:') || content.includes('error TS')) {
          const errorLine = content.split('\n').find(l => l.includes('Error')) || '';
          if (errorLine.length > 10) {
            facts.push(`[error-pattern] ${stripCredentials(errorLine.slice(0, 200))}`);
          }
        }
        if (content.includes('Build successful') || content.includes('exit: 0') || content.includes('All tests passed')) {
          facts.push(`[build-success] ${stripCredentials(content.slice(0, 150))}`);
        }
      }

      if (msg.role === 'assistant' && msg.content) {
        const lower = msg.content.toLowerCase();
        if (lower.includes('the fix is') || lower.includes('the solution') || lower.includes('resolved by')) {
          const sentence = msg.content.split(/[.!]\s/).find(s => /fix|solution|resolved/i.test(s)) || '';
          if (sentence.length > 20) {
            facts.push(`[fix] ${stripCredentials(sentence.slice(0, 300))}`);
          }
        }
        if (msg.toolCalls?.length) {
          for (const tc of msg.toolCalls) {
            if (tc.name === 'file_edit' || tc.name === 'write_file') {
              const fp = (tc.arguments.file_path || tc.arguments.path || '') as string;
              if (fp) facts.push(`[file-edited] ${fp}`);
            }
          }
        }
      }
    }

    const seen = new Set<string>();
    return facts.filter(f => {
      const key = f.slice(0, 80);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  extractSessionLearnings(messages: Message[]): string {
    const entries: string[] = [];
    const filesEdited: string[] = [];
    const errorsEncountered: string[] = [];
    const toolsUsed = new Set<string>();

    for (const msg of messages) {
      if (msg.role === 'assistant' && msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          toolsUsed.add(tc.name);
          if ((tc.name === 'file_edit' || tc.name === 'write_file') && (tc.arguments.file_path || tc.arguments.path)) {
            filesEdited.push(String(tc.arguments.file_path || tc.arguments.path));
          }
        }
      }
      if (msg.role === 'tool' && msg.content && (msg.content.includes('Error') || msg.content.includes('error'))) {
        const firstLine = msg.content.split('\n')[0]?.slice(0, 150) || '';
        if (firstLine && !errorsEncountered.includes(firstLine)) {
          errorsEncountered.push(firstLine);
        }
      }
    }

    if (toolsUsed.size > 0) {
      entries.push(`Tools used: ${[...toolsUsed].join(', ')}`);
    }
    if (filesEdited.length > 0) {
      const unique = [...new Set(filesEdited)].slice(0, 10);
      entries.push(`Files modified: ${unique.join(', ')}`);
    }
    if (errorsEncountered.length > 0) {
      entries.push(`Errors encountered:\n${errorsEncountered.slice(0, 5).map(e => `  - ${e}`).join('\n')}`);
    }

    const facts = this.extractNotableFacts(messages);
    if (facts.length > 0) {
      entries.push(`Learned:\n${facts.slice(0, 10).map(f => `  - ${f}`).join('\n')}`);
    }

    return entries.join('\n');
  }

  async consolidate(): Promise<void> {
    ensureDirs();
    if (!fs.existsSync(RAW_FILE)) return;

    const raw = fs.readFileSync(RAW_FILE, 'utf-8');
    if (raw.trim().length < 100) return;

    if (!this.provider) {
      fs.writeFileSync(SUMMARY_FILE, raw.slice(0, MAX_SUMMARY_TOKENS * 4));
      return;
    }

    try {
      const res = await this.provider.chat([
        {
          role: 'system',
          content: `You are a memory consolidation agent. Extract notable facts, preferences, decisions, and context from conversation logs.

Rules:
- Strip any credentials, API keys, or tokens
- Keep: user preferences, project context, technical decisions, learned facts
- Remove: trivial exchanges, repeated information, debugging noise
- Format as concise bullet points grouped by category
- Be brief — this summary replaces full conversation history`,
        },
        { role: 'user', content: raw.slice(0, 12000) },
      ]);

      const summary = `# Memory Summary\nLast updated: ${new Date().toISOString()}\n\n${res.text}`;
      fs.writeFileSync(SUMMARY_FILE, summary);
    } catch {
      fs.writeFileSync(SUMMARY_FILE, raw.slice(0, MAX_SUMMARY_TOKENS * 4));
    }
  }

  async mergeMemories(): Promise<void> {
    ensureDirs();

    const parts: string[] = [];

    if (fs.existsSync(SUMMARY_FILE)) {
      parts.push(fs.readFileSync(SUMMARY_FILE, 'utf-8'));
    }

    const sessionFiles = fs.readdirSync(SESSIONS_DIR)
      .filter(f => f.endsWith('.md') || f.endsWith('.json'))
      .sort()
      .slice(-10);

    for (const file of sessionFiles) {
      const content = fs.readFileSync(path.join(SESSIONS_DIR, file), 'utf-8');
      if (file.endsWith('.json')) {
        try {
          const parsed = JSON.parse(content);
          const msgs = (parsed.messages || []).map((m: any) => m.content || '').join('\n');
          parts.push(msgs.slice(0, 1000));
        } catch {
          parts.push(content.slice(0, 1000));
        }
      } else {
        parts.push(content.slice(0, 1000));
      }
    }

    const merged = stripCredentials(parts.join('\n\n---\n\n'));
    fs.writeFileSync(MEMORY_FILE, merged);
  }

  purgeOldSessions(): void {
    ensureDirs();
    const cutoff = Date.now() - PURGE_DAYS * 24 * 60 * 60 * 1000;
    const files = fs.readdirSync(SESSIONS_DIR);

    for (const file of files) {
      if (!file.endsWith('.md') && !file.endsWith('.json')) continue;
      const filePath = path.join(SESSIONS_DIR, file);
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(filePath);
      }
    }
  }

  searchMemory(query: string): string {
    ensureDirs();
    if (!fs.existsSync(MEMORY_FILE)) return '';

    const content = fs.readFileSync(MEMORY_FILE, 'utf-8');
    const lines = content.split('\n');
    const queryLower = query.toLowerCase();

    const matches = lines.filter(line =>
      line.toLowerCase().includes(queryLower)
    );

    if (matches.length === 0) return '';
    return matches.slice(0, 20).join('\n');
  }

  getStats(): { summarySize: number; rawSize: number; memorySize: number; sessionCount: number } {
    ensureDirs();
    const readSize = (f: string) => {
      try { return fs.statSync(f).size; } catch { return 0; }
    };

    const sessionCount = fs.existsSync(SESSIONS_DIR)
      ? fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.md')).length
      : 0;

    return {
      summarySize: readSize(SUMMARY_FILE),
      rawSize: readSize(RAW_FILE),
      memorySize: readSize(MEMORY_FILE),
      sessionCount,
    };
  }
}
