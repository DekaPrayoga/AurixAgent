import React from 'react';
import { getAurixVersion } from '../utils/RuntimeInfo.js';
import { theme } from './theme.js';

interface StatusBarProps {
  model?: string;
  provider?: string;
  tokenCount?: number;
  researchMode?: string;
  version?: string;
  cwd?: string;
}

export function StatusBar({
  model,
  provider,
  version = getAurixVersion(),
  cwd,
}: StatusBarProps) {
  const home = (cwd || process.cwd()).replace(/^\/root\//, '~/');
  return (
    <box paddingX={2} paddingY={0} flexShrink={0} backgroundColor={theme.bg} flexDirection="row" justifyContent="space-between">
      <text fg={theme.textMuted}>{home}</text>
      <text fg={theme.textMuted}>v{version}</text>
    </box>
  );
}
