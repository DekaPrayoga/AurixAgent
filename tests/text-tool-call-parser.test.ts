import { describe, expect, test } from 'bun:test';
import { parseTextToolCalls } from '../src/agent/TextToolCallParser.js';

const allowed = new Set(['read_file', 'write_file', 'terminal']);

describe('text tool-call parser', () => {
  test('recovers consecutive JSON calls and hides raw payload', () => {
    const source = '#!/usr/bin/env python3\nprint("hello")\n'.repeat(100);
    const text = [
      'Gas. Baca script dulu, lalu upgrade full.',
      JSON.stringify({ name: 'read_file', arguments: { path: '/root/main/website2/github_mass_automation.py' } }),
      JSON.stringify({ name: 'write_file', arguments: { path: '/root/main/website2/github_mass_automation.py', content: source } }),
    ].join('\n');
    const result = parseTextToolCalls(text, allowed);
    expect(result.calls).toHaveLength(2);
    expect(result.calls[1]?.arguments.content).toBe(source);
    expect(result.visibleText).toBe('Gas. Baca script dulu, lalu upgrade full.');
    expect(result.visibleText).not.toContain('write_file');
  });

  test('does not execute JSON examples in fenced code', () => {
    const text = 'Example:\n```json\n{"name":"terminal","arguments":{"command":"pwd"}}\n```';
    const result = parseTextToolCalls(text, allowed);
    expect(result.calls).toHaveLength(0);
    expect(result.visibleText).toBe(text);
  });

  test('rejects unknown tools and suppresses recognized raw envelope', () => {
    const text = '{"name":"evil_tool","arguments":{"value":1}}';
    const result = parseTextToolCalls(text, allowed);
    expect(result.calls).toHaveLength(0);
    expect(result.recognizedProtocol).toBe(true);
    expect(result.requiresRepair).toBe(true);
    expect(result.visibleText).toBe('');
  });

  test('parses wrapped and OpenAI-ish calls', () => {
    const wrapped = parseTextToolCalls(
      JSON.stringify({ tool_calls: [{ name: 'terminal', arguments: { command: 'pwd' } }] }),
      allowed
    );
    expect(wrapped.calls[0]?.name).toBe('terminal');

    const openai = parseTextToolCalls(
      JSON.stringify({ function: { name: 'terminal', arguments: '{"command":"ls"}' } }),
      allowed
    );
    expect(openai.calls[0]?.arguments).toEqual({ command: 'ls' });
  });

  test('XML parsing remains deterministic across repeated calls', () => {
    const text = '<function=terminal>{"command":"pwd"}</function>';
    expect(parseTextToolCalls(text, allowed).calls).toHaveLength(1);
    expect(parseTextToolCalls(text, allowed).calls).toHaveLength(1);
  });

  test('supports alternate closers and hyphenated MCP tool names', () => {
    const result = parseTextToolCalls(
      '<tool_call><function=mcp-web-fetch>{"url":"https://example.com"}</function=mcp-web-fetch></tool_call>',
      new Set(['mcp-web-fetch'])
    );
    expect(result.calls).toEqual([{ name: 'mcp-web-fetch', arguments: { url: 'https://example.com' } }]);
    expect(result.visibleText).toBe('');
  });

  test('suppresses truncated XML and requests repair', () => {
    const result = parseTextToolCalls(
      'Checking now.\n<tool_call><function=terminal><parameter=command>pwd</parameter>',
      allowed
    );
    expect(result.calls).toHaveLength(0);
    expect(result.recognizedProtocol).toBe(true);
    expect(result.requiresRepair).toBe(true);
    expect(result.visibleText).toBe('Checking now.');
  });
});
