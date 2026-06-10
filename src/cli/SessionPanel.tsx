import React, { useState, useEffect } from 'react';
import { TextAttributes } from '@opentui/core';
import { theme } from './theme.js';

interface SessionPanelProps {
  sessionName: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextPct: number;
  messageCount: number;
  researchMode: string;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

function TokenBar({ pct, width = 12 }: { pct: number; width?: number }) {
  const filled = Math.round((pct / 100) * width);
  const color = pct > 75 ? theme.error : pct > 50 ? theme.warn : theme.ok;
  return (
    <box>
      <text fg={color}>{Array.from({ length: width }).map((_, i) => i < filled ? '█' : '░').join('')}</text>
    </box>
  );
}

export function SessionPanel({
  sessionName,
  model,
  provider,
  inputTokens,
  outputTokens,
  totalTokens,
  contextPct,
  messageCount,
  researchMode,
}: SessionPanelProps) {
  const [time, setTime] = useState(new Date().toISOString().replace('T', ' ').slice(0, 19));

  useEffect(() => {
    const id = setInterval(() => {
      setTime(new Date().toISOString().replace('T', ' ').slice(0, 19));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const panelWidth = 32;

  return (
    <box
      flexDirection="column"
      width={panelWidth}
      backgroundColor={theme.bgPanel}
      border={["left"]}
      borderColor={theme.border}
      paddingX={1}
      paddingY={1}
    >
      <box>
        <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>Session</text>
      </box>
      <box>
        <text fg={theme.text}>{sessionName || 'New session'}</text>
      </box>
      <box paddingTop={1}>
        <text fg={theme.textMuted}>{time}</text>
      </box>

      <box paddingTop={1} flexDirection="column">
        <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>Context</text>
        <box paddingTop={1}>
          <text fg={theme.text}>{formatTokens(totalTokens)}</text>
          <text fg={theme.textMuted}> tokens</text>
        </box>
        <box>
          <TokenBar pct={contextPct} width={16} />
          <text fg={theme.textMuted}>{' '}{contextPct}% used</text>
        </box>
      </box>

      <box paddingTop={1} flexDirection="column">
        <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>Tokens</text>
        <box paddingTop={1}>
          <text fg={theme.secondary}>↑ input </text>
          <text fg={theme.text}>{formatTokens(inputTokens)}</text>
        </box>
        <box>
          <text fg={theme.primary}>↓ output </text>
          <text fg={theme.text}>{formatTokens(outputTokens)}</text>
        </box>
      </box>

      <box paddingTop={1} flexDirection="column">
        <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>Info</text>
        <box paddingTop={1}>
          <text fg={theme.textMuted}>model    </text>
          <text fg={theme.text}>{model}</text>
        </box>
        <box>
          <text fg={theme.textMuted}>provider </text>
          <text fg={theme.text}>{provider}</text>
        </box>
        <box>
          <text fg={theme.textMuted}>depth    </text>
          <text fg={theme.text}>{researchMode}</text>
        </box>
        <box>
          <text fg={theme.textMuted}>messages </text>
          <text fg={theme.text}>{messageCount}</text>
        </box>
      </box>
    </box>
  );
}
