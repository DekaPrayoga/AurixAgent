import React, { useEffect, useState } from 'react';
import { TextAttributes } from '@opentui/core';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { theme } from './theme.js';
import { safeDisplayText } from '../utils/terminal-sanitize.js';
import { sessionCardLines } from './SessionPresentation.js';

export interface SessionInfo {
  id: string;
  savedAt: string;
  messageCount: number;
  preview: string;
  platform?: string;
}

interface SessionBrowserProps {
  sessions: SessionInfo[];
  onSelect: (id: string) => void;
  onCancel: () => void;
}

const CARD_HEIGHT = 4;

export function visibleSessionCount(terminalHeight: number): number {
  return Math.max(1, Math.min(8, Math.floor((terminalHeight - 8) / CARD_HEIGHT)));
}

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

  useEffect(() => {
    setSelected((value) => Math.min(value, Math.max(0, sessions.length - 1)));
  }, [sessions.length]);

  useKeyboard((evt) => {
    const name = evt.name;
    evt.preventDefault();
    evt.stopPropagation();
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

  const boxW = Math.max(32, Math.min(82, termWidth - 4));
  const visibleCount = visibleSessionCount(termHeight);
  const modalHeight = Math.min(termHeight - 2, visibleCount * CARD_HEIGHT + 7);
  const start = Math.max(0, Math.min(selected - Math.floor(visibleCount / 2), Math.max(0, sessions.length - visibleCount)));
  const visible = sessions.slice(start, start + visibleCount);

  return (
    <box
      position="absolute"
      top={0}
      left={0}
      width={termWidth}
      height={termHeight}
      backgroundColor={theme.bg}
      zIndex={199}
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
    <box
      position="absolute"
      top={Math.max(1, Math.floor((termHeight - modalHeight) / 2))}
      left={Math.max(2, Math.floor((termWidth - boxW) / 2))}
      width={boxW}
      height={modalHeight}
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
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.primary} attributes={TextAttributes.BOLD}>Sessions</text>
        <text fg={theme.text}>{sessions.length ? `${selected + 1}/${sessions.length}` : '0/0'}</text>
      </box>
      <box height={1} />
      {sessions.length === 0 && <text fg={theme.text}>No saved sessions yet.</text>}
      {visible.map((session, index) => {
        const absoluteIndex = start + index;
        const selectedCard = absoluteIndex === selected;
        const lines = sessionCardLines(session, Math.max(12, boxW - 8), relTime(session.savedAt));
        return (
          <box
            key={session.id}
            flexDirection="column"
            backgroundColor={selectedCard ? theme.bgSelected : undefined}
            border={selectedCard ? ['left'] : undefined}
            borderColor={selectedCard ? theme.primary : undefined}
            paddingLeft={1}
            paddingRight={1}
            marginBottom={1}
            onMouseDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.stopPropagation();
              onSelect(session.id);
            }}
          >
            <text fg={selectedCard ? theme.primary : theme.textBright} attributes={selectedCard ? TextAttributes.BOLD : TextAttributes.NONE}>
              {selectedCard ? '> ' : '  '}{safeDisplayText(lines.id)}
            </text>
            <text fg={theme.text}>  {safeDisplayText(lines.preview)}</text>
            <text fg={theme.text}>  {safeDisplayText(lines.metadata)}</text>
          </box>
        );
      })}
      <text fg={theme.text}>arrows navigate · Enter resume · Esc cancel</text>
    </box>
    </box>
  );
}
