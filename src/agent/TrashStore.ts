import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

const TRASH_DIR = path.join(os.homedir(), '.aurix', 'trash');
const COUNTERS_FILE = path.join(TRASH_DIR, 'user-turn-counters.json');
export const TRASH_RECOVERY_USER_TURNS = 5;

export type TrashEntryType = 'file' | 'folder';
export type TrashEntryStatus = 'recoverable' | 'recovered' | 'expired' | 'purged';

export interface TrashEntry {
  id: string;
  type: TrashEntryType;
  originalPath: string;
  trashPath: string;
  sessionId: string;
  turnId?: string;
  sessionKey?: string;
  deletedAtUserTurn: number;
  expiresAfterUserTurns: number;
  createdAt: string;
  updatedAt: string;
  status: TrashEntryStatus;
}

function ensureTrashDir(): void {
  if (!fs.existsSync(TRASH_DIR)) fs.mkdirSync(TRASH_DIR, { recursive: true });
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, value: unknown): void {
  ensureTrashDir();
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf-8');
}

function entryDir(id: string): string {
  return path.join(TRASH_DIR, id);
}

function manifestPath(id: string): string {
  return path.join(entryDir(id), 'manifest.json');
}

function payloadRoot(id: string): string {
  return path.join(entryDir(id), 'payload');
}

function currentTurn(sessionId: string): number {
  const counters = readJson<Record<string, number>>(COUNTERS_FILE, {});
  return counters[sessionId] || 0;
}

export function recordTrashUserTurn(sessionId: string): number {
  ensureTrashDir();
  const counters = readJson<Record<string, number>>(COUNTERS_FILE, {});
  counters[sessionId] = (counters[sessionId] || 0) + 1;
  writeJson(COUNTERS_FILE, counters);
  purgeExpiredTrash(sessionId);
  return counters[sessionId];
}

function saveEntry(entry: TrashEntry): void {
  writeJson(manifestPath(entry.id), entry);
}

export function listTrashEntries(
  filter: { sessionId?: string; includeExpired?: boolean } = {}
): TrashEntry[] {
  ensureTrashDir();
  const ids = fs.readdirSync(TRASH_DIR).filter((name) => name.startsWith('del_'));
  const entries = ids
    .map((id) => readJson<TrashEntry | null>(manifestPath(id), null))
    .filter((entry): entry is TrashEntry => Boolean(entry));
  return entries
    .filter((entry) => !filter.sessionId || entry.sessionId === filter.sessionId)
    .filter((entry) => filter.includeExpired || entry.status === 'recoverable')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getTrashEntry(idOrPath: string, sessionId?: string): TrashEntry | null {
  const direct = readJson<TrashEntry | null>(manifestPath(idOrPath), null);
  if (direct && (!sessionId || direct.sessionId === sessionId)) return direct;
  const resolved = path.resolve(idOrPath);
  return (
    listTrashEntries({ sessionId, includeExpired: true }).find(
      (entry) =>
        entry.id === idOrPath || entry.originalPath === resolved || entry.originalPath === idOrPath
    ) || null
  );
}

export function remainingRecoveryTurns(entry: TrashEntry): number {
  const used = currentTurn(entry.sessionId) - entry.deletedAtUserTurn;
  return Math.max(0, entry.expiresAfterUserTurns - used);
}

export function isTrashEntryRecoverable(entry: TrashEntry): boolean {
  return (
    entry.status === 'recoverable' &&
    remainingRecoveryTurns(entry) > 0 &&
    fs.existsSync(entry.trashPath)
  );
}

export function moveToTrash(input: {
  targetPath: string;
  type: TrashEntryType;
  sessionId?: string;
  turnId?: string;
  sessionKey?: string;
}): TrashEntry {
  ensureTrashDir();
  const originalPath = path.resolve(input.targetPath);
  const id = `del_${new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, '')
    .slice(0, 14)}_${crypto.randomBytes(4).toString('hex')}`;
  const payload = payloadRoot(id);
  fs.mkdirSync(payload, { recursive: true });
  const trashPath = path.join(payload, path.basename(originalPath));
  fs.renameSync(originalPath, trashPath);
  const ts = new Date().toISOString();
  const sessionId = input.sessionId || input.sessionKey || 'default';
  const entry: TrashEntry = {
    id,
    type: input.type,
    originalPath,
    trashPath,
    sessionId,
    turnId: input.turnId,
    sessionKey: input.sessionKey,
    deletedAtUserTurn: currentTurn(sessionId),
    expiresAfterUserTurns: TRASH_RECOVERY_USER_TURNS,
    createdAt: ts,
    updatedAt: ts,
    status: 'recoverable',
  };
  saveEntry(entry);
  return entry;
}

export function recoverTrashEntry(idOrPath: string, options: { sessionId?: string } = {}): string {
  const entry = getTrashEntry(idOrPath, options.sessionId);
  if (!entry) return `No deleted file/folder found for: ${idOrPath}`;
  if (!isTrashEntryRecoverable(entry)) {
    return `Recovery expired or unavailable for ${entry.id}: ${entry.originalPath}`;
  }
  if (fs.existsSync(entry.originalPath)) {
    return `Cannot recover ${entry.id}: original path already exists: ${entry.originalPath}`;
  }
  fs.mkdirSync(path.dirname(entry.originalPath), { recursive: true });
  fs.renameSync(entry.trashPath, entry.originalPath);
  entry.status = 'recovered';
  entry.updatedAt = new Date().toISOString();
  saveEntry(entry);
  return `Recovered ${entry.type}: ${entry.originalPath}\nRecovery ID: ${entry.id}`;
}

export function purgeExpiredTrash(sessionId?: string): number {
  let purged = 0;
  for (const entry of listTrashEntries({ sessionId, includeExpired: true })) {
    if (entry.status !== 'recoverable' || remainingRecoveryTurns(entry) > 0) continue;
    try {
      if (fs.existsSync(entryDir(entry.id)))
        fs.rmSync(entryDir(entry.id), { recursive: true, force: true });
      purged += 1;
    } catch {
      entry.status = 'expired';
      entry.updatedAt = new Date().toISOString();
      saveEntry(entry);
    }
  }
  return purged;
}

export function formatTrashList(sessionId?: string): string {
  const entries = listTrashEntries({ sessionId }).filter(isTrashEntryRecoverable);
  if (entries.length === 0) return 'Trash is empty. No recoverable deleted files/folders.';
  return entries
    .map((entry, index) => {
      const remaining = remainingRecoveryTurns(entry);
      return `${index + 1}. ${entry.id} — ${entry.type}\n   Path: ${entry.originalPath}\n   Recoverable for: ${remaining} user chat${remaining === 1 ? '' : 's'}\n   Recover: /trash recover ${entry.id}`;
    })
    .join('\n\n');
}
