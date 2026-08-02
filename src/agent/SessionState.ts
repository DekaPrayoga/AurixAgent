import fs from 'fs';
import os from 'os';
import path from 'path';

export interface SessionTodo {
  id: number;
  text: string;
  done: boolean;
}

export interface DurableSessionState {
  todos: SessionTodo[];
  goal: string | null;
  rules: string[];
  btwMessages: string[];
}

const ROOT = path.join(os.homedir(), '.aurix', 'session-state');

export function emptySessionState(): DurableSessionState {
  return { todos: [], goal: null, rules: [], btwMessages: [] };
}

function statePath(sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180);
  return path.join(ROOT, `${safe}.json`);
}

function normalize(value: unknown): DurableSessionState {
  if (!value || typeof value !== 'object') return emptySessionState();
  const input = value as Record<string, unknown>;
  const todos = Array.isArray(input.todos)
    ? input.todos.filter((item): item is SessionTodo => Boolean(item) && typeof item === 'object' && Number.isInteger((item as SessionTodo).id) && typeof (item as SessionTodo).text === 'string' && typeof (item as SessionTodo).done === 'boolean')
    : [];
  return {
    todos,
    goal: typeof input.goal === 'string' ? input.goal : null,
    rules: Array.isArray(input.rules) ? input.rules.filter((item): item is string => typeof item === 'string') : [],
    btwMessages: Array.isArray(input.btwMessages) ? input.btwMessages.filter((item): item is string => typeof item === 'string') : [],
  };
}

export function loadSessionState(sessionId: string): DurableSessionState {
  try {
    return normalize(JSON.parse(fs.readFileSync(statePath(sessionId), 'utf8')));
  } catch {
    return emptySessionState();
  }
}

export function saveSessionState(sessionId: string, state: DurableSessionState): void {
  fs.mkdirSync(ROOT, { recursive: true });
  const target = statePath(sessionId);
  const temp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(normalize(state), null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temp, target);
}

export function loadSessionTodos(sessionId: string): SessionTodo[] {
  return loadSessionState(sessionId).todos;
}

export function saveSessionTodos(sessionId: string, todos: SessionTodo[]): void {
  saveSessionState(sessionId, { ...loadSessionState(sessionId), todos });
}
