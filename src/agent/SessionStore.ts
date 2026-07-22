import fs from 'fs';
import os from 'os';
import path from 'path';
import initSqlJs, { type Database, type SqlJsStatic, type Statement } from 'sql.js';
import type { Message, ToolCall } from '../providers/index.js';
import { agentObserverBus, type AgentObserverEvent } from './AgentObserverBus.js';

const STATE_DIR = path.join(os.homedir(), '.aurix', 'state');
const DEFAULT_DB_PATH = path.join(STATE_DIR, 'aurix.sqlite');

const CREDENTIAL_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/g,
  /ghp_[a-zA-Z0-9]{36}/g,
  /xox[bpas]-[a-zA-Z0-9-]+/g,
  /AKIA[A-Z0-9]{16}/g,
  /-----BEGIN.*PRIVATE KEY-----[\s\S]*?-----END.*PRIVATE KEY-----/g,
  /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g,
  /(api[_-]?key|token|secret|password|authorization)["'\s:=]+[^\s"']{8,}/gi,
];

let SQL: SqlJsStatic | null = null;
let defaultStore: Promise<SessionStore> | null = null;
let observerSinkInstalled = false;

export interface SessionMeta {
  id: string;
  title?: string;
  platform?: string;
  userKey?: string;
  channelId?: string;
  model?: string;
  provider?: string;
  cwd?: string;
  status?: string;
}

export interface SessionSummary {
  id: string;
  title: string;
  savedAt: string;
  messageCount: number;
  preview: string;
  platform?: string;
  userKey?: string;
  snippet?: string;
}


export interface MessagePage {
  messages: Message[];
  oldestCursor?: number;
  hasMore: boolean;
}

export interface StoredToolEvent {
  sessionId: string;
  turnId: string;
  toolCallId?: string;
  toolName: string;
  phase: 'start' | 'end' | 'chunk';
  args?: Record<string, unknown>;
  result?: string;
  resultPath?: string;
  status?: 'running' | 'success' | 'error' | 'timeout' | 'cancelled';
  durationMs?: number;
  errorType?: string;
}

export type EvidenceStatus = 'passed' | 'failed' | 'skipped';

export interface EvidenceItem {
  id?: number;
  sessionId: string;
  turnId?: string;
  kind: 'typecheck' | 'build' | 'test' | 'lint' | 'manual' | 'source' | 'deploy' | 'other';
  label: string;
  command?: string;
  target?: string;
  status: EvidenceStatus;
  result?: string;
  resultPath?: string;
  errorType?: string;
  createdAt?: string;
}

export interface ToolUsageStat {
  toolName: string;
  total: number;
  success: number;
  failed: number;
  successRate: number;
  averageDurationMs: number;
  topErrorType?: string;
}

export interface WorkflowPattern {
  name: string;
  sequence: string[];
  count: number;
  successfulSessions: number;
  candidateSkill: boolean;
}

export interface ScheduledJob {
  id: string;
  schedule: string;
  prompt: string;
  status: 'active' | 'paused';
  targetPlatform?: string;
  targetChannelId?: string;
  targetReplyTo?: string;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  nextRunHint?: string;
}

export interface ScheduledJobRun {
  id?: number;
  jobId: string;
  startedAt: string;
  finishedAt?: string;
  status: 'running' | 'success' | 'error';
  result?: string;
  error?: string;
}

export interface AgentJobSummary {
  id: string;
  kind: string;
  prompt: string;
  status: 'running' | 'success' | 'error';
  totalAgents?: number;
  completedAgents?: number;
  startedAt: string;
  finishedAt?: string;
  lastStatus?: string;
}

export interface StoredObserverEvent extends AgentObserverEvent {
  id?: number;
}

function ensureStateDir(): void {
  if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
}

export function redactSessionText(input: unknown): string {
  let text = typeof input === 'string' ? input : JSON.stringify(input ?? '');
  for (const pattern of CREDENTIAL_PATTERNS) text = text.replace(pattern, '[REDACTED]');
  return text;
}

