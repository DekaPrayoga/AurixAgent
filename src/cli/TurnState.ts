import type { AgentEvent } from '../agent/AgentLoop.js';

export type PresentationRole = 'user' | 'assistant' | 'tool' | 'system';

export interface FlatChatMessage {
  role: PresentationRole;
  content: string;
  toolName?: string;
  model?: string;
  timestamp: Date;
  checkpointId?: string;
}

export type VisualPartKind = 'text' | 'tool' | 'error' | 'route' | 'compact' | 'research';

export interface ToolLifecyclePart {
  kind: 'tool';
  id: string;
  toolCallId?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  content: string;
  chunks: string[];
  status: 'running' | 'success' | 'error' | 'timeout' | 'cancelled';
  startedAt: Date;
  endedAt?: Date;
  durationMs?: number;
  errorType?: string;
}

export interface TextVisualPart {
  kind: 'text';
  content: string;
  model?: string;
  startedAt: Date;
  updatedAt: Date;
}

export interface NonTextVisualPart {
  kind: Exclude<VisualPartKind, 'text' | 'tool'>;
  content: string;
  toolName?: string;
  timestamp: Date;
}

export type VisualPart = TextVisualPart | ToolLifecyclePart | NonTextVisualPart;

export interface CompletionMetadata {
  model?: string;
  durationMs?: number;
  toolCount: number;
}

export interface PresentationTurnState {
  turnId?: string;
  startedAt: Date;
  updatedAt: Date;
  parts: VisualPart[];
  activeToolIds: string[];
  toolCount: number;
  completed?: CompletionMetadata;
}

export interface PresentationState {
  messages: FlatChatMessage[];
  baseMessages: FlatChatMessage[];
  currentTurn?: PresentationTurnState;
}

export interface ApplyEventOptions {
  model?: string;
  now?: Date;
  renderToolEnd?: (event: AgentEvent) => string;
}

const DEFAULT_TOOL_END_RENDERER = (event: AgentEvent): string => {
  const name = event.toolName || 'tool';
  const status = event.status || (event.errorType ? 'error' : 'success');
  const duration = typeof event.durationMs === 'number' ? ` (${event.durationMs}ms)` : '';
  const error = event.errorType ? ` [${event.errorType}]` : '';
  return `${name} ${status}${duration}${error}`;
};

function cloneState(state: PresentationState): PresentationState {
  return {
    messages: state.messages.slice(),
    baseMessages: (state.baseMessages || state.messages).slice(),
    currentTurn: state.currentTurn
      ? {
          ...state.currentTurn,
          parts: state.currentTurn.parts.map((part) =>
            part.kind === 'tool' ? { ...part, chunks: part.chunks.slice() } : { ...part }
          ),
          activeToolIds: state.currentTurn.activeToolIds.slice(),
          completed: state.currentTurn.completed ? { ...state.currentTurn.completed } : undefined,
        }
      : undefined,
  };
}

function ensureTurn(state: PresentationState, event: AgentEvent, now: Date): PresentationTurnState {
  if (state.currentTurn && (!event.turnId || !state.currentTurn.turnId || state.currentTurn.turnId === event.turnId)) {
    state.currentTurn.updatedAt = now;
    if (!state.currentTurn.turnId && event.turnId) state.currentTurn.turnId = event.turnId;
    return state.currentTurn;
  }

  state.currentTurn = {
    turnId: event.turnId,
    startedAt: now,
    updatedAt: now,
    parts: [],
    activeToolIds: [],
    toolCount: 0,
  };
  return state.currentTurn;
}

function fallbackToolId(turn: PresentationTurnState, event: AgentEvent): string {
  if (event.toolCallId) return event.toolCallId;
  const name = event.toolName || 'tool';
  const running = [...turn.parts].reverse().find(
    (part): part is ToolLifecyclePart => part.kind === 'tool' && part.toolName === name && part.status === 'running'
  );
  return running?.id || `${name}:${turn.toolCount + 1}`;
}

function findTool(turn: PresentationTurnState, event: AgentEvent): ToolLifecyclePart | undefined {
  if (event.toolCallId) {
    const byCallId = turn.parts.find(
      (part): part is ToolLifecyclePart => part.kind === 'tool' && part.toolCallId === event.toolCallId
    );
    if (byCallId) return byCallId;
  }
  const id = fallbackToolId(turn, event);
  return turn.parts.find((part): part is ToolLifecyclePart => part.kind === 'tool' && part.id === id);
}

function upsertTool(turn: PresentationTurnState, event: AgentEvent, now: Date): ToolLifecyclePart {
  const existing = findTool(turn, event);
  if (existing) {
    existing.toolName = event.toolName || existing.toolName;
    existing.args = event.toolArgs || existing.args;
    return existing;
  }

  const id = fallbackToolId(turn, event);
  const tool: ToolLifecyclePart = {
    kind: 'tool',
    id,
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    args: event.toolArgs,
    content: '',
    chunks: [],
    status: 'running',
    startedAt: now,
  };
  turn.parts.push(tool);
  turn.activeToolIds.push(id);
  turn.toolCount += 1;
  return tool;
}

