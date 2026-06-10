import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { TextAttributes } from '@opentui/core';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { theme } from './theme.js';
import type { SlashCommand } from './commands.js';
import { completeCommand, filterSlashCommands } from './commands.js';

interface InputBoxProps {
  onSubmit: (value: string) => void;
  disabled: boolean;
  commands?: SlashCommand[];
  home?: boolean;
  model?: string;
  contextPct?: number;
  cwd?: string;
  mode?: 'auto' | 'ask';
  onModeCycle?: () => void;
}

const MODE_LABEL: Record<'auto' | 'ask', string> = {
  auto: 'Auto',
  ask: 'Ask',
};
const MODE_COLOR: Record<'auto' | 'ask', string> = {
  auto: theme.ok,
  ask: theme.secondary,
};

export function InputBox({ onSubmit, disabled, commands = [], home = false, model, contextPct = 0, cwd, mode = 'auto', onModeCycle }: InputBoxProps) {
  const { width: termWidth } = useTerminalDimensions();

  const [value, setValue] = useState('');
  const [cursor, setCursor] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [selectedCommand, setSelectedCommand] = useState(0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick(n => n + 1), 140);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (process.stdin.isTTY) {
      process.stdout.write('\x1b[?2004h');
    }
    const onPaste = (data: Buffer) => {
      if (disabled) return;
      const str = data.toString();
      const m = str.match(/\x1b\[200~([\s\S]*?)\x1b\[201~/);
      if (m) {
        const pasted = m[1];
        setValue(prev => {
          const c = cursor;
          return prev.slice(0, c) + pasted + prev.slice(c);
        });
        setCursor(prev => prev + pasted.length);
      }
    };
    process.stdin.on('data', onPaste);
    return () => {
      process.stdin.off('data', onPaste);
      if (process.stdin.isTTY) {
        process.stdout.write('\x1b[?2004l');
      }
    };
  }, [disabled, cursor]);

  const frame = () => {
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    return frames[tick % frames.length];
  };

  const commandQuery = value.startsWith('/') && !/\s/.test(value.slice(1))
    ? value.slice(1)
    : null;

  const suggestions = useMemo(() => {
    if (commandQuery === null || commands.length === 0) return [];
    return filterSlashCommands(commands, commandQuery, home ? 20 : 30);
  }, [commandQuery, commands, home]);

  const suggestionsVisible = suggestions.length > 0;
  useEffect(() => { setSelectedCommand(0); }, [commandQuery]);

  function applyCommandCompletion(index = selectedCommand) {
    const command = suggestions[index];
    if (!command) return;
    const next = completeCommand(command);
    setValue(next);
    setCursor(next.length);
  }

  useKeyboard((evt) => {
    if (disabled) return;
    const name = evt.name;

    if (name === 'escape') {
      evt.preventDefault();
      if (value) {
        setValue('');
        setCursor(0);
      }
      return;
    }
    if (name === 'return') {
      evt.preventDefault();
      evt.stopPropagation();
      if (suggestionsVisible) { applyCommandCompletion(); return; }
      const trimmed = value.trim();
      if (trimmed) {
        onSubmit(trimmed);
        setHistory(prev => [...prev, trimmed]);
        setValue('');
        setCursor(0);
        setHistoryIdx(-1);
      }
      return;
    }
    if (name === 'tab') {
      evt.preventDefault();
      evt.stopPropagation();
      if (evt.shift && onModeCycle) { onModeCycle(); return; }
      if (suggestionsVisible) { applyCommandCompletion(); return; }
      return;
    }
    if (evt.ctrl && name === 'p') {
      evt.preventDefault();
      const next = value.startsWith('/') ? '' : '/';
      setValue(next);
      setCursor(next.length);
      return;
    }
    if (evt.ctrl && name === 'c') {
      return;
    }
    if (name === 'backspace' || name === 'delete') {
      evt.preventDefault();
      if (cursor > 0) {
        setValue(value.slice(0, cursor - 1) + value.slice(cursor));
        setCursor(cursor - 1);
      }
      return;
    }
    if (name === 'left') {
      evt.preventDefault();
      setCursor(Math.max(0, cursor - 1));
      return;
    }
    if (name === 'right') {
      evt.preventDefault();
      setCursor(Math.min(value.length, cursor + 1));
      return;
    }
    if (suggestionsVisible && name === 'up') {
      evt.preventDefault();
      evt.stopPropagation();
      setSelectedCommand(prev => prev <= 0 ? suggestions.length - 1 : prev - 1);
      return;
    }
    if (suggestionsVisible && name === 'down') {
      evt.preventDefault();
      evt.stopPropagation();
      setSelectedCommand(prev => (prev + 1) % suggestions.length);
      return;
    }
    if (!suggestionsVisible && name === 'up') {
      evt.preventDefault();
      evt.stopPropagation();
      if (history.length === 0) return;
      const nextIdx = historyIdx < 0 ? history.length - 1 : Math.max(0, historyIdx - 1);
      setHistoryIdx(nextIdx);
      setValue(history[nextIdx] || '');
      setCursor((history[nextIdx] || '').length);
      return;
    }
    if (!suggestionsVisible && name === 'down') {
      evt.preventDefault();
      evt.stopPropagation();
      if (historyIdx < 0) return;
      const nextIdx = historyIdx + 1;
      if (nextIdx >= history.length) { setHistoryIdx(-1); setValue(''); setCursor(0); return; }
      setHistoryIdx(nextIdx);
      setValue(history[nextIdx] || '');
      setCursor((history[nextIdx] || '').length);
      return;
    }
    if (evt.ctrl || evt.meta) return;
    if (name === 'space' || name === ' ') {
      evt.preventDefault();
      setValue(value.slice(0, cursor) + ' ' + value.slice(cursor));
      setCursor(cursor + 1);
      return;
    }
    if (name.length === 1 && !evt.ctrl && !evt.meta) {
      const input = name;
      setValue(value.slice(0, cursor) + input + value.slice(cursor));
      setCursor(cursor + input.length);
    }
  });

  const before = value.slice(0, cursor);
  const cursorChar = value[cursor] || ' ';
  const after = value.slice(cursor + 1);
  const homeDir = (cwd || process.cwd()).replace(/^\/root\//, '~/');

  const barLen = 8;
  const filled = Math.round((contextPct / 100) * barLen);
  const barColor = contextPct > 75 ? theme.error : contextPct > 50 ? theme.warn : theme.ok;
  const ctxBar = Array.from({ length: barLen }).map((_, i) =>
    i < filled ? '█' : '░'
  ).join('');

  if (disabled) {
    return (
      <box flexDirection="column" paddingX={2} backgroundColor={theme.bg}>
        <box
          backgroundColor={theme.bgElement}
          paddingX={2}
          paddingTop={1}
          paddingBottom={1}
        >
          <text fg={MODE_COLOR[mode]} attributes={TextAttributes.BOLD}>{MODE_LABEL[mode]}</text>
          <text fg={theme.textMuted}>{'  '}{frame()} thinking...</text>
          <text fg={theme.textMuted}>{'  '}esc to cancel</text>
        </box>
        <box marginTop={1} paddingX={1}>
          <text fg={theme.text}>{model || 'aurix'}</text>
          <text fg={theme.textMuted}>{' · ctx '}</text>
          <text fg={barColor}>{ctxBar}</text>
          <text fg={theme.textMuted}>{` ${Math.round(contextPct)}%`}</text>
          <text fg={theme.border}>{' · '}</text>
          <text fg={theme.textMuted}>{homeDir}</text>
        </box>
      </box>
    );
  }

  if (home) {
    const boxWidth = Math.min(termWidth - 4, 72);
    return (
      <box flexDirection="column" alignItems="center" width={termWidth} backgroundColor={theme.bg}>
        <box flexDirection="column" border={suggestionsVisible ? ["top", "left", "right"] : undefined} borderColor={suggestionsVisible ? theme.border : undefined} backgroundColor={theme.bgElement} width={boxWidth}>
          {suggestionsVisible && (
            <CommandSuggestions suggestions={suggestions} selected={selectedCommand} />
          )}
          <box
            paddingX={2}
            paddingTop={1}
            paddingBottom={1}
          >
            <box>
              <text fg={value ? theme.text : theme.textMuted}>
                {value ? '' : 'Ask anything...'}
              </text>
              {value && (
                <>
                  <text fg={theme.text}>{before}</text>
                  <text bg={theme.cursor} fg={theme.bg}>{cursorChar}</text>
                  <text fg={theme.text}>{after}</text>
                </>
              )}
              {!value && <text> </text>}
            </box>
          </box>
        </box>
        <box marginTop={1} paddingX={1} width={boxWidth} flexDirection="row" justifyContent="space-between">
          <box>
            <text fg={MODE_COLOR[mode]} attributes={TextAttributes.BOLD}>{MODE_LABEL[mode]}</text>
            <text fg={theme.textMuted}>{'  '}</text>
            <text fg={theme.text}>{model || 'aurix'}</text>
            <text fg={theme.textMuted}>{' · ctx '}</text>
            <text fg={barColor}>{ctxBar}</text>
            <text fg={theme.textMuted}>{` ${Math.round(contextPct)}%`}</text>
          </box>
          <box>
            <text fg={theme.textMuted}>{homeDir}</text>
          </box>
        </box>
      </box>
    );
  }

  return (
    <box flexDirection="column" paddingX={2} backgroundColor={theme.bg}>
      <box flexDirection="column" border={suggestionsVisible ? ["top", "left", "right"] : undefined} borderColor={suggestionsVisible ? theme.border : undefined} backgroundColor={theme.bgElement}>
        {suggestionsVisible && (
          <CommandSuggestions suggestions={suggestions} selected={selectedCommand} />
        )}
        <box
          paddingX={2}
          paddingTop={1}
          paddingBottom={1}
        >
          <box>
            <text fg={value ? theme.text : theme.textMuted}>
              {value ? '' : 'Ask anything...'}
            </text>
            {value && (
              <>
                <text fg={theme.text}>{before}</text>
                <text bg={theme.cursor} fg={theme.bg}>{cursorChar}</text>
                <text fg={theme.text}>{after}</text>
              </>
            )}
            {!value && <text> </text>}
          </box>
        </box>
      </box>
      <box paddingX={1} marginTop={1} flexDirection="row" justifyContent="space-between">
        <box>
          <text fg={MODE_COLOR[mode]} attributes={TextAttributes.BOLD}>{MODE_LABEL[mode]}</text>
          <text fg={theme.textMuted}>{'  '}</text>
          <text fg={theme.text}>{model || 'aurix'}</text>
          <text fg={theme.textMuted}>{' · ctx '}</text>
          <text fg={barColor}>{ctxBar}</text>
          <text fg={theme.textMuted}>{` ${Math.round(contextPct)}%`}</text>
        </box>
        <box>
          <text fg={theme.textMuted}>{homeDir}</text>
        </box>
      </box>
    </box>
  );
}

function CommandSuggestions({ suggestions, selected }: { suggestions: SlashCommand[]; selected: number }) {
  return (
    <box flexDirection="column" paddingX={1} paddingTop={1} paddingBottom={1}>
      {suggestions.map((command, index) => {
        const isSelected = index === selected;
        return (
          <box key={command.name}>
            <text
              fg={isSelected ? theme.bg : theme.primary}
              bg={isSelected ? theme.primary : undefined}
            >
              {` /${command.name}${command.argumentHint ? ` ${command.argumentHint}` : ''} `}
            </text>
            <text fg={theme.textMuted}> {command.description}</text>
          </box>
        );
      })}
      <box><text fg={theme.border}>{'─'.repeat(40)}</text></box>
    </box>
  );
}
