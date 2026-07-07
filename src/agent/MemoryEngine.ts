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
const USER_FILE = path.join(MEMORIES_DIR, 'USER.md');
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
const MEMORY_CHAR_LIMIT = 2200;
const USER_CHAR_LIMIT = 1375;
const ENTRY_DELIMITER = '\n§\n';
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

function readEntries(file: string): string[] {
  if (!fs.existsSync(file)) return [];
  const content = fs.readFileSync(file, 'utf-8');
  if (
    !content.includes(ENTRY_DELIMITER) &&
    (content.length > 5000 ||
      /Session learnings|Tools used:|Files modified:|Errors encountered:/i.test(content))
  ) {
    return [];
  }

  return content
    .split(ENTRY_DELIMITER)
    .map((entry) => entry.trim())
    .filter((entry) => Boolean(entry) && !isMemoryNoise(entry));
}

function renderEntries(title: string, entries: string[], limit: number): string {
  if (entries.length === 0) return '';
  const content = entries.join(ENTRY_DELIMITER);
  const used = content.length;
  const pct = Math.min(100, Math.round((used / limit) * 100));
  return `══════════════════════════════════════════════\n${title} [${pct}% — ${used}/${limit} chars]\n══════════════════════════════════════════════\n${content}`;
}

function withinCharBudget(entries: string[], next: string, limit: number): boolean {
  const combined = [...entries, next].join(ENTRY_DELIMITER);
  return combined.length <= limit;
}

function appendEntry(file: string, entry: string, limit: number): boolean {
  const clean = stripCredentials(entry).trim();
  if (!clean || clean.length > Math.floor(limit * 0.7)) return false;
  const entries = readEntries(file);
  if (entries.includes(clean)) return true;
  if (!withinCharBudget(entries, clean, limit)) return false;
  fs.writeFileSync(file, [...entries, clean].join(ENTRY_DELIMITER), 'utf-8');
  return true;
}

function isMemoryNoise(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    !text.trim() ||
    text.length > 320 ||
    lower.includes('[system hint]') ||
    lower.includes('[critical system]') ||
    lower.includes('tools used:') ||
    lower.includes('files modified:') ||
    lower.includes('errors encountered:') ||
    lower.includes('error executing') ||
    lower.includes('traceback') ||
    lower.includes('syntaxerror') ||
    lower.includes('typeerror') ||
    lower.includes('<persisted-output>') ||
    lower.includes('<body') ||
    lower.includes('screenshot saved') ||
    lower.includes('recaptcha-token') ||
    /^[=\-\s]+$/.test(text)
  );
}

function normalizeFact(text: string): string | null {
  const clean = stripCredentials(text).replace(/\s+/g, ' ').trim();
  if (isMemoryNoise(clean)) return null;
  return clean;
}

function extractCuratedFromLegacySummary(summary: string): { user: string[]; memory: string[] } {
  const user: string[] = [];
  const memory: string[] = [];
  for (const raw of summary.split('\n')) {
    const line = raw.trim();
    let kind = 'memory';
    let value = line;

    const tagged = line.match(
      /^[-•]?\s*\[(preference|correction|instruction|identity|memory)\]\s*(.+)$/i
    );
    if (tagged) {
      kind = tagged[1].toLowerCase();
      value = tagged[2];
    } else {
      const bullet = line.match(/^[-•]\s+(.+)$/);
      if (!bullet) continue;
      value = bullet[1];
    }

    const fact = normalizeFact(value);
    if (!fact) continue;
    const entry = kind === 'correction' ? `Correction from user: ${fact}` : fact;
    const bucket =
      kind === 'memory'
        ? memory
        : /user|prefer|gw |gue |saya |aku |jangan|gausah|ga usah|biasain|my name|call me/i.test(
              fact
            )
          ? user
          : memory;
    if (!bucket.includes(entry)) bucket.push(entry);
  }
  return { user: user.slice(0, 6), memory: memory.slice(0, 8) };
}

export class MemoryEngine {
  constructor(private provider?: Provider) {}

  setProvider(p: Provider | undefined): void {
    this.provider = p;
  }