function safeJson(value: unknown): string | null {
  if (value === undefined) return null;
  try {
    return redactSessionText(JSON.stringify(value));
  } catch {
    return null;
  }
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function firstUserPreview(messages: Message[]): string {
  const firstUser = messages.find((m) => m.role === 'user');
  return (firstUser?.content || messages.find((m) => m.content)?.content || '(empty)')
    .replace(/\s+/g, ' ')
    .slice(0, 90);
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

function ftsQuery(query: string): string {
  const terms = query
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/"/g, '""'))
    .filter(Boolean);
  if (terms.length === 0) return '""';
  return terms.map((t) => `"${t}"`).join(' OR ');
}

export async function getSessionStore(dbPath = DEFAULT_DB_PATH): Promise<SessionStore> {
  if (dbPath === DEFAULT_DB_PATH) {
    if (!defaultStore) defaultStore = SessionStore.open(dbPath);
    return defaultStore;
  }
  return SessionStore.open(dbPath);
}

export function installObserverBusSessionSink(): void {
  if (observerSinkInstalled) return;
  observerSinkInstalled = true;
  agentObserverBus.subscribe(async (event) => {
    if (!event.sessionId && !event.jobId) return;
    try {
      const store = await getSessionStore();
      store.recordObserverEvent(event);
    } catch {
      // Observer persistence must not affect agent execution.
    }
  });
}

export class SessionStore {
  private ftsAvailable = false;
  private diskSignature = '';
  private writeSequence = 0;

  private constructor(
    private db: Database,
    private dbPath: string
  ) {
    this.diskSignature = this.getDiskSignature();
    this.withWriteLock(() => {});
  }

  static async open(dbPath = DEFAULT_DB_PATH): Promise<SessionStore> {
    ensureStateDir();
    if (!SQL) SQL = await initSqlJs();
    const db = fs.existsSync(dbPath)
      ? new SQL.Database(fs.readFileSync(dbPath))
      : new SQL.Database();
    return new SessionStore(db, dbPath);
  }

  private getDiskSignature(): string {
    try {
      const stat = fs.statSync(this.dbPath);
      return `${stat.mtimeMs}:${stat.size}:${stat.ino}`;
    } catch {
      return '';
    }
  }

  private reloadFromDisk(): void {
    if (!SQL) throw new Error('SQLite runtime is not initialized.');
    const next = fs.existsSync(this.dbPath)
      ? new SQL.Database(fs.readFileSync(this.dbPath))
      : new SQL.Database();
    this.db.close();
    this.db = next;
    this.diskSignature = this.getDiskSignature();
    this.ftsAvailable = false;
  }

  private refreshForRead(): void {
    if (this.getDiskSignature() !== this.diskSignature) {
      this.reloadFromDisk();
      this.detectFtsAvailability();
    }
  }

  private acquireWriteLock(): () => void {
    const lockPath = `${this.dbPath}.lock`;
    const deadline = Date.now() + 10_000;
    const waitBuffer = new Int32Array(new SharedArrayBuffer(4));

    while (true) {
      try {
        fs.mkdirSync(lockPath);
        const lockToken = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        fs.writeFileSync(
          path.join(lockPath, 'owner.json'),
          JSON.stringify({ pid: process.pid, createdAt: Date.now(), token: lockToken })
        );
        return () => {
          try {
            const owner = JSON.parse(fs.readFileSync(path.join(lockPath, 'owner.json'), 'utf8'));
            if (owner.token === lockToken) fs.rmSync(lockPath, { recursive: true, force: true });
          } catch {}
        };
      } catch (error: any) {
        if (error?.code !== 'EEXIST') throw error;

        let stale = false;
        try {
          const stat = fs.statSync(lockPath);
          const ownerPath = stat.isDirectory() ? path.join(lockPath, 'owner.json') : lockPath;
          const raw = fs.readFileSync(ownerPath, 'utf8').trim();
          const parsed = raw.startsWith('{') ? JSON.parse(raw) : { pid: Number(raw) };
          const ownerPid = Number(parsed.pid);
          const createdAt = Number(parsed.createdAt || stat.mtimeMs);
          const ageMs = Date.now() - createdAt;
          if (!Number.isFinite(ownerPid) || ownerPid <= 0) {
            stale = ageMs > 1_000;
          } else {
            try {
              process.kill(ownerPid, 0);
              stale = false;
            } catch (probeError: any) {
              stale = probeError?.code === 'ESRCH';
            }
          }
        } catch {
          try {
            stale = Date.now() - fs.statSync(lockPath).mtimeMs > 1_000;
          } catch {}
        }

        if (stale) {
          const quarantine = `${lockPath}.stale-${process.pid}-${Date.now()}`;
          try {
            fs.renameSync(lockPath, quarantine);
            fs.rmSync(quarantine, { recursive: true, force: true });
          } catch {}
          continue;
        }
        if (Date.now() >= deadline) {
          throw new Error(`Timed out waiting for state database lock: ${this.dbPath}`);
        }
        Atomics.wait(waitBuffer, 0, 0, 25);
      }
    }
  }

  private withWriteLock<T>(mutation: () => T): T {
    ensureStateDir();
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    const release = this.acquireWriteLock();
    try {
      this.reloadFromDisk();
      this.migrate();
      const result = mutation();
      this.persist();
      return result;
    } finally {
      release();
    }
  }

  get path(): string {
    return this.dbPath;
  }

  private addColumnIfMissing(table: string, column: string, definition: string): void {
    try {
      const existing = this.db.exec(`PRAGMA table_info(${table})`)[0]?.values || [];
      if (!existing.some((row) => String(row[1]) === column)) {
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      }
    } catch {}
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT,
        platform TEXT,
        user_key TEXT,
        channel_id TEXT,
        model TEXT,
        provider TEXT,
        cwd TEXT,
        status TEXT DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_message_at TEXT
      );
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        turn_id TEXT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_call_id TEXT,
        tool_calls_json TEXT,
        images_json TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_messages_session_created ON messages(session_id, created_at, id);
      CREATE INDEX IF NOT EXISTS idx_messages_content ON messages(content);
      CREATE TABLE IF NOT EXISTS tool_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        turn_id TEXT,
        tool_call_id TEXT,
        tool_name TEXT NOT NULL,
        phase TEXT NOT NULL,
        args_json TEXT,
        result_preview TEXT,
        result_path TEXT,
        status TEXT,
        duration_ms INTEGER,
        error_type TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_tool_events_session_created ON tool_events(session_id, created_at, id);
      CREATE INDEX IF NOT EXISTS idx_tool_events_tool_name ON tool_events(tool_name);
      CREATE TABLE IF NOT EXISTS evidence_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        turn_id TEXT,
        kind TEXT NOT NULL,
        label TEXT NOT NULL,
        command TEXT,
        target TEXT,
        status TEXT NOT NULL,
        result_preview TEXT,
        result_path TEXT,
        error_type TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_evidence_session_created ON evidence_items(session_id, created_at, id);
      CREATE INDEX IF NOT EXISTS idx_evidence_status ON evidence_items(status);
      CREATE TABLE IF NOT EXISTS verification_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        turn_id TEXT,
        summary TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS scheduled_jobs (
        id TEXT PRIMARY KEY,
        schedule TEXT NOT NULL,
        prompt TEXT NOT NULL,
        status TEXT NOT NULL,
        target_platform TEXT,
        target_channel_id TEXT,
        target_reply_to TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_run_at TEXT,
        next_run_hint TEXT
      );
      CREATE TABLE IF NOT EXISTS scheduled_job_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        status TEXT NOT NULL,
        result_preview TEXT,
        error TEXT,
        FOREIGN KEY(job_id) REFERENCES scheduled_jobs(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_status ON scheduled_jobs(status);
      CREATE INDEX IF NOT EXISTS idx_scheduled_job_runs_job ON scheduled_job_runs(job_id, id);
      CREATE TABLE IF NOT EXISTS agent_jobs (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        prompt TEXT NOT NULL,
        status TEXT NOT NULL,
        total_agents INTEGER,
        completed_agents INTEGER DEFAULT 0,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        last_status TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_agent_jobs_started ON agent_jobs(started_at);
      CREATE TABLE IF NOT EXISTS observer_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        turn_id TEXT,
        job_id TEXT,
        source TEXT NOT NULL,
        event_type TEXT NOT NULL,
        status TEXT,
        tool_name TEXT,
        summary TEXT,
        payload_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_observer_events_session_created ON observer_events(session_id, created_at, id);
      CREATE INDEX IF NOT EXISTS idx_observer_events_job_created ON observer_events(job_id, created_at, id);
      CREATE INDEX IF NOT EXISTS idx_observer_events_source_type ON observer_events(source, event_type);
    `);

    this.addColumnIfMissing('tool_events', 'duration_ms', 'INTEGER');
    this.addColumnIfMissing('tool_events', 'error_type', 'TEXT');
    this.addColumnIfMissing('tool_events', 'result_path', 'TEXT');
    this.addColumnIfMissing('evidence_items', 'turn_id', 'TEXT');
    this.addColumnIfMissing('evidence_items', 'command', 'TEXT');
    this.addColumnIfMissing('evidence_items', 'target', 'TEXT');
    this.addColumnIfMissing('evidence_items', 'result_path', 'TEXT');
    this.addColumnIfMissing('evidence_items', 'error_type', 'TEXT');
    this.addColumnIfMissing('verification_runs', 'turn_id', 'TEXT');

    this.detectFtsAvailability();
  }

  private detectFtsAvailability(): void {
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS session_fts USING fts5(
          session_id UNINDEXED,
          kind UNINDEXED,
          ref_id UNINDEXED,
          title,
          content,
          created_at UNINDEXED
        );
      `);
      this.ftsAvailable = true;
    } catch {
      this.ftsAvailable = false;
    }
  }

  private persist(): void {
    ensureStateDir();
    const tmp = `${this.dbPath}.${process.pid}.${++this.writeSequence}.tmp`;
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeFileSync(fd, Buffer.from(this.db.export()));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, this.dbPath);
    if (process.platform !== 'win32') {
      const dirFd = fs.openSync(path.dirname(this.dbPath), 'r');
      try {
        fs.fsyncSync(dirFd);
      } finally {
        fs.closeSync(dirFd);
      }
    }
    this.diskSignature = this.getDiskSignature();
  }

  private indexText(
    sessionId: string,
    kind: string,
    refId: string,
    title: string | undefined,
    content: string,
    createdAt: string
  ): void {
    if (!this.ftsAvailable) return;
    try {
      const stmt = this.db.prepare(
        'INSERT INTO session_fts (session_id, kind, ref_id, title, content, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      );
      stmt.run([sessionId, kind, refId, title || '', redactSessionText(content), createdAt]);
      stmt.free();
    } catch {
      this.ftsAvailable = false;
    }
  }

  upsertSession(meta: SessionMeta): void {
    this.withWriteLock(() => {
      const ts = nowIso();
      const stmt = this.db.prepare(`
        INSERT INTO sessions (id, title, platform, user_key, channel_id, model, provider, cwd, status, created_at, updated_at, last_message_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = COALESCE(excluded.title, sessions.title),
          platform = COALESCE(excluded.platform, sessions.platform),
          user_key = COALESCE(excluded.user_key, sessions.user_key),
          channel_id = COALESCE(excluded.channel_id, sessions.channel_id),
          model = COALESCE(excluded.model, sessions.model),
          provider = COALESCE(excluded.provider, sessions.provider),
          cwd = COALESCE(excluded.cwd, sessions.cwd),
          status = COALESCE(excluded.status, sessions.status),
          updated_at = excluded.updated_at
      `);
      stmt.run([
        meta.id,
        meta.title || null,
        meta.platform || null,
        meta.userKey || null,
        meta.channelId || null,
        meta.model || null,
        meta.provider || null,
        meta.cwd || process.cwd(),
        meta.status || 'active',
        ts,
        ts,
        ts,
      ]);
      stmt.free();
    });
  }

  setSessionTitle(sessionId: string, title: string): void {
    this.withWriteLock(() => {
      const ts = nowIso();
      const stmt = this.db.prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?');
      stmt.run([title, ts, sessionId]);
      stmt.free();
      this.indexText(sessionId, 'session', sessionId, title, title, ts);
    });
  }

  appendMessage(input: {
    sessionId: string;
    turnId?: string;
    message: Message;
    metadata?: Record<string, unknown>;
  }): void {
    this.withWriteLock(() => {
      const ts = nowIso();
      const content = redactSessionText(input.message.content || '');
      const stmt = this.db.prepare(`
        INSERT INTO messages (session_id, turn_id, role, content, tool_call_id, tool_calls_json, images_json, metadata_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run([
        input.sessionId,
        input.turnId || null,
        input.message.role,
        content,
        input.message.toolCallId || null,
        safeJson(input.message.toolCalls),
        safeJson(input.message.images),
        safeJson(input.metadata),
        ts,
      ]);
      const id = this.db.exec('SELECT last_insert_rowid() AS id')[0]?.values?.[0]?.[0];
      stmt.free();
      this.db.run('UPDATE sessions SET updated_at = ?, last_message_at = ? WHERE id = ?', [
        ts,
        ts,
        input.sessionId,
      ]);
      this.indexText(input.sessionId, 'message', String(id || ''), undefined, content, ts);
    });
  }

  recordObserverEvent(event: StoredObserverEvent): void {
    this.withWriteLock(() => {
      const ts = event.createdAt || nowIso();
      const summary = event.summary ? redactSessionText(event.summary).slice(0, 1000) : null;
      const stmt = this.db.prepare(`
        INSERT INTO observer_events (session_id, turn_id, job_id, source, event_type, status, tool_name, summary, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run([
        event.sessionId || null,
        event.turnId || null,
        event.jobId || null,
        event.source,
        event.eventType,
        event.status || null,
        event.toolName || null,
        summary,
        safeJson(event.payload),
        ts,
      ]);
      stmt.free();
      if (event.sessionId)
        this.db.run('UPDATE sessions SET updated_at = ? WHERE id = ?', [ts, event.sessionId]);
    });
  }

  listObserverEvents(
    filter: { sessionId?: string; jobId?: string } = {},
    limit = 100
  ): StoredObserverEvent[] {
    this.refreshForRead();
    const stmt = this.db.prepare(`
      SELECT id, session_id, turn_id, job_id, source, event_type, status, tool_name, summary, payload_json, created_at
      FROM observer_events
      WHERE (? IS NULL OR session_id = ?) AND (? IS NULL OR job_id = ?)
      ORDER BY id DESC
      LIMIT ?
    `);
    stmt.bind([
      filter.sessionId || null,
      filter.sessionId || null,
      filter.jobId || null,
      filter.jobId || null,
      limit,
    ]);
    const out: StoredObserverEvent[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      out.push({
        id: Number(row.id || 0),
        sessionId: row.session_id ? String(row.session_id) : undefined,
        turnId: row.turn_id ? String(row.turn_id) : undefined,
        jobId: row.job_id ? String(row.job_id) : undefined,
        source: String(row.source || 'agent_loop') as StoredObserverEvent['source'],
        eventType: String(row.event_type || ''),
        status: row.status ? (String(row.status) as StoredObserverEvent['status']) : undefined,
        toolName: row.tool_name ? String(row.tool_name) : undefined,
        summary: row.summary ? String(row.summary) : undefined,
        payload: parseJson<Record<string, unknown> | undefined>(row.payload_json, undefined),
        createdAt: row.created_at ? String(row.created_at) : undefined,
      });
    }
    stmt.free();
    return out;
  }

  recordToolEvent(event: StoredToolEvent): void {
    const ts = nowIso();
    if (event.phase === 'chunk') {
      agentObserverBus.publish({
        sessionId: event.sessionId,
        turnId: event.turnId,
        source: 'agent_loop',
        eventType: 'tool_chunk',
        status: event.status,
        toolName: event.toolName,
        summary: event.result || event.toolName,
        payload: {
          toolCallId: event.toolCallId,
          resultPath: event.resultPath,
          durationMs: event.durationMs,
          errorType: event.errorType,
        },
        createdAt: ts,
      });
      return;
    }
    this.withWriteLock(() => {
      const resultPreview = event.result ? redactSessionText(event.result).slice(0, 4000) : null;
      const stmt = this.db.prepare(`
        INSERT INTO tool_events (session_id, turn_id, tool_call_id, tool_name, phase, args_json, result_preview, result_path, status, duration_ms, error_type, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run([
        event.sessionId,
        event.turnId || null,
        event.toolCallId || null,
        event.toolName,
        event.phase,
        safeJson(event.args),
        resultPreview,
        event.resultPath || null,
        event.status || (event.phase === 'start' ? 'running' : null),
        event.durationMs ?? null,
        event.errorType || null,
        ts,
      ]);
      const id = this.db.exec('SELECT last_insert_rowid() AS id')[0]?.values?.[0]?.[0];
      stmt.free();
      const argsPreview = safeJson(event.args);
      const searchable = [
        event.toolName,
        event.phase,
        event.status,
        event.errorType,
        event.resultPath,
        argsPreview,
        resultPreview,
      ]
        .filter(Boolean)
        .join('\n');
      this.indexText(event.sessionId, 'tool', String(id || ''), event.toolName, searchable, ts);
      this.db.run('UPDATE sessions SET updated_at = ? WHERE id = ?', [ts, event.sessionId]);
    });
    agentObserverBus.publish({
      sessionId: event.sessionId,
      turnId: event.turnId,
      source: 'agent_loop',
      eventType: `tool_${event.phase}`,
      status: event.status || (event.phase === 'start' ? 'running' : undefined),
      toolName: event.toolName,
      summary: event.result || event.toolName,
      payload: {
        toolCallId: event.toolCallId,
        args: event.args,
        resultPath: event.resultPath,
        durationMs: event.durationMs,
        errorType: event.errorType,
      },
      createdAt: ts,
    });
  }

  recordEvidenceItem(item: EvidenceItem): number {
    return this.withWriteLock(() => {
      const ts = item.createdAt || nowIso();
      const resultPreview = item.result ? redactSessionText(item.result).slice(0, 4000) : null;
      const stmt = this.db.prepare(`
        INSERT INTO evidence_items (session_id, turn_id, kind, label, command, target, status, result_preview, result_path, error_type, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run([
        item.sessionId,
        item.turnId || null,
        item.kind,
        redactSessionText(item.label).slice(0, 240),
        item.command ? redactSessionText(item.command).slice(0, 1000) : null,
        item.target ? redactSessionText(item.target).slice(0, 500) : null,
        item.status,
        resultPreview,
        item.resultPath || null,
        item.errorType || null,
        ts,
      ]);
      const id = Number(this.db.exec('SELECT last_insert_rowid() AS id')[0]?.values?.[0]?.[0] || 0);
      stmt.free();
      const searchable = [
        item.kind,
        item.label,
        item.command,
        item.target,
        item.status,
        item.errorType,
        resultPreview,
      ]
        .filter(Boolean)
        .join('\n');
      this.indexText(item.sessionId, 'evidence', String(id), item.label, searchable, ts);
      this.db.run('UPDATE sessions SET updated_at = ? WHERE id = ?', [ts, item.sessionId]);
      return id;
    });
  }

  listEvidenceItems(sessionId: string, limit = 20, turnId?: string): EvidenceItem[] {
    this.refreshForRead();
    const stmt = this.db.prepare(`
      SELECT id, session_id, turn_id, kind, label, command, target, status, result_preview, result_path, error_type, created_at
      FROM evidence_items
      WHERE session_id = ? AND (? IS NULL OR turn_id = ?)
      ORDER BY id DESC
      LIMIT ?
    `);
    stmt.bind([sessionId, turnId || null, turnId || null, limit]);
    const out: EvidenceItem[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      out.push({
        id: Number(row.id || 0),
        sessionId: String(row.session_id || ''),
        turnId: row.turn_id ? String(row.turn_id) : undefined,
        kind: String(row.kind || 'other') as EvidenceItem['kind'],
        label: String(row.label || ''),
        command: row.command ? String(row.command) : undefined,
        target: row.target ? String(row.target) : undefined,
        status: String(row.status || 'skipped') as EvidenceStatus,
        result: row.result_preview ? String(row.result_preview) : undefined,
        resultPath: row.result_path ? String(row.result_path) : undefined,
        errorType: row.error_type ? String(row.error_type) : undefined,
        createdAt: row.created_at ? String(row.created_at) : undefined,
      });
    }
    stmt.free();
    return out;
  }

  getToolUsageStats(limit = 15): ToolUsageStat[] {
    this.refreshForRead();
    const stmt = this.db.prepare(`
      SELECT tool_name,
             COUNT(*) AS total,
             SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success_count,
             SUM(CASE WHEN status IN ('error', 'timeout', 'cancelled') THEN 1 ELSE 0 END) AS failed_count,
             AVG(CASE WHEN duration_ms IS NOT NULL AND duration_ms >= 0 THEN duration_ms ELSE NULL END) AS avg_duration_ms
      FROM tool_events
      WHERE phase = 'end'
      GROUP BY tool_name
      ORDER BY total DESC, success_count DESC
      LIMIT ?
    `);
    stmt.bind([limit]);
    const rows: ToolUsageStat[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      const toolName = String(row.tool_name || 'unknown');
      const total = Number(row.total || 0);
      const success = Number(row.success_count || 0);
      const failed = Number(row.failed_count || 0);
      const errStmt = this.db.prepare(`
        SELECT error_type, COUNT(*) AS count
        FROM tool_events
        WHERE phase = 'end' AND tool_name = ? AND error_type IS NOT NULL AND error_type != ''
        GROUP BY error_type
        ORDER BY count DESC
        LIMIT 1
      `);
      errStmt.bind([toolName]);
      const topErrorType = errStmt.step()
        ? String(errStmt.getAsObject().error_type || '')
        : undefined;
      errStmt.free();
      rows.push({
        toolName,
        total,
        success,
        failed,
        successRate: total > 0 ? Math.round((success / total) * 100) : 0,
        averageDurationMs: Math.round(Number(row.avg_duration_ms || 0)),
        topErrorType: topErrorType || undefined,
      });
    }
    stmt.free();
    return rows;
  }

  detectWorkflowPatterns(limit = 10): WorkflowPattern[] {
    this.refreshForRead();
    const stmt = this.db.prepare(`
      SELECT session_id, tool_name, status, id
      FROM tool_events
      WHERE phase = 'end'
      ORDER BY session_id, id
    `);
    const sessions = new Map<string, { tools: string[] }>();
    while (stmt.step()) {
      const row = stmt.getAsObject();
      const sessionId = String(row.session_id || '');
      if (!sessionId) continue;
      const current = sessions.get(sessionId) || { tools: [] };
      const tool = String(row.tool_name || 'tool');
      if (current.tools[current.tools.length - 1] !== tool) current.tools.push(tool);
      sessions.set(sessionId, current);
    }
    stmt.free();

    const successStmt = this.db.prepare(`
      SELECT DISTINCT session_id
      FROM evidence_items
      WHERE status = 'passed'
    `);
    const sessionsWithPassingEvidence = new Set<string>();
    while (successStmt.step()) {
      const row = successStmt.getAsObject();
      if (row.session_id) sessionsWithPassingEvidence.add(String(row.session_id));
    }
    successStmt.free();

    const counts = new Map<
      string,
      { sequence: string[]; count: number; successfulSessions: Set<string> }
    >();
    for (const [sessionId, data] of sessions) {
      const seq = data.tools.slice(-6).filter(Boolean);
      for (let size = 3; size <= Math.min(5, seq.length); size++) {
        for (let i = 0; i <= seq.length - size; i++) {
          const sequence = seq.slice(i, i + size);
          const key = sequence.join(' > ');
          const current = counts.get(key) || {
            sequence,
            count: 0,
            successfulSessions: new Set<string>(),
          };
          current.count += 1;
          if (sessionsWithPassingEvidence.has(sessionId)) current.successfulSessions.add(sessionId);
          counts.set(key, current);
        }
      }
    }

    return [...counts.values()]
      .filter((p) => p.count >= 2)
      .sort((a, b) => b.count - a.count || b.successfulSessions.size - a.successfulSessions.size)
      .slice(0, limit)
      .map((p) => ({
        name: p.sequence
          .join('-')
          .replace(/[^a-z0-9]+/gi, '-')
          .replace(/^-|-$/g, '')
          .toLowerCase(),
        sequence: p.sequence,
        count: p.count,
        successfulSessions: p.successfulSessions.size,
        candidateSkill: p.count >= 3 && p.successfulSessions.size >= 2,
      }));
  }

  upsertScheduledJob(
    job: Omit<ScheduledJob, 'createdAt' | 'updatedAt'> &
      Partial<Pick<ScheduledJob, 'createdAt' | 'updatedAt'>>
  ): ScheduledJob {
    return this.withWriteLock(() => {
      const ts = nowIso();
      const createdAt = job.createdAt || ts;
      const updatedAt = job.updatedAt || ts;
      const stmt = this.db.prepare(`
        INSERT INTO scheduled_jobs (id, schedule, prompt, status, target_platform, target_channel_id, target_reply_to, created_at, updated_at, last_run_at, next_run_hint)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          schedule = excluded.schedule,
          prompt = excluded.prompt,
          status = excluded.status,
          target_platform = excluded.target_platform,
          target_channel_id = excluded.target_channel_id,
          target_reply_to = excluded.target_reply_to,
          updated_at = excluded.updated_at,
          next_run_hint = excluded.next_run_hint
      `);
      stmt.run([
        job.id,
        job.schedule,
        redactSessionText(job.prompt),
        job.status,
        job.targetPlatform || null,
        job.targetChannelId || null,
        job.targetReplyTo || null,
        createdAt,
        updatedAt,
        job.lastRunAt || null,
        job.nextRunHint || null,
      ]);
      stmt.free();
      return { ...job, createdAt, updatedAt };
    });
  }

  listScheduledJobs(includePaused = true): ScheduledJob[] {
    this.refreshForRead();
    const stmt = this.db.prepare(`
      SELECT id, schedule, prompt, status, target_platform, target_channel_id, target_reply_to, created_at, updated_at, last_run_at, next_run_hint
      FROM scheduled_jobs
      WHERE ? OR status = 'active'
      ORDER BY created_at DESC
    `);
    stmt.bind([includePaused ? 1 : 0]);
    const out: ScheduledJob[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      out.push({
        id: String(row.id || ''),
        schedule: String(row.schedule || ''),
        prompt: String(row.prompt || ''),
        status: String(row.status || 'active') as ScheduledJob['status'],
        targetPlatform: row.target_platform ? String(row.target_platform) : undefined,
        targetChannelId: row.target_channel_id ? String(row.target_channel_id) : undefined,
        targetReplyTo: row.target_reply_to ? String(row.target_reply_to) : undefined,
        createdAt: String(row.created_at || ''),
        updatedAt: String(row.updated_at || ''),
        lastRunAt: row.last_run_at ? String(row.last_run_at) : undefined,
        nextRunHint: row.next_run_hint ? String(row.next_run_hint) : undefined,
      });
    }
    stmt.free();
    return out;
  }

  removeScheduledJob(id: string): boolean {
    return this.withWriteLock(() => {
      this.db.run('DELETE FROM scheduled_job_runs WHERE job_id = ?', [id]);
      this.db.run('DELETE FROM scheduled_jobs WHERE id = ?', [id]);
      return this.db.getRowsModified() > 0;
    });
  }

  recordScheduledJobRun(run: ScheduledJobRun): number {
    return this.withWriteLock(() => {
      let id = run.id || 0;
      if (id) {
        const stmt = this.db.prepare(`
          UPDATE scheduled_job_runs
          SET finished_at = ?, status = ?, result_preview = ?, error = ?
          WHERE id = ?
        `);
        stmt.run([
          run.finishedAt || null,
          run.status,
          run.result ? redactSessionText(run.result).slice(0, 4000) : null,
          run.error ? redactSessionText(run.error).slice(0, 1000) : null,
          id,
        ]);
        stmt.free();
      } else {
        const stmt = this.db.prepare(`
          INSERT INTO scheduled_job_runs (job_id, started_at, finished_at, status, result_preview, error)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        stmt.run([
          run.jobId,
          run.startedAt,
          run.finishedAt || null,
          run.status,
          run.result ? redactSessionText(run.result).slice(0, 4000) : null,
          run.error ? redactSessionText(run.error).slice(0, 1000) : null,
        ]);
        id = Number(this.db.exec('SELECT last_insert_rowid() AS id')[0]?.values?.[0]?.[0] || 0);
        stmt.free();
      }
      if (run.finishedAt) {
        this.db.run('UPDATE scheduled_jobs SET last_run_at = ?, updated_at = ? WHERE id = ?', [
          run.finishedAt,
          run.finishedAt,
          run.jobId,
        ]);
      }
      return id;
    });
  }

  recordAgentJobStart(job: AgentJobSummary): void {
    this.withWriteLock(() => {
      const stmt = this.db.prepare(`
        INSERT INTO agent_jobs (id, kind, prompt, status, total_agents, completed_agents, started_at, finished_at, last_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          total_agents = excluded.total_agents,
          last_status = excluded.last_status
      `);
      stmt.run([
        job.id,
        job.kind,
        redactSessionText(job.prompt).slice(0, 1000),
        job.status,
        job.totalAgents ?? null,
        job.completedAgents ?? 0,
        job.startedAt,
        job.finishedAt || null,
        job.lastStatus || null,
      ]);
      stmt.free();
    });
  }

  updateAgentJob(id: string, patch: Partial<AgentJobSummary>): void {
    this.withWriteLock(() => {
      const current = this.readAgentJobs(100).find((job) => job.id === id);
      if (!current) return;
      const next = { ...current, ...patch };
      const stmt = this.db.prepare(`
        UPDATE agent_jobs
        SET status = ?, total_agents = ?, completed_agents = ?, finished_at = ?, last_status = ?
        WHERE id = ?
      `);
      stmt.run([
        next.status,
        next.totalAgents ?? null,
        next.completedAgents ?? 0,
        next.finishedAt || null,
        next.lastStatus || null,
        id,
      ]);
      stmt.free();
    });
  }

  listAgentJobs(limit = 10): AgentJobSummary[] {
    this.refreshForRead();
    return this.readAgentJobs(limit);
  }

  private readAgentJobs(limit: number): AgentJobSummary[] {
    const stmt = this.db.prepare(`
      SELECT id, kind, prompt, status, total_agents, completed_agents, started_at, finished_at, last_status
      FROM agent_jobs
      ORDER BY started_at DESC
      LIMIT ?
    `);
    stmt.bind([limit]);
    const out: AgentJobSummary[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      out.push({
        id: String(row.id || ''),
        kind: String(row.kind || 'agent'),
        prompt: String(row.prompt || ''),
        status: String(row.status || 'running') as AgentJobSummary['status'],
        totalAgents: row.total_agents == null ? undefined : Number(row.total_agents),
        completedAgents: row.completed_agents == null ? undefined : Number(row.completed_agents),
        startedAt: String(row.started_at || ''),
        finishedAt: row.finished_at ? String(row.finished_at) : undefined,
        lastStatus: row.last_status ? String(row.last_status) : undefined,
      });
    }
    stmt.free();
    return out;
  }

  listSessions(limit = 20): SessionSummary[] {
    this.refreshForRead();
    return this.readSessions(limit);
  }

  private readSessions(limit: number): SessionSummary[] {
    const stmt = this.db.prepare(`
      SELECT s.id, COALESCE(s.title, s.id) AS title, s.platform, s.user_key, s.updated_at, s.last_message_at,
             COUNT(m.id) AS message_count,
             COALESCE((SELECT content FROM messages m2 WHERE m2.session_id = s.id AND m2.role = 'user' ORDER BY m2.id LIMIT 1), '') AS preview
      FROM sessions s
      LEFT JOIN messages m ON m.session_id = s.id
      GROUP BY s.id
      ORDER BY COALESCE(s.last_message_at, s.updated_at, s.created_at) DESC
      LIMIT ?
    `);
    stmt.bind([limit]);
    const out: SessionSummary[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      out.push({
        id: String(row.id || ''),
        title: String(row.title || row.id || ''),
        savedAt: String(row.last_message_at || row.updated_at || ''),
        messageCount: Number(row.message_count || 0),
        preview: String(row.preview || '(empty)')
          .replace(/\s+/g, ' ')
          .slice(0, 90),
        platform: row.platform ? String(row.platform) : undefined,
        userKey: row.user_key ? String(row.user_key) : undefined,
      });
    }
    stmt.free();
    return out;
  }

  searchSessions(query: string, limit = 10): SessionSummary[] {
    this.refreshForRead();
    const trimmed = query.trim();
    if (!trimmed) return this.readSessions(limit);
    let ftsRows: SessionSummary[] = [];
    if (this.ftsAvailable) {
      try {
        const stmt = this.db.prepare(`
          SELECT s.id, COALESCE(s.title, s.id) AS title, s.platform, s.user_key,
                 COALESCE(s.last_message_at, s.updated_at, s.created_at) AS saved_at,
                 (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS message_count,
                 snippet(session_fts, 4, '[', ']', '…', 18) AS snippet
          FROM session_fts
          JOIN sessions s ON s.id = session_fts.session_id
          WHERE session_fts MATCH ?
          GROUP BY s.id
          ORDER BY bm25(session_fts), saved_at DESC
          LIMIT ?
        `);
        stmt.bind([ftsQuery(trimmed), limit]);
        ftsRows = this.rowsToSummaries(stmt);
        stmt.free();
      } catch {
        this.ftsAvailable = false;
      }
    }

    const like = `%${escapeLike(trimmed)}%`;
    const stmt = this.db.prepare(`
      SELECT s.id, COALESCE(s.title, s.id) AS title, s.platform, s.user_key,
             COALESCE(s.last_message_at, s.updated_at, s.created_at) AS saved_at,
             (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS message_count,
             COALESCE(
               (SELECT content FROM messages m WHERE m.session_id = s.id AND m.content LIKE ? ESCAPE '\\' ORDER BY m.id DESC LIMIT 1),
               (SELECT tool_name || ': ' || COALESCE(result_preview, args_json, '') FROM tool_events te WHERE te.session_id = s.id AND (te.tool_name LIKE ? ESCAPE '\\' OR te.result_preview LIKE ? ESCAPE '\\' OR te.args_json LIKE ? ESCAPE '\\') ORDER BY te.id DESC LIMIT 1),
               (SELECT label || ': ' || COALESCE(result_preview, '') FROM evidence_items ei WHERE ei.session_id = s.id AND (ei.label LIKE ? ESCAPE '\\' OR ei.result_preview LIKE ? ESCAPE '\\') ORDER BY ei.id DESC LIMIT 1),
               s.title,
               ''
             ) AS snippet
      FROM sessions s
      WHERE s.title LIKE ? ESCAPE '\\'
         OR EXISTS (SELECT 1 FROM messages m WHERE m.session_id = s.id AND m.content LIKE ? ESCAPE '\\')
         OR EXISTS (SELECT 1 FROM tool_events te WHERE te.session_id = s.id AND (te.tool_name LIKE ? ESCAPE '\\' OR te.result_preview LIKE ? ESCAPE '\\' OR te.args_json LIKE ? ESCAPE '\\'))
         OR EXISTS (SELECT 1 FROM evidence_items ei WHERE ei.session_id = s.id AND (ei.label LIKE ? ESCAPE '\\' OR ei.result_preview LIKE ? ESCAPE '\\'))
      ORDER BY saved_at DESC
      LIMIT ?
    `);
    stmt.bind([
      like,
      like,
      like,
      like,
      like,
      like,
      like,
      like,
      like,
      like,
      like,
      like,
      like,
      limit,
    ]);
    const rows = this.rowsToSummaries(stmt);
    stmt.free();
    if (ftsRows.length === 0) return rows;
    const merged = [...ftsRows];
    const seen = new Set(ftsRows.map((row) => row.id));
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      merged.push(row);
    }
    return merged.slice(0, limit);
  }

  private rowsToSummaries(stmt: Statement): SessionSummary[] {
    const out: SessionSummary[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      const snippet = String(row.snippet || '')
        .replace(/\s+/g, ' ')
        .slice(0, 240);
      out.push({
        id: String(row.id || ''),
        title: String(row.title || row.id || ''),
        savedAt: String(row.saved_at || ''),
        messageCount: Number(row.message_count || 0),
        preview: snippet || '(empty)',
        snippet: snippet || undefined,
        platform: row.platform ? String(row.platform) : undefined,
        userKey: row.user_key ? String(row.user_key) : undefined,
      });
    }
    return out;
  }

  getLatestSession(filter?: string): SessionSummary | null {
    const rows = filter?.trim() ? this.searchSessions(filter, 1) : this.listSessions(1);
    return rows[0] || null;
  }

  loadSession(sessionId: string): Message[] {
    this.refreshForRead();
    return this.readSession(sessionId);
  }

  private readSession(sessionId: string): Message[] {
    const stmt = this.db.prepare(`
      SELECT id, role, content, tool_call_id, tool_calls_json, images_json
      FROM messages
      WHERE session_id = ?
      ORDER BY id ASC
    `);
    stmt.bind([sessionId]);
    const messages: Message[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      const role = String(row.role || 'user') as Message['role'];
      if (role !== 'user' && role !== 'assistant' && role !== 'tool' && role !== 'system') continue;
      const dbId = Number(row.id || 0);
      messages.push({
        dbId: dbId || undefined,
        stableId: dbId ? `db:${dbId}` : undefined,
        role,
        content: String(row.content || ''),
        toolCallId: row.tool_call_id ? String(row.tool_call_id) : undefined,
        toolCalls: parseJson<ToolCall[] | undefined>(row.tool_calls_json, undefined),
        images: parseJson<string[] | undefined>(row.images_json, undefined),
      });
    }
    stmt.free();
    return messages;
  }

  loadSessionPage(sessionId: string, options: { beforeId?: number; limit?: number } = {}): MessagePage {
    this.refreshForRead();
    const limit = Math.max(1, Math.min(500, Math.floor(options.limit ?? 80)));
    const params: unknown[] = [sessionId];
    let cursorClause = '';
    if (typeof options.beforeId === 'number' && Number.isFinite(options.beforeId)) {
      cursorClause = 'AND id < ?';
      params.push(options.beforeId);
    }
    params.push(limit + 1);
    const stmt = this.db.prepare(`
      SELECT id, role, content, tool_call_id, tool_calls_json, images_json
      FROM messages
      WHERE session_id = ? ${cursorClause}
      ORDER BY id DESC
      LIMIT ?
    `);
    stmt.bind(params as any[]);
    const rows: Message[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      const role = String(row.role || 'user') as Message['role'];
      if (role !== 'user' && role !== 'assistant' && role !== 'tool' && role !== 'system') continue;
      const dbId = Number(row.id || 0);
      rows.push({
        dbId: dbId || undefined,
        stableId: dbId ? `db:${dbId}` : undefined,
        role,
        content: String(row.content || ''),
        toolCallId: row.tool_call_id ? String(row.tool_call_id) : undefined,
        toolCalls: parseJson<ToolCall[] | undefined>(row.tool_calls_json, undefined),
        images: parseJson<string[] | undefined>(row.images_json, undefined),
      });
    }
    stmt.free();
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).reverse();
    const oldest = page.find((m) => typeof m.dbId === 'number');
    return {
      messages: page,
      oldestCursor: oldest?.dbId,
      hasMore,
    };
  }

  saveSnapshot(sessionId: string, messages: Message[], meta: Partial<SessionMeta> = {}): void {
    this.withWriteLock(() => {
      const ts = nowIso();
      const sessionStmt = this.db.prepare(`
        INSERT INTO sessions (id, title, platform, user_key, channel_id, model, provider, cwd, status, created_at, updated_at, last_message_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = COALESCE(excluded.title, sessions.title),
          platform = COALESCE(excluded.platform, sessions.platform),
          user_key = COALESCE(excluded.user_key, sessions.user_key),
          channel_id = COALESCE(excluded.channel_id, sessions.channel_id),
          model = COALESCE(excluded.model, sessions.model),
          provider = COALESCE(excluded.provider, sessions.provider),
          cwd = COALESCE(excluded.cwd, sessions.cwd),
          status = COALESCE(excluded.status, sessions.status),
          updated_at = excluded.updated_at
      `);
      sessionStmt.run([
        sessionId,
        meta.title || null,
        meta.platform || null,
        meta.userKey || null,
        meta.channelId || null,
        meta.model || null,
        meta.provider || null,
        meta.cwd || process.cwd(),
        meta.status || 'active',
        ts,
        ts,
        ts,
      ]);
      sessionStmt.free();

      const existing = this.readSession(sessionId);
      if (existing.length === 0) {
        const turnId = `snapshot-${Date.now()}`;
        for (const message of messages.filter((item) => item.role !== 'system')) {
          const createdAt = nowIso();
          const content = redactSessionText(message.content || '');
          const stmt = this.db.prepare(`
            INSERT INTO messages (session_id, turn_id, role, content, tool_call_id, tool_calls_json, images_json, metadata_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);
          stmt.run([
            sessionId,
            turnId,
            message.role,
            content,
            message.toolCallId || null,
            safeJson(message.toolCalls),
            safeJson(message.images),
            null,
            createdAt,
          ]);
          const id = this.db.exec('SELECT last_insert_rowid() AS id')[0]?.values?.[0]?.[0];
          stmt.free();
          this.indexText(sessionId, 'message', String(id || ''), undefined, content, createdAt);
        }
        this.db.run('UPDATE sessions SET updated_at = ?, last_message_at = ? WHERE id = ?', [
          ts,
          ts,
          sessionId,
        ]);
      }

      const title = meta.title || (existing.length === 0 && messages.length > 0
        ? firstUserPreview(messages)
        : undefined);
      if (title) {
        this.db.run('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?', [
          title,
          ts,
          sessionId,
        ]);
        this.indexText(sessionId, 'session', sessionId, title, title, ts);
      }
    });
  }
}
