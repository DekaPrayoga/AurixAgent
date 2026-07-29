import React from 'react';
import { TextAttributes } from '@opentui/core';
import { useTerminalDimensions } from '@opentui/react';
import { theme } from './theme.js';
import { logoLines } from '../utils/ascii-logo.js';

export function Banner() {
  const { width } = useTerminalDimensions();
  const lines = logoLines();

  if (width < 52) {
    return (
      <box flexDirection="column" alignItems="center" backgroundColor={theme.bg}>
        <box flexDirection="row">
          <text fg={theme.primary} attributes={TextAttributes.BOLD}>▟█</text>
          <text fg={theme.accent} attributes={TextAttributes.BOLD}> AURIX</text>
        </box>
        <text fg={theme.textMuted}>agentic terminal workspace</text>
      </box>
    );
  }

  return (
    <box flexDirection="column" alignItems="center" backgroundColor={theme.bg}>
      {lines.map((line, index) => {
        const midpoint = Math.floor(line.length / 2);
        return (
          <box key={index} flexDirection="row">
            <text fg={index < 2 ? theme.primary : theme.accent} attributes={TextAttributes.BOLD}>
              {line.slice(0, midpoint)}
            </text>
            <text fg={index > 2 ? theme.secondary : theme.info} attributes={TextAttributes.BOLD}>
              {line.slice(midpoint)}
            </text>
          </box>
        );
      })}
      <box flexDirection="row" marginTop={1}>
        <text fg={theme.textMuted}>agentic </text>
        <text fg={theme.primary}>terminal</text>
        <text fg={theme.textMuted}> workspace</text>
      </box>
    </box>
  );
}
