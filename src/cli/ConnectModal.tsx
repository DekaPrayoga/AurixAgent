import React, { useState, useEffect } from 'react';
import { TextAttributes } from '@opentui/core';
import { useKeyboard, useTerminalDimensions, usePaste } from '@opentui/react';
import { theme } from './theme.js';

interface ConnectModalProps {
  platform: 'discord' | 'telegram';
  onSubmit: (token: string) => void;
  onCancel: () => void;
}

const platformConfig = {
  discord: {
    title: 'Connect Discord Bot',
    label: 'Bot Token',
    hint: 'Get from discord.com/developers/applications',
  },
  telegram: {
    title: 'Connect Telegram Bot',
    label: 'Bot Token',
    hint: 'Get from @BotFather on Telegram',
  },
};

export function ConnectModal({ platform, onSubmit, onCancel }: ConnectModalProps) {
  const [value, setValue] = useState('');
  const [cursor, setCursor] = useState(0);
  const { width: termWidth, height: termHeight } = useTerminalDimensions();
  const cfg = platformConfig[platform];

  usePaste((event) => {
    const text = new TextDecoder().decode(event.bytes).replace(/\r\n/g, '\n').trimEnd();
    if (!text) return;
    const insertAt = cursor;
    setValue(prev => prev.slice(0, insertAt) + text + prev.slice(insertAt));
    setCursor(insertAt + text.length);
  });

  useKeyboard((evt) => {
    const name = evt.name;

    if (name === 'escape') {
      evt.preventDefault();
      onCancel();
      return;
    }

    if (name === 'return') {
      evt.preventDefault();
      if (value.trim()) onSubmit(value.trim());
      return;
    }

    if (name === 'v' && evt.ctrl) {
      evt.preventDefault();
      // Import readClipboard from child_process dynamically
      import('child_process').then(({ execSync }) => {
        try {
          let text = '';
          if (process.platform === 'win32') text = execSync('powershell -NoProfile -Command "Get-Clipboard"', { encoding: 'utf8', windowsHide: true }).replace(/\r\n/g, '\n').trimEnd();
          else if (process.platform === 'darwin') text = execSync('pbpaste', { encoding: 'utf8', timeout: 2000 }).replace(/\r\n/g, '\n').trimEnd();
          else text = execSync('wl-paste --no-newline', { encoding: 'utf8', timeout: 2000 }).replace(/\r\n/g, '\n').trimEnd();
          if (!text) return;
          const insertAt = cursor;
          setValue(prev => prev.slice(0, insertAt) + text + prev.slice(insertAt));
          setCursor(insertAt + text.length);
        } catch {}
      }).catch(() => {});
      return;
    }

    if (name === 'backspace') {
      evt.preventDefault();
      if (cursor > 0) {
        setValue(prev => prev.slice(0, cursor - 1) + prev.slice(cursor));
        setCursor(prev => prev - 1);
      }
      return;
    }

    if (name === 'left') {
      evt.preventDefault();
      setCursor(prev => Math.max(0, prev - 1));
      return;
    }

    if (name === 'right') {
      evt.preventDefault();
      setCursor(prev => Math.min(value.length, prev + 1));
      return;
    }

    if (name === 'home') {
      evt.preventDefault();
      setCursor(0);
      return;
    }

    if (name === 'end') {
      evt.preventDefault();
      setCursor(value.length);
      return;
    }

    if (evt.ctrl && name === 'a') {
      evt.preventDefault();
      setCursor(0);
      return;
    }

    if (evt.ctrl && name === 'e') {
      evt.preventDefault();
      setCursor(value.length);
      return;
    }

    if (name === 'space' || name === ' ') {
      evt.preventDefault();
      setValue(prev => prev.slice(0, cursor) + ' ' + prev.slice(cursor));
      setCursor(prev => prev + 1);
      return;
    }

    if (evt.name.length === 1 && !evt.ctrl && !evt.meta) {
      evt.preventDefault();
      setValue(prev => prev.slice(0, cursor) + evt.name + prev.slice(cursor));
      setCursor(prev => prev + 1);
    }
  });

  const modalWidth = Math.min(56, termWidth - 8);
  const modalTop = Math.max(2, Math.floor(termHeight / 3));

  const masked = '●'.repeat(value.length);
  const before = masked.slice(0, cursor);
  const after = masked.slice(cursor);

  return (
    <box
      flexDirection="column"
      position="absolute"
      top={modalTop}
      left={Math.floor((termWidth - modalWidth) / 2)}
      width={modalWidth}
      backgroundColor={theme.bgPanel}
      border={["top", "bottom", "left", "right"]}
      borderColor={theme.borderActive}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
    >
      <text fg={theme.primary} attributes={TextAttributes.BOLD}>{cfg.title}</text>
      <box height={1} />

      <box flexDirection="column">
        <text fg={theme.primary} attributes={TextAttributes.BOLD}>{cfg.label}</text>
        <box
          backgroundColor={theme.bgElement}
          paddingLeft={1}
          paddingRight={1}
          paddingTop={1}
          paddingBottom={1}
          marginTop={1}
          border={["top", "bottom", "left", "right"]}
          borderColor={theme.primary}
        >
          <box flexDirection="row">
            <text fg={theme.text}>{before}</text>
            <text fg={theme.cursor} attributes={TextAttributes.BOLD}>│</text>
            <text fg={theme.text}>{after || ' '}</text>
          </box>
        </box>
        <text fg={theme.textMuted}>{cfg.hint}</text>
      </box>

      <box height={1} />
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.textMuted}>enter submit</text>
        <text fg={theme.textMuted}>esc cancel</text>
      </box>
    </box>
  );
}
