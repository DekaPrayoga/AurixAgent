import React, { useState } from 'react';
import { TextAttributes } from '@opentui/core';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { theme } from './theme.js';
import type { SlashCommand } from './commands.js';
import { safeDisplayText } from '../utils/terminal-sanitize.js';

interface CommandPaletteProps {
  commands: SlashCommand[];
  onSelect: (name: string) => void;
  onCancel: () => void;
}

const MAX_VISIBLE = 10;

// Lightweight fuzzy: every needle char must appear in order in the haystack.
// Returns a score (lower = better: tighter, earlier matches rank higher) or -1.
function fuzzyScore(needle: string, haystack: string): number {
  if (!needle) return 0;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  let hi = 0;
  let score = 0;
  let lastMatch = -1;
  for (let ni = 0; ni < n.length; ni++) {
    const c = n[ni];
    const found = h.indexOf(c, hi);
    if (found === -1) return -1;
    if (lastMatch !== -1) score += found - lastMatch; // gap penalty
    score += found; // earlier is better
    lastMatch = found;
    hi = found + 1;
  }
  return score;
}

export function CommandPalette({ commands, onSelect, onCancel }: CommandPaletteProps) {
  const { width: termWidth, height: termHeight } = useTerminalDimensions();
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState(0);

  const filtered = React.useMemo(() => {
    if (!filter) return commands;
    return commands
      .map(c => ({ c, s: fuzzyScore(filter, `${c.name} ${safeDisplayText(c.description)}`) }))
      .filter(x => x.s >= 0)
      .sort((a, b) => a.s - b.s)
      .map(x => x.c);
  }, [filter, commands]);

  // keep selection in range when filter changes
  React.useEffect(() => {
    setSelected(s => Math.min(s, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  useKeyboard((evt) => {
    const name = evt.name;
    if (name === 'escape') {
      evt.preventDefault();
      onCancel();
      return;
    }
    if (name === 'up' || (evt.ctrl && name === 'p')) {
      evt.preventDefault();
      setSelected(s => (s > 0 ? s - 1 : Math.max(0, filtered.length - 1)));
      return;
    }
    if (name === 'down' || (evt.ctrl && name === 'n')) {
      evt.preventDefault();
      setSelected(s => (s < filtered.length - 1 ? s + 1 : 0));
      return;
    }
    if (name === 'return') {
      evt.preventDefault();
      const cmd = filtered[selected];
      if (cmd) onSelect(cmd.name);
      return;
    }
    if (name === 'backspace') {
      evt.preventDefault();
      setFilter(f => f.slice(0, -1));
      return;
    }
    // printable chars build the filter
    if (evt.sequence && evt.sequence.length === 1 && !evt.ctrl && !evt.meta) {
      const ch = evt.sequence;
      if (ch >= ' ' && ch !== '\x7f') {
        evt.preventDefault();
        setFilter(f => f + ch);
      }
    }
  });

  const boxW = Math.min(72, termWidth - 4);
  const start = Math.max(0, Math.min(selected - Math.floor(MAX_VISIBLE / 2), Math.max(0, filtered.length - MAX_VISIBLE)));
  const visible = filtered.slice(start, start + MAX_VISIBLE);

  return (
    <box
      position="absolute"
      top={Math.max(1, Math.floor((termHeight - 18) / 2))}
      left={Math.max(2, Math.floor((termWidth - boxW) / 2))}
      width={boxW}
      flexDirection="column"
      backgroundColor={theme.bgPanel}
      border
      borderColor={theme.borderActive}
      zIndex={200}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
    >
      <text fg={theme.primary} attributes={TextAttributes.BOLD}>⌘ Command palette</text>
      <box height={1} />
      <text fg={theme.text}>{'> '}{filter}{'█'}</text>
      <box height={1} />
      {filtered.length === 0 && <text fg={theme.textMuted}>No matching commands.</text>}
      {visible.map((c, i) => {
        const idx = start + i;
        const isSel = idx === selected;
        const hint = c.argumentHint ? ` ${c.argumentHint}` : '';
        return (
          <text key={c.name} fg={isSel ? theme.primary : theme.text}>
            {isSel ? '> ' : '  '}/{c.name}{hint}
            <span style={{ fg: theme.textMuted }}>  {safeDisplayText(c.description).slice(0, 40)}</span>
          </text>
        );
      })}
      <box height={1} />
      <text fg={theme.textMuted}>type to filter · ↑/↓ navigate · Enter run · Esc cancel</text>
    </box>
  );
}
