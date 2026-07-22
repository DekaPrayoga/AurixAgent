import type { Message } from '../providers/index.js';
import type { ChatMessage } from './ChatArea.js';

export const RESUME_DISPLAY_PAGE_SIZE = 80;

export interface ResumeDisplayPageState {
  sessionId: string;
  oldestCursor?: number;
  hasMore: boolean;
  loading: boolean;
  generation: number;
}

export function stableMessageId(message: Message, sessionId: string, originalIndex: number): string {
  if (message.stableId) return message.stableId;
  if (typeof message.dbId === 'number') return `db:${message.dbId}`;
  return `legacy:${sessionId}:${originalIndex}`;
}

export function buildResumedDisplayMessages(
  messages: Message[],
  sessionId: string,
  options: { startIndex?: number; maxMessages?: number } = {}
): ChatMessage[] {
  const maxMessages = options.maxMessages ?? RESUME_DISPLAY_PAGE_SIZE;
  const baseIndex = options.startIndex ?? 0;
  return messages
    .map((message, offset) => ({ message, originalIndex: baseIndex + offset }))
    .filter(({ message }) => message.role !== 'system')
    .slice(-maxMessages)
    .map(({ message, originalIndex }) => ({
      id: stableMessageId(message, sessionId, originalIndex),
      role: message.role as ChatMessage['role'],
      content: message.content || '',
      timestamp: new Date(),
    }));
}

export function createResumePageState(sessionId: string, oldestCursor: number | undefined, hasMore: boolean): ResumeDisplayPageState {
  return { sessionId, oldestCursor, hasMore, loading: false, generation: 0 };
}

export function beginResumePageLoad(state: ResumeDisplayPageState): { state: ResumeDisplayPageState; request?: { sessionId: string; beforeId?: number; generation: number } } {
  if (state.loading || !state.hasMore) return { state };
  const next = { ...state, loading: true, generation: state.generation + 1 };
  return { state: next, request: { sessionId: state.sessionId, beforeId: state.oldestCursor, generation: next.generation } };
}

export function acceptResumePageLoad(
  state: ResumeDisplayPageState,
  result: { sessionId: string; generation: number; oldestCursor?: number; hasMore: boolean }
): ResumeDisplayPageState {
  if (result.sessionId !== state.sessionId || result.generation !== state.generation) return state;
  return { ...state, loading: false, oldestCursor: result.oldestCursor ?? state.oldestCursor, hasMore: result.hasMore };
}

export function resetResumePageState(state: ResumeDisplayPageState, sessionId: string, oldestCursor: number | undefined, hasMore: boolean): ResumeDisplayPageState {
  return { sessionId, oldestCursor, hasMore, loading: false, generation: state.generation + 1 };
}
