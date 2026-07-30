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
  removed: number;
}

const MAX_VISIBLE = 8;

export function RewindPicker({ messages, onRestore, onCancel }: RewindPickerProps) {
  const { width: termWidth, height: termHeight } = useTerminalDimensions();
  const entries = React.useMemo<Entry[]>(() => {
    const engine = getCheckpointEngine();
    return messages
      .map((message, index) => ({ message, index }))
      .filter(({ message }) => message.role === 'user' && message.checkpointId)
      .slice(-100)
      .reverse()
      .map(({ message, index }) => ({
        checkpointId: message.checkpointId!,
        text: message.content.replace(/\n+/g, ' ').slice(0, 54),
        index,
        changed: engine?.changedSince(message.checkpointId!) ?? 0,
        removed: Math.max(0, messages.length - index),
      }));
  }, [messages]);

  const [stage, setStage] = useState<0 | 1 | 2>(0);
  const [selected, setSelected] = useState(0);
  const [modeIndex, setModeIndex] = useState(0);
  const [confirmIndex, setConfirmIndex] = useState(1);
  const chosen = entries[selected];
  const modes: { mode: RewindMode; label: string; disabled: boolean }[] = [
    { mode: 'code', label: 'Rewind Only Code', disabled: !chosen || chosen.changed === 0 },
    { mode: 'conversation', label: 'Rewind Only Conversation History', disabled: false },
    { mode: 'both', label: 'Rewind Code Changes And Conversation History', disabled: !chosen || chosen.changed === 0 },
  ];

  const move = (current: number, delta: number, size: number) => (current + delta + size) % size;
  const moveMode = (delta: number) => {
    let next = modeIndex;
    for (let i = 0; i < modes.length; i++) {
      next = move(next, delta, modes.length);
      if (!modes[next].disabled) break;
    }
    setModeIndex(next);
  };

  useKeyboard((event) => {
    event.preventDefault();
    const delta = event.name === 'up' || (event.ctrl && event.name === 'p') ? -1 : event.name === 'down' || (event.ctrl && event.name === 'n') ? 1 : 0;
    if (event.name === 'escape') {
      if (stage === 2) setStage(1);
      else if (stage === 1) setStage(0);
      else onCancel();
      return;
    }
    if (delta) {
      if (stage === 0 && entries.length) setSelected((value) => move(value, delta, entries.length));
      else if (stage === 1) moveMode(delta);
      else if (stage === 2) setConfirmIndex((value) => move(value, delta, 2));
      return;
    }
    if (event.name !== 'return') return;
    if (stage === 0 && chosen) {
      const firstEnabled = modes.findIndex((mode) => !mode.disabled);
      setModeIndex(Math.max(0, firstEnabled));
      setStage(1);
    } else if (stage === 1 && !modes[modeIndex].disabled) {
      setConfirmIndex(1);
      setStage(2);
    } else if (stage === 2) {
      if (confirmIndex === 0) onRestore(chosen.checkpointId, modes[modeIndex].mode);
      else onCancel();
    }
  });

  const boxWidth = Math.min(76, termWidth - 4);
  const start = Math.max(0, Math.min(selected - Math.floor(MAX_VISIBLE / 2), Math.max(0, entries.length - MAX_VISIBLE)));
  const visible = entries.slice(start, start + MAX_VISIBLE);
  const selectedMode = modes[modeIndex];

  return (
    <box position="absolute" top={Math.max(1, Math.floor((termHeight - 18) / 2))} left={Math.max(2, Math.floor((termWidth - boxWidth) / 2))} width={boxWidth} flexDirection="column" backgroundColor={theme.bgPanel} border borderColor={theme.borderActive} zIndex={200} paddingX={2} paddingY={1}>
      <text fg={theme.primary} attributes={TextAttributes.BOLD}>
        {stage === 0 ? '⟲ Choose a checkpoint' : stage === 1 ? '⟲ Choose rewind scope' : '⚠ Are you sure you want to rewind?'}
      </text>
      <box height={1} />
      {stage === 0 && (
        <box flexDirection="column">
          {entries.length === 0 && <text fg={theme.textMuted}>No checkpoints available in the latest 100 turns.</text>}
          {visible.map((entry) => {
            const active = entry.checkpointId === chosen?.checkpointId;
            return (
              <box key={entry.checkpointId} flexDirection="row" backgroundColor={active ? theme.bgSelected : undefined}>
                <text fg={active ? theme.primary : theme.textMuted}>{active ? '> ' : '  '}</text>
                <text fg={active ? theme.textBright : theme.text}>{entry.text}</text>
                <text fg={theme.textMuted}>{` · ${entry.removed} messages · ${entry.changed} files`}</text>
              </box>
            );
          })}
        </box>
      )}
      {stage === 1 && (
        <box flexDirection="column">
          <text fg={theme.textMuted}>From: {chosen?.text}</text>
          <box height={1} />
          {modes.map((option, index) => (
            <box key={option.mode} backgroundColor={index === modeIndex ? theme.bgSelected : undefined}>
              <text fg={option.disabled ? theme.textMuted : index === modeIndex ? theme.primary : theme.text} attributes={option.disabled ? TextAttributes.DIM : TextAttributes.NONE}>
                {index === modeIndex ? '> ' : '  '}{option.label}{option.disabled ? ' · no code changes' : ''}
              </text>
            </box>
          ))}
        </box>
      )}
      {stage === 2 && (
        <box flexDirection="column">
          <text fg={theme.warn}>{chosen?.removed || 0} conversation messages may be removed</text>
          <text fg={theme.warn}>{selectedMode.mode === 'conversation' ? 0 : chosen?.changed || 0} files will be restored</text>
          <box height={1} />
          {['Yes', 'No'].map((label, index) => (
            <box key={label} backgroundColor={index === confirmIndex ? theme.bgSelected : undefined}>
              <text fg={index === confirmIndex ? (index === 0 ? theme.error : theme.primary) : theme.text}>
                {index === confirmIndex ? '> ' : '  '}{label}
              </text>
            </box>
          ))}
        </box>
      )}
      <box height={1} />
      <text fg={theme.textMuted}>↑/↓ navigate · Enter select · Esc back</text>
    </box>
  );
}