export function startUserTurn(
  state: PresentationState,
  content: string,
  options: { now?: Date; turnId?: string } = {}
): PresentationState {
  const next = cloneState(state);
  const now = options.now || new Date();
  next.baseMessages = flattenPresentationState(next);
  next.baseMessages.push({ role: 'user', content, timestamp: now });
  next.messages = next.baseMessages.slice();
  next.currentTurn = {
    turnId: options.turnId,
    startedAt: now,
    updatedAt: now,
    parts: [],
    activeToolIds: [],
    toolCount: 0,
  };
  return next;
}

export function applyAgentEvent(
  state: PresentationState,
  event: AgentEvent,
  options: ApplyEventOptions = {}
): PresentationState {
  const next = cloneState(state);
  const now = options.now || new Date();
  const turn = ensureTurn(next, event, now);
  const renderToolEnd = options.renderToolEnd || DEFAULT_TOOL_END_RENDERER;

  switch (event.type) {
    case 'text': {
      const last = turn.parts[turn.parts.length - 1];
      if (last?.kind === 'text') {
        last.content += event.data;
        last.updatedAt = now;
      } else {
        turn.parts.push({ kind: 'text', content: event.data, model: options.model, startedAt: now, updatedAt: now });
      }
      break;
    }
    case 'tool_start': {
      upsertTool(turn, event, now);
      break;
    }
    case 'tool_chunk': {
      const tool = upsertTool(turn, event, now);
      if (event.data) {
        tool.chunks.push(event.data);
        tool.content += event.data;
      }
      break;
    }
    case 'tool_end': {
      const tool = upsertTool(turn, event, now);
      if (event.data && !tool.content.endsWith(event.data)) {
        tool.content = tool.content ? `${tool.content}\n${event.data}` : event.data;
      }
      tool.status = event.status || (event.errorType ? 'error' : 'success');
      tool.durationMs = event.durationMs;
      tool.errorType = event.errorType;
      tool.endedAt = now;
      turn.activeToolIds = turn.activeToolIds.filter((id) => id !== tool.id);
      break;
    }
    case 'error':
      turn.parts.push({ kind: 'error', content: `Error: ${event.data}`, timestamp: now });
      break;
    case 'route':
      turn.parts.push({ kind: 'route', content: event.data, toolName: `route:${event.toolName || 'native'}`, timestamp: now });
      break;
    case 'compact':
      turn.parts.push({ kind: 'compact', content: event.data, toolName: 'context-compact', timestamp: now });
      break;
    case 'research':
      turn.parts.push({ kind: 'research', content: event.data, toolName: event.toolName, timestamp: now });
      break;
    case 'done':
      turn.completed = { model: options.model, durationMs: event.durationMs, toolCount: turn.toolCount };
      break;
  }

  turn.updatedAt = now;
  next.messages = flattenPresentationState(next, { model: options.model, renderToolEnd });
  return next;
}

export function flattenPresentationState(
  state: PresentationState,
  options: Pick<ApplyEventOptions, 'model' | 'renderToolEnd'> = {}
): FlatChatMessage[] {
  const messages = (state.baseMessages || state.messages).slice();
  const turn = state.currentTurn;
  if (!turn) return messages;

  const renderToolEnd = options.renderToolEnd || DEFAULT_TOOL_END_RENDERER;
  for (const part of turn.parts) {
    if (part.kind === 'text') {
      messages.push({ role: 'assistant', content: part.content, model: part.model || options.model, timestamp: part.startedAt });
    } else if (part.kind === 'tool') {
      const endEvent: AgentEvent = {
        type: 'tool_end',
        data: part.content,
        toolName: part.toolName,
        toolArgs: part.args,
        toolCallId: part.toolCallId,
        durationMs: part.durationMs,
        status: part.status,
        errorType: part.errorType,
      };
      const header = part.status === 'running' ? `${part.toolName || 'tool'} running` : renderToolEnd(endEvent);
      const body = part.content ? `\n\n${part.content}` : '';
      messages.push({ role: 'tool', content: `${header}${body}`, toolName: part.toolName, timestamp: part.startedAt });
    } else {
      messages.push({ role: part.kind === 'error' ? 'assistant' : 'tool', content: part.content, toolName: part.toolName, timestamp: part.timestamp });
    }
  }

  if (turn.completed) {
    const model = turn.completed.model || options.model || 'unknown';
    const duration = typeof turn.completed.durationMs === 'number' ? `${turn.completed.durationMs}ms` : 'unknown';
    messages.push({
      role: 'system',
      content: `Model: ${model} · Duration: ${duration} · Tools: ${turn.completed.toolCount}`,
      timestamp: turn.updatedAt,
    });
  }

  return messages;
}

export function createPresentationState(messages: FlatChatMessage[] = []): PresentationState {
  return { messages: messages.slice(), baseMessages: messages.slice() };
}
