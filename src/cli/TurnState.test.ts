// @ts-ignore Bun injects this module in the test runner; production typecheck excludes its ambient types.
import { describe, expect, test } from 'bun:test';
import type { AgentEvent } from '../agent/AgentLoop.js';
import { applyAgentEvent, createPresentationState, startUserTurn } from './TurnState.js';

const at = (ms: number) => new Date(ms);
const event = (patch: Partial<AgentEvent> & Pick<AgentEvent, 'type'>): AgentEvent => ({ data: '', ...patch });

describe('presentation turn state helpers', () => {
  test('coalesces adjacent assistant text chunks into one flat visual message', () => {
    let state = startUserTurn(createPresentationState(), 'hello', { now: at(1), turnId: 't1' });
    state = applyAgentEvent(state, event({ type: 'text', data: 'Hel', turnId: 't1' }), { now: at(2), model: 'm' });
    state = applyAgentEvent(state, event({ type: 'text', data: 'lo', turnId: 't1' }), { now: at(3), model: 'm' });

    expect(state.messages.map((m) => [m.role, m.content])).toEqual([
      ['user', 'hello'],
      ['assistant', 'Hello'],
    ]);
    expect(state.currentTurn?.parts).toHaveLength(1);
    expect(state.currentTurn?.parts[0]).toMatchObject({ kind: 'text', content: 'Hello' });
  });

  test('updates a tool from start to chunks to end by stable tool call id', () => {
    let state = startUserTurn(createPresentationState(), 'run', { now: at(1), turnId: 't1' });
    state = applyAgentEvent(state, event({ type: 'tool_start', toolName: 'bash', toolCallId: 'call_1', toolArgs: { command: 'pwd' }, turnId: 't1' }), { now: at(2) });
    state = applyAgentEvent(state, event({ type: 'tool_chunk', toolName: 'bash', toolCallId: 'call_1', data: 'line 1\n', turnId: 't1' }), { now: at(3) });
    state = applyAgentEvent(state, event({ type: 'tool_chunk', toolName: 'bash', toolCallId: 'call_1', data: 'line 2', turnId: 't1' }), { now: at(4) });
    state = applyAgentEvent(state, event({ type: 'tool_end', toolName: 'bash', toolCallId: 'call_1', data: 'done', status: 'success', durationMs: 42, turnId: 't1' }), { now: at(5) });

    expect(state.currentTurn?.toolCount).toBe(1);
    expect(state.currentTurn?.activeToolIds).toEqual([]);
    expect(state.currentTurn?.parts[0]).toMatchObject({ kind: 'tool', id: 'call_1', content: 'line 1\nline 2\ndone', status: 'success', durationMs: 42 });
    expect(state.messages).toHaveLength(2);
    expect(state.messages[1].role).toBe('tool');
    expect(state.messages[1].content).toContain('line 1\nline 2\ndone');
  });

  test('records errors as assistant-compatible flat messages without merging into text', () => {
    let state = startUserTurn(createPresentationState(), 'bad', { now: at(1), turnId: 't1' });
    state = applyAgentEvent(state, event({ type: 'text', data: 'Before.', turnId: 't1' }), { now: at(2) });
    state = applyAgentEvent(state, event({ type: 'error', data: 'boom', turnId: 't1' }), { now: at(3) });
    state = applyAgentEvent(state, event({ type: 'text', data: 'After.', turnId: 't1' }), { now: at(4) });

    expect(state.messages.map((m) => [m.role, m.content])).toEqual([
      ['user', 'bad'],
      ['assistant', 'Before.'],
      ['assistant', 'Error: boom'],
      ['assistant', 'After.'],
    ]);
    expect(state.currentTurn?.parts.map((p) => p.kind)).toEqual(['text', 'error', 'text']);
  });

  test('keeps multiple tools separate and updates interleaved chunks by call id', () => {
    let state = startUserTurn(createPresentationState(), 'multi', { now: at(1), turnId: 't1' });
    state = applyAgentEvent(state, event({ type: 'tool_start', toolName: 'read', toolCallId: 'a', turnId: 't1' }), { now: at(2) });
    state = applyAgentEvent(state, event({ type: 'tool_start', toolName: 'grep', toolCallId: 'b', turnId: 't1' }), { now: at(3) });
    state = applyAgentEvent(state, event({ type: 'tool_chunk', toolName: 'grep', toolCallId: 'b', data: 'grep out', turnId: 't1' }), { now: at(4) });
    state = applyAgentEvent(state, event({ type: 'tool_chunk', toolName: 'read', toolCallId: 'a', data: 'read out', turnId: 't1' }), { now: at(5) });
    state = applyAgentEvent(state, event({ type: 'tool_end', toolName: 'read', toolCallId: 'a', status: 'success', turnId: 't1' }), { now: at(6) });
    state = applyAgentEvent(state, event({ type: 'tool_end', toolName: 'grep', toolCallId: 'b', status: 'success', turnId: 't1' }), { now: at(7) });
    state = applyAgentEvent(state, event({ type: 'done', durationMs: 99, turnId: 't1' }), { now: at(8) });

    const tools = state.currentTurn?.parts.filter((p) => p.kind === 'tool') || [];
    expect(tools).toHaveLength(2);
    expect(tools[0]).toMatchObject({ id: 'a', content: 'read out' });
    expect(tools[1]).toMatchObject({ id: 'b', content: 'grep out' });
    expect(state.currentTurn?.completed).toEqual({ model: undefined, durationMs: 99, toolCount: 2 });
    expect(state.messages.at(-1)?.content).toBe('Model: unknown · Duration: 99ms · Tools: 2');
  });

  test('does not merge assistant chunks across user turns', () => {
    let state = startUserTurn(createPresentationState(), 'one', { now: at(1), turnId: 't1' });
    state = applyAgentEvent(state, event({ type: 'text', data: 'First', turnId: 't1' }), { now: at(2) });
    state = startUserTurn(state, 'two', { now: at(3), turnId: 't2' });
    state = applyAgentEvent(state, event({ type: 'text', data: 'Second', turnId: 't2' }), { now: at(4) });

    expect(state.messages.map((m) => [m.role, m.content])).toEqual([
      ['user', 'one'],
      ['assistant', 'First'],
      ['user', 'two'],
      ['assistant', 'Second'],
    ]);
    expect(state.currentTurn?.turnId).toBe('t2');
    expect(state.currentTurn?.parts).toHaveLength(1);
  });
});
