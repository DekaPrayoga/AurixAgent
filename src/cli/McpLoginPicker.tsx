import React, { useMemo, useState } from 'react';
import { TextAttributes } from '@opentui/core';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import type { McpServerState } from '../mcp/McpRegistry.js';
import { safeDisplayText } from '../utils/terminal-sanitize.js';
import { theme } from './theme.js';

export interface McpLoginPickerItem {
  name: string;
  description?: string;
  state: McpServerState;
}

export function selectMcpLoginCandidates(
  servers: Array<{
    name: string;
    enabled: boolean;
    type: 'stdio' | 'http';
    auth?: 'none' | 'oauth' | 'bearer';
    description?: string;
  }>,
  states: Array<{ name: string; state: McpServerState }>
): McpLoginPickerItem[] {
  const stateByName = new Map(states.map((server) => [server.name, server.state]));
  const priority: Record<McpServerState, number> = {
    'authentication-required': 0,
    failed: 1,
    stopped: 2,
    connecting: 3,
    authenticating: 4,
    connected: 5,
    disabled: 6,
  };
  return servers
    .filter((server) => server.enabled && server.type === 'http' && server.auth === 'oauth')
    .map((server) => ({
      name: server.name,
      description: server.description,
      state: stateByName.get(server.name) || 'stopped',
    }))
    .sort((left, right) => priority[left.state] - priority[right.state] || left.name.localeCompare(right.name));
}

interface McpLoginPickerProps {
  action: 'login' | 'reauth';
  items: McpLoginPickerItem[];
  onSelect: (name: string) => void;
  onCancel: () => void;
}

export function McpLoginPicker({ action, items, onSelect, onCancel }: McpLoginPickerProps) {
  const { width, height } = useTerminalDimensions();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) => `${item.name} ${item.description || ''} ${item.state}`.toLowerCase().includes(needle));
  }, [items, query]);
  const visibleCount = Math.max(4, Math.min(12, Math.floor(height / 2) - 6));

  React.useEffect(() => {
    setSelected((value) => Math.min(value, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  useKeyboard((event) => {
    const consume = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    if (event.name === 'escape') {
      consume();
      onCancel();
      return;
    }
    if (event.name === 'up' || (event.ctrl && event.name === 'p')) {
      consume();
      setSelected((value) => filtered.length ? (value - 1 + filtered.length) % filtered.length : 0);
      return;
    }
    if (event.name === 'down' || (event.ctrl && event.name === 'n')) {
      consume();
      setSelected((value) => filtered.length ? (value + 1) % filtered.length : 0);
      return;
    }
    if (event.name === 'pageup' || event.name === 'pagedown') {
      consume();
      const delta = event.name === 'pageup' ? -visibleCount : visibleCount;
      setSelected((value) => Math.max(0, Math.min(value + delta, filtered.length - 1)));
      return;
    }
    if (event.name === 'return') {
      consume();
      const item = filtered[selected];
      if (item) onSelect(item.name);
      return;
    }
    if (event.name === 'backspace') {
      consume();
      setQuery((value) => value.slice(0, -1));
      return;
    }
    if (event.sequence?.length === 1 && !event.ctrl && !event.meta) {
      const character = event.sequence;
      if (character >= ' ' && character !== '\x7f') {
        consume();
        setQuery((value) => value + character);
      }
    }
  });

  const modalWidth = Math.max(36, Math.min(68, width - 4));
  const start = Math.max(0, Math.min(selected - Math.floor(visibleCount / 2), Math.max(0, filtered.length - visibleCount)));
  const visible = filtered.slice(start, start + visibleCount);

  return (
    <box
      position="absolute"
      top={Math.max(1, Math.floor(height / 4))}
      left={Math.max(2, Math.floor((width - modalWidth) / 2))}
      width={modalWidth}
      flexDirection="column"
      backgroundColor={theme.bgPanel}
      border
      borderColor={theme.borderActive}
      zIndex={225}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
    >
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.textBright} attributes={TextAttributes.BOLD}>Select MCP server to {action}</text>
        <text fg={theme.textMuted}>esc</text>
      </box>
      <box height={1} />
      <box flexDirection="row">
        <text fg={theme.textMuted}>Search  </text>
        <text fg={theme.text}>{safeDisplayText(query)}</text>
        <text fg={theme.primary}>█</text>
      </box>
      <box height={1} />
      {filtered.length === 0 && <text fg={theme.textMuted}>No matching OAuth MCP servers.</text>}
      {visible.map((item, index) => {
        const absoluteIndex = start + index;
        const active = absoluteIndex === selected;
        return (
          <box
            key={item.name}
            flexDirection="column"
            backgroundColor={active ? theme.bgSelected : undefined}
            paddingLeft={1}
            paddingRight={1}
            onMouseDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.stopPropagation();
              onSelect(item.name);
            }}
          >
            <text fg={active ? theme.textBright : theme.text} attributes={active ? TextAttributes.BOLD : TextAttributes.NONE}>
              {active ? '> ' : '  '}{safeDisplayText(item.name)} <span style={{ fg: theme.textMuted }}>({item.state})</span>
            </text>
            {item.description && <text fg={theme.textMuted}>    {safeDisplayText(item.description).slice(0, 54)}</text>}
          </box>
        );
      })}
      <box height={1} />
      <text fg={theme.textMuted}>type to filter · ↑/↓ navigate · Enter select · Esc cancel</text>
    </box>
  );
}
