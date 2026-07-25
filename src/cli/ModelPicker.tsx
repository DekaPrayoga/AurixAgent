import React, { useEffect, useMemo, useState } from 'react';
import { TextAttributes } from '@opentui/core';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import type { ModelPickerItem } from '../agent/ModelSelection.js';
import { searchModelItems } from '../agent/ModelSelection.js';
import { safeDisplayText } from '../utils/terminal-sanitize.js';
import { theme } from './theme.js';

interface ModelPickerProps {
  items: ModelPickerItem[];
  currentModel: string;
  loading?: boolean;
  error?: string;
  initialQuery?: string;
  onSelect: (modelId: string) => void;
  onRefresh: () => void;
  onCustom: (modelId: string) => void;
  onCancel: () => void;
}

export function ModelPicker({
  items,
  currentModel,
  loading,
  error,
  initialQuery = '',
  onSelect,
  onRefresh,
  onCustom,
  onCancel,
}: ModelPickerProps) {
  const { width: termWidth, height: termHeight } = useTerminalDimensions();
  const [query, setQuery] = useState(initialQuery);
  const [selected, setSelected] = useState(0);
  const [customMode, setCustomMode] = useState(false);
  const [customId, setCustomId] = useState('');
  const filtered = useMemo(() => searchModelItems(items, query), [items, query]);
  const visibleCount = Math.max(4, Math.min(16, Math.floor(termHeight / 2) - 6));

  useEffect(() => {
    const currentIndex = filtered.findIndex((item) => item.current || item.id.toLowerCase() === currentModel.toLowerCase());
    setSelected(currentIndex >= 0 ? currentIndex : 0);
  }, [query, items, initialQuery, currentModel]);

  useEffect(() => {
    setSelected((value) => Math.min(value, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  useKeyboard((event) => {
    const name = event.name;
    const consume = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    if (customMode) {
      if (name === 'escape') {
        consume();
        setCustomMode(false);
        setCustomId('');
        return;
      }
      if (name === 'return') {
        consume();
        if (customId.trim()) onCustom(customId.trim());
        return;
      }
      if (name === 'backspace') {
        consume();
        setCustomId((value) => value.slice(0, -1));
        return;
      }
      if (event.sequence?.length === 1 && !event.ctrl && !event.meta) {
        const char = event.sequence;
        if (char >= ' ' && char !== '\x7f') {
          consume();
          setCustomId((value) => value + char);
        }
      }
      return;
    }
    if (name === 'escape') {
      consume();
      onCancel();
      return;
    }
    if (event.ctrl && name === 'r') {
      consume();
      onRefresh();
      return;
    }
    if (name === 'tab') {
      consume();
      setCustomMode(true);
      setCustomId('');
      return;
    }
    if (name === 'up' || (event.ctrl && name === 'p')) {
      consume();
      setSelected((value) => (filtered.length ? (value - 1 + filtered.length) % filtered.length : 0));
      return;
    }
    if (name === 'down' || (event.ctrl && name === 'n')) {
      consume();
      setSelected((value) => (filtered.length ? (value + 1) % filtered.length : 0));
      return;
    }
    if (name === 'pageup' || name === 'pagedown') {
      consume();
      const delta = name === 'pageup' ? -visibleCount : visibleCount;
      setSelected((value) => Math.max(0, Math.min(value + delta, filtered.length - 1)));
      return;
    }
    if (name === 'home' || name === 'end') {
      consume();
      setSelected(name === 'home' ? 0 : Math.max(0, filtered.length - 1));
      return;
    }
    if (name === 'return') {
      consume();
      const item = filtered[selected];
      if (item) onSelect(item.id);
      return;
    }
    if (name === 'backspace') {
      consume();
      setQuery((value) => value.slice(0, -1));
      return;
    }
    if (event.sequence?.length === 1 && !event.ctrl && !event.meta) {
      const char = event.sequence;
      if (char >= ' ' && char !== '\x7f') {
        consume();
        setQuery((value) => value + char);
      }
    }
  });

  const modalWidth = Math.max(32, Math.min(60, termWidth - 4));
  const start = Math.max(0, Math.min(selected - Math.floor(visibleCount / 2), Math.max(0, filtered.length - visibleCount)));
  const visible = filtered.slice(start, start + visibleCount);

  return (
    <box
      position="absolute"
      top={Math.max(1, Math.floor(termHeight / 4))}
      left={Math.max(2, Math.floor((termWidth - modalWidth) / 2))}
      width={modalWidth}
      flexDirection="column"
      backgroundColor={theme.bgPanel}
      border
      borderColor={theme.borderActive}
      zIndex={220}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
    >
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.textBright} attributes={TextAttributes.BOLD}>Select model</text>
        <text fg={theme.textMuted}>esc</text>
      </box>
      <box height={1} />
      <box flexDirection="row">
        <text fg={theme.textMuted}>{customMode ? 'Custom  ' : 'Search  '}</text>
        <text fg={theme.text}>{safeDisplayText(customMode ? customId : query)}</text>
        <text fg={theme.primary}>█</text>
      </box>
      <box height={1} />
      {customMode && <text fg={theme.textMuted}>Type an exact model ID, then press Enter. Esc returns to search.</text>}

      {!customMode && loading && <text fg={theme.textMuted}>Loading models from /models…</text>}
      {!customMode && !loading && error && <text fg={theme.error}>{safeDisplayText(error)}</text>}
      {!customMode && !loading && !error && filtered.length === 0 && (
        <text fg={theme.textMuted}>{items.length ? 'No matching models.' : 'No models returned. Tab to enter a custom ID.'}</text>
      )}
      {!customMode && !loading && visible.map((item, index) => {
        const absoluteIndex = start + index;
        const isSelected = absoluteIndex === selected;
        const isCurrent = item.current || item.id.toLowerCase() === currentModel.toLowerCase();
        return (
          <box
            key={item.id}
            flexDirection="row"
            backgroundColor={isSelected ? theme.bgSelected : undefined}
            paddingLeft={1}
            paddingRight={1}
            onMouseDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.stopPropagation();
              onSelect(item.id);
            }}
          >
            <text fg={isSelected ? theme.textBright : isCurrent ? theme.primary : theme.text} attributes={isSelected ? TextAttributes.BOLD : TextAttributes.NONE}>
              {isCurrent ? '● ' : '  '}{safeDisplayText(item.label)}
            </text>
          </box>
        );
      })}

      <box height={1} />
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.textMuted}>Enter select · Ctrl+R refresh</text>
        <text fg={theme.textMuted}>Tab custom · Esc cancel</text>
      </box>
    </box>
  );
}