  loadSummary(): string {
    ensureDirs();
    const userEntries = readEntries(USER_FILE);
    const memoryEntries = readEntries(MEMORY_FILE);

    if (userEntries.length > 0 || memoryEntries.length > 0) {
      return trimToTokenBudget(
        [
          renderEntries('USER PROFILE (who the user is)', userEntries, USER_CHAR_LIMIT),
          renderEntries('MEMORY (durable notes)', memoryEntries, MEMORY_CHAR_LIMIT),
        ]
          .filter(Boolean)
          .join('\n\n'),
        MAX_SUMMARY_TOKENS
      );
    }

    if (!fs.existsSync(SUMMARY_FILE)) return '';
    const legacy = extractCuratedFromLegacySummary(fs.readFileSync(SUMMARY_FILE, 'utf-8'));
    return trimToTokenBudget(
      [
        renderEntries('USER PROFILE (curated from legacy memory)', legacy.user, USER_CHAR_LIMIT),
        renderEntries('MEMORY (curated from legacy memory)', legacy.memory, MEMORY_CHAR_LIMIT),
      ]
        .filter(Boolean)
        .join('\n\n'),
      MAX_SUMMARY_TOKENS
    );
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

  // Enrich a raw user utterance into a context-dense memory sentence before
  // saving. Makes recalled memories self-contained — the agent can understand
  // them later without the original conversation context.
  //
  // Example:
  //   in:  "kenapa pupuk ga boleh kebanyakan"
  //   out: "Mengapa pupuk sintetis/organik yang digunakan manusia dalam
  //         perkebunan dan persawahan tidak boleh digunakan secara berlebihan
  //         dalam dosis maupun frekuensi, meskipun efek awalnya sangat bagus
  //         bagi hasil panen manusia — termasuk dampak terhadap tanah, air,
  //         ekosistem, dan kesehatan konsumen."
  async rephraseForMemory(rawInput: string): Promise<string> {
    if (!rawInput || rawInput.length < 4) return rawInput;
    if (!this.provider) return rawInput;

    try {
      const systemMsg: Message = {
        role: 'system',
        content: `You are a memory-enrichment assistant for a persistent AI agent memory system.

Your job: rewrite the user's input into ONE context-dense, self-contained sentence (or two at most) that the agent can recall months later and still fully understand WITHOUT the original conversation.

Rules:
1. Preserve the user's core question/statement/fact — don't invent unrelated content.
2. ADD implicit context the user probably meant:
   - Domain (agriculture, programming, finance, health, etc.)
   - Scope (what specific thing/person/system they're referring to)
   - Conditions / caveats they hinted at but didn't spell out
   - "Why" framing if they asked a causal question
3. Use the SAME LANGUAGE as the user's input (Indonesian input → Indonesian output, English → English, etc.).
4. Keep it factual and concrete. No filler ("In today's world...", "It is important to note...").
5. Length target: 2-5x the original. If the input is already context-rich, just lightly expand.
6. Output ONLY the rewritten text — no quotes, no markdown, no preamble.

Examples:
  Input:  "kenapa pupuk ga boleh kebanyakan"
  Output: Mengapa pupuk sintetis dan organik yang digunakan dalam perkebunan serta persawahan tidak boleh diaplikasikan secara berlebihan dalam dosis maupun frekuensi, meskipun efek awalnya meningkatkan hasil panen — termasuk dampaknya terhadap kesuburan tanah, pencemaran air, ekosistem, dan kesehatan konsumen.

  Input:  "fix bug login"
  Output: Perbaikan bug pada alur login aplikasi (kemungkinan di endpoint /auth/login atau komponen LoginForm) — identifikasi root cause (error handling, validasi input, atau session management) dan terapkan fix yang tidak menimbulkan regresi di fitur terkait.

  Input:  "gw suka react"
  Output: Preferensi user: lebih suka menggunakan React sebagai frontend library dibanding framework alternatif (Vue, Svelte, Angular) untuk project-project yang dikerjakan.`,
      };
      const userMsg: Message = { role: 'user', content: rawInput };

      const response = await this.provider.chat([systemMsg, userMsg]);

      const text = (response.text || '').trim();
      // Reject if the LLM echoed the input verbatim or added preamble quotes.
      if (!text || text.length < rawInput.length * 0.8) return rawInput;
      if (text.startsWith('"') && text.endsWith('"')) return text.slice(1, -1);
      if (text.startsWith("'") && text.endsWith("'")) return text.slice(1, -1);
      return text;
    } catch {
      return rawInput;
    }
  }

  saveSession(messages: Message[], sessionId?: string): string {
    ensureDirs();
    const id = sessionId || generateUUID();
    const sessionFile = path.join(SESSIONS_DIR, `${id}.json`);

    const serializable = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role,
        content: stripCredentials(m.content),
        toolCallId: m.toolCallId,
        toolCalls: m.toolCalls,
      }));

    fs.writeFileSync(
      sessionFile,
      JSON.stringify({ id, savedAt: new Date().toISOString(), messages: serializable }, null, 2)
    );

    const facts = this.extractNotableFacts(messages);
    if (facts.length > 0) {
      const memoryFile = path.join(SESSIONS_DIR, `${id}.memory.json`);
      fs.writeFileSync(
        memoryFile,
        JSON.stringify({ sessionId: id, updatedAt: new Date().toISOString(), facts }, null, 2)
      );
      for (const fact of facts) {
        const target = /^\[(identity|preference|correction)\]/.test(fact) ? USER_FILE : MEMORY_FILE;
        const limit = target === USER_FILE ? USER_CHAR_LIMIT : MEMORY_CHAR_LIMIT;
        appendEntry(target, fact.replace(/^\[[^\]]+\]\s*/, ''), limit);
      }
    }

    return id;
  }

  listSessions(): { id: string; savedAt: string; messageCount: number; preview: string }[] {
    try {
      ensureDirs();
      const files = fs
        .readdirSync(SESSIONS_DIR)
        .filter((f) => f.endsWith('.json') && !f.endsWith('.memory.json'));
      const out: { id: string; savedAt: string; messageCount: number; preview: string }[] = [];
      for (const file of files) {
        try {
          const raw = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, file), 'utf-8'));
          const msgs: any[] = Array.isArray(raw.messages) ? raw.messages : [];
          const firstUser = msgs.find((m) => m.role === 'user');
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

      const files = fs.readdirSync(SESSIONS_DIR).filter((f) => f.endsWith(`.${ext}`));
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
      if (msg.role !== 'user' || !msg.content) continue;
      const lower = msg.content.toLowerCase();
      const clean = normalizeFact(msg.content);
      if (!clean) continue;

      const isExplicitMemory = /remember|keep in mind|note that|catat|inget|ingat/i.test(lower);
      const isCorrection =
        /jangan|don't|ga usah|gausa|stop doing|wrong|salah|bukan gitu|bukan .*woi/i.test(lower);
      const isPreference =
        /\b(i prefer|prefer|i like|i use|i work|gw suka|gue suka|pake|gunakan|lebih baik|biasain)\b/i.test(
          lower
        );
      const isIdentity = /\b(i am|i'm|my name is|call me|nama saya|panggil saya)\b/i.test(lower);

      if (isExplicitMemory || isCorrection || isPreference || isIdentity) {
        const label = isCorrection
          ? 'correction'
          : isIdentity
            ? 'identity'
            : isExplicitMemory && !isPreference
              ? 'memory'
              : 'preference';
        facts.push(`[${label}] ${clean}`);
      }
    }

    const seen = new Set<string>();
    return facts.filter((f) => {
      const key = f.toLowerCase().slice(0, 120);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  extractSessionLearnings(messages: Message[]): string {
    const facts = this.extractNotableFacts(messages);
    if (facts.length === 0) return '';
    return `Learned durable facts:\n${facts
      .slice(0, 10)
      .map((f) => `  - ${f}`)
      .join('\n')}`;
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
          content: `You are a memory consolidation agent. Extract ONLY durable, high-signal facts for a persistent agent memory.

Rules:
- Strip credentials, API keys, tokens, cookies, and private values.
- Keep: stable user preferences/corrections, stable project conventions, durable environment facts.
- Skip: raw data dumps, web/forum/article content, task progress, completed-work logs, temporary TODO state, file counts, tool names, stack traces, browser errors, security findings from one-off reviews, and anything likely stale in 7 days.
- Do not save "fixed bug X", PR/commit/session outcomes, or website/article claims as memory; those belong in session search.
- Write compact declarative facts, not instructions. Example: "User prefers direct Indonesian technical style" not "Always answer in Indonesian".
- Output one fact per bullet, using exactly one of these prefixes so the local importer can route it:
  - [identity] for who the user is
  - [preference] for stable user preferences
  - [correction] for durable user corrections
  - [memory] for stable project/environment notes
- Do not add headings or prose outside those bullets.`,
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
    if (!fs.existsSync(SUMMARY_FILE)) return;
    const legacy = extractCuratedFromLegacySummary(fs.readFileSync(SUMMARY_FILE, 'utf-8'));
    for (const entry of legacy.user) appendEntry(USER_FILE, entry, USER_CHAR_LIMIT);
    for (const entry of legacy.memory) appendEntry(MEMORY_FILE, entry, MEMORY_CHAR_LIMIT);
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
    const queryLower = query.toLowerCase();
    const lines = [
      ...readEntries(USER_FILE).map((entry) => `USER: ${entry}`),
      ...readEntries(MEMORY_FILE).map((entry) => `MEMORY: ${entry}`),
    ];

    const matches = lines.filter((line) => line.toLowerCase().includes(queryLower));

    if (matches.length === 0) return '';
    return matches.slice(0, 20).join('\n');
  }

  getStats(): { summarySize: number; rawSize: number; memorySize: number; sessionCount: number } {
    ensureDirs();
    const readSize = (f: string) => {
      try {
        return fs.statSync(f).size;
      } catch {
        return 0;
      }
    };

    const sessionCount = fs.existsSync(SESSIONS_DIR)
      ? fs
          .readdirSync(SESSIONS_DIR)
          .filter((f) => (f.endsWith('.md') || f.endsWith('.json')) && !f.endsWith('.memory.json'))
          .length
      : 0;

    return {
      summarySize: readSize(SUMMARY_FILE),
      rawSize: readSize(RAW_FILE),
      memorySize: readSize(MEMORY_FILE),
      sessionCount,
    };
  }
}
