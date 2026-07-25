import React from 'react';
import { theme } from './theme.js';
import { logoLines } from '../utils/ascii-logo.js';

export function Banner() {
  return (
    <box flexDirection="column" alignItems="center" backgroundColor={theme.bg}>
      <text fg={theme.primary}>{logoLines().join('\n')}</text>
    </box>
  );
}
