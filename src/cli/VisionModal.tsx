import React, { useState, useEffect } from 'react';
import { TextAttributes } from '@opentui/core';
import { useKeyboard, useTerminalDimensions, usePaste } from '@opentui/react';
import { isPasteKey, readClipboard } from './Clipboard.js';
import { theme } from './theme.js';

interface VisionModalProps {
  currentBaseUrl?: string;
  currentModel?: string;
  currentProvider?: string;
  currentApiStyle?: string;
  onSubmit: (
    baseUrl: string,
    apiKey: string,
    model: string,
    provider: string,
    apiStyle: string
  ) => void;
  onCancel: () => void;
}

export function VisionModal({
  currentBaseUrl,
  currentModel,
  currentProvider,
  currentApiStyle,
  onSubmit,
  onCancel,
}: VisionModalProps) {
  const [step, setStep] = useState(0);
  const [model, setModel] = useState(currentModel || '');
  const [baseUrl, setBaseUrl] = useState(currentBaseUrl || '');
  const [apiKey, setApiKey] = useState('');
  const [provider, setProvider] = useState(currentProvider || 'custom');
  const [apiStyle, setApiStyle] = useState(currentApiStyle || '');
  const [cursor, setCursor] = useState(0);
  const { width: termWidth, height: termHeight } = useTerminalDimensions();

  const fields = [
    {
      label: 'Vision Model (Fallback)',
      hint: 'e.g., gpt-4o, claude-3-5-sonnet',
      value: model,
      setter: setModel,
    },
    {
      label: 'Base URL (optional)',
      hint: 'Leave blank to use main agent URL',
      value: baseUrl,
      setter: setBaseUrl,
    },
    {
      label: 'API Key (optional)',
      hint: 'Leave blank to use main agent Key',
      value: apiKey,
      setter: setApiKey,
      masked: true,
    },
    {
      label: 'Vision Provider (optional)',
      hint: 'openai, anthropic, custom (default: custom)',
      value: provider,
      setter: setProvider,
    },
    {
      label: 'API Style (optional)',
      hint: '1/openai, 2/anthropic, auto',
      value: apiStyle,
      setter: setApiStyle,
    },
  ];

  const current = fields[step];
  const stepRef = React.useRef(step);
  const cursorRef = React.useRef(cursor);
  const fieldSetters = [setModel, setBaseUrl, setApiKey, setProvider, setApiStyle];

  useEffect(() => {
    stepRef.current = step;
    cursorRef.current = current.value.length;
    setCursor(current.value.length);
  }, [step]);

  useEffect(() => {
    cursorRef.current = cursor;
  }, [cursor]);

  const insertText = (rawText?: string) => {
    const text = rawText?.replace(/\r\n/g, '\n').trimEnd();
    if (!text) return;
    const insertAt = cursorRef.current;
    const setter = fieldSetters[stepRef.current];
    setter((prev: string) => prev.slice(0, insertAt) + text + prev.slice(insertAt));
    cursorRef.current = insertAt + text.length;
    setCursor(insertAt + text.length);
  };

  usePaste((event) => {
    insertText(new TextDecoder().decode(event.bytes));
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
      if (step < fields.length - 1) {
        setStep(step + 1);
      } else {
        let finalApiStyle = apiStyle.trim().toLowerCase();
        if (finalApiStyle === '1') finalApiStyle = 'openai';
        if (finalApiStyle === '2') finalApiStyle = 'anthropic';
        onSubmit(baseUrl, apiKey, model, provider.trim().toLowerCase(), finalApiStyle);
      }
      return;
    }

    if (isPasteKey(evt)) {
      evt.preventDefault();
      readClipboard()
        .then(insertText)
        .catch(() => {});
      return;
    }

    if (name === 'backspace') {
      evt.preventDefault();
      if (cursor > 0) {
        current.setter((prev) => prev.slice(0, cursor - 1) + prev.slice(cursor));
        setCursor((prev) => prev - 1);
      }
      return;
    }

    if (name === 'left') {
      evt.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
      return;
    }

    if (name === 'right') {
      evt.preventDefault();
      setCursor((c) => Math.min(current.value.length, c + 1));
      return;
    }

    if (evt.sequence && evt.sequence.length === 1 && !evt.ctrl && !evt.meta) {
      const ch = evt.sequence;
      if (ch >= ' ' && ch !== '\x7f') {
        evt.preventDefault();
        const insertAt = cursor;
        current.setter((prev) => prev.slice(0, insertAt) + ch + prev.slice(insertAt));
        setCursor(insertAt + 1);
      }
    }
  });

  const boxW = Math.min(60, termWidth - 4);
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
        Configure Vision Fallback
      </text>
      <box height={1} />
      <text fg={theme.textMuted}>This model will be called in the background</text>
      <text fg={theme.textMuted}>when the main agent is blind and encounters an image.</text>
      <box height={1} />

      <box flexDirection="column">
        {fields.map((f, i) => {
          const isActive = i === step;
          let displayValue = f.value;
          if (f.masked) displayValue = '*'.repeat(f.value.length);

          if (!isActive) {
            return (
              <box key={f.label} paddingLeft={2}>
                <text fg={theme.textMuted}>
                  {f.label}: {displayValue || '(empty)'}
                </text>
              </box>
            );
          }

          const before = displayValue.slice(0, cursor);
          const after = displayValue.slice(cursor + 1);
          const cursorChar = cursor < displayValue.length ? displayValue[cursor] : ' ';

          return (
            <box key={f.label} flexDirection="column">
              <text fg={theme.primary}>
                {'> '}
                {f.label}
              </text>
              <text fg={theme.textMuted}> {f.hint}</text>
              <box paddingLeft={2}>
                <span style={{ fg: theme.text }}>{before}</span>
                <span style={{ bg: theme.cursor, fg: theme.bg }}>{cursorChar}</span>
                <span style={{ fg: theme.text }}>{after}</span>
              </box>
            </box>
          );
        })}
      </box>

      <box height={1} />
      <text fg={theme.textMuted}>Enter: next/save · Esc: cancel</text>
    </box>
  );
}
