import React, { useState } from 'react';
import { TextAttributes } from '@opentui/core';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { theme } from './theme.js';

export interface SessionInfo {
  id: string;
  savedAt: string;
  messageCount: number;
  preview: string;
}

interface SessionBrowserProps {
  sessions: SessionInfo[];
  onSelect: (id: string) => void;
  onCancel: () => void;
}

const MAX_VISIBLE = 10;

function relTime(iso: string): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (isNaN(then)) return '';
  const sec = Math.floor((Date.now() - then) / 1000);
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

export function SessionBrowser({ sessions, onSelect, onCancel }: SessionBrowserProps) {
  const { width: termWidth, height: termHeight } = useTerminalDimensions();
  const [selected, setSelected] = useState(0);

  useKeyboard((evt) => {
    const name = evt.name;
    evt.preventDefault();
    if (name === 'escape') {
      onCancel();
      return;
    }
    if (name === 'up' || (evt.ctrl && name === 'p')) {
      setSelected(s => (s > 0 ? s - 1 : Math.max(0, sessions.length - 1)));
      return;
    }
    if (name === 'down' || (evt.ctrl && name === 'n')) {
      setSelected(s => (s < sessions.length - 1 ? s + 1 : 0));
      return;
    }
    if (name === 'return') {
      const s = sessions[selected];
      if (s) onSelect(s.id);
    }
  });

  const boxW = Math.min(76, termWidth - 4);
  const start = Math.max(0, Math.min(selected - Math.floor(MAX_VISIBLE / 2), Math.max(0, sessions.length - MAX_VISIBLE)));
  const visible = sessions.slice(start, start + MAX_VISIBLE);

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
      <text fg={theme.primary} attributes={TextAttributes.BOLD}>⎘ Sessions — pick one to resume</text>
      <box height={1} />
      {sessions.length === 0 && <text fg={theme.textMuted}>No saved sessions yet.</text>}
      {visible.map((s, i) => {
        const idx = start + i;
        const isSel = idx === selected;
        const meta = `${s.messageCount} msg · ${relTime(s.savedAt)}`;
        return (
          <text key={s.id} fg={isSel ? theme.primary : theme.text}>
            {isSel ? '> ' : '  '}{s.preview}
            <span style={{ fg: theme.textMuted }}>  ({meta})</span>
          </text>
        );
      })}
      <box height={1} />
      <text fg={theme.textMuted}>↑/↓ navigate · Enter resume · Esc cancel</text>
    </box>
  );
}
