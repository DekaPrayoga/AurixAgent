import React, { useState } from 'react';
import { TextAttributes } from '@opentui/core';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { theme } from './theme.js';
import type { ChatMessage } from './ChatArea.js';
import { getCheckpointEngine } from '../agent/Checkpoint.js';

export type RewindMode = 'both' | 'conversation' | 'code';

interface RewindPickerProps {
  messages: ChatMessage[];
  onRestore: (checkpointId: string, mode: RewindMode) => void;
  onCancel: () => void;
}

interface Entry {
  checkpointId: string;
  text: string;
  index: number;
  changed: number;
}

const MAX_VISIBLE = 8;

export function RewindPicker({ messages, onRestore, onCancel }: RewindPickerProps) {
  const { width: termWidth, height: termHeight } = useTerminalDimensions();

  const entries: Entry[] = React.useMemo(() => {
    const engine = getCheckpointEngine();
    const out: Entry[] = [];
    messages.forEach((m, i) => {
      if (m.role === 'user' && m.checkpointId) {
        out.push({
          checkpointId: m.checkpointId,
          text: m.content.replace(/\n+/g, ' ').slice(0, 60),
          index: i,
          changed: engine?.changedSince(m.checkpointId) ?? 0,
        });
      }
    });
    return out;
  }, [messages]);

  // stage 0 = pick a message, stage 1 = pick what to restore
  const [stage, setStage] = useState<0 | 1>(0);
  const [selected, setSelected] = useState(entries.length - 1);
  const [optIndex, setOptIndex] = useState(0);

  const chosen = entries[selected];
  const canRestoreCode = !!chosen && chosen.changed > 0;
  const options: { mode: RewindMode | 'cancel'; label: string }[] = [
    { mode: 'both', label: 'Restore code and conversation' },
    { mode: 'conversation', label: 'Restore conversation only' },
    ...(canRestoreCode ? [{ mode: 'code' as const, label: 'Restore code only' }] : []),
    { mode: 'cancel', label: 'Nevermind' },
  ];

  useKeyboard((evt) => {
    const name = evt.name;
    evt.preventDefault();

    if (name === 'escape') {
      if (stage === 1) { setStage(0); setOptIndex(0); }
      else onCancel();
      return;
    }

    if (stage === 0) {
      if (name === 'up' || (evt.ctrl && name === 'p')) {
        setSelected(s => (s > 0 ? s - 1 : entries.length - 1));
      } else if (name === 'down' || (evt.ctrl && name === 'n')) {
        setSelected(s => (s < entries.length - 1 ? s + 1 : 0));
      } else if (name === 'return') {
        if (chosen) { setStage(1); setOptIndex(0); }
      }
      return;
    }

    // stage 1: choose restore mode
    if (name === 'up' || (evt.ctrl && name === 'p')) {
      setOptIndex(o => (o > 0 ? o - 1 : options.length - 1));
    } else if (name === 'down' || (evt.ctrl && name === 'n')) {
      setOptIndex(o => (o < options.length - 1 ? o + 1 : 0));
    } else if (name === 'return') {
      const opt = options[optIndex];
      if (!opt || opt.mode === 'cancel') { onCancel(); return; }
      onRestore(chosen.checkpointId, opt.mode);
    }
  });

  const boxW = Math.min(70, termWidth - 4);
  const start = Math.max(0, Math.min(selected - Math.floor(MAX_VISIBLE / 2), Math.max(0, entries.length - MAX_VISIBLE)));
  const visible = entries.slice(start, start + MAX_VISIBLE);

  return (
    <box
      position="absolute"
      top={Math.max(1, Math.floor((termHeight - 16) / 2))}
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
      <text fg={theme.primary} attributes={TextAttributes.BOLD}>
        {stage === 0 ? '⟲ Rewind — pick a point to restore' : '⟲ What to restore?'}
      </text>
      <box height={1} />

      {stage === 0 ? (
        <box flexDirection="column">
          {entries.length === 0 && (
            <text fg={theme.textMuted}>No checkpoints yet.</text>
          )}
          {visible.map((e) => {
            const isSel = e.index === chosen?.index;
            const tag = e.changed > 0 ? ` (${e.changed} file${e.changed > 1 ? 's' : ''} changed)` : '';
            return (
              <text key={e.checkpointId} fg={isSel ? theme.primary : theme.text}>
                {isSel ? '> ' : '  '}{e.text}{tag}
              </text>
            );
          })}
          <box height={1} />
          <text fg={theme.textMuted}>↑/↓ navigate · Enter select · Esc cancel</text>
        </box>
      ) : (
        <box flexDirection="column">
          <text fg={theme.textMuted}>From: {chosen?.text}</text>
          <box height={1} />
          {options.map((o, i) => (
            <text key={o.mode} fg={i === optIndex ? theme.primary : theme.text}>
              {i === optIndex ? '> ' : '  '}{o.label}
            </text>
          ))}
          <box height={1} />
          <text fg={theme.textMuted}>↑/↓ navigate · Enter confirm · Esc back</text>
        </box>
      )}
    </box>
  );
}
