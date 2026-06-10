import React from 'react';
import { theme } from './theme.js';

interface DiffProps {
  filePath: string;
  oldLines: string[];
  newLines: string[];
  lineStart?: number;
}

export function FileDiff({ filePath, oldLines, newLines, lineStart = 1 }: DiffProps) {
  const added = newLines.length - oldLines.length;
  const changeTag = added > 0
    ? `+${added}`
    : added < 0
      ? `${added}`
      : '~';

  return (
    <box flexDirection="column" paddingLeft={4} paddingRight={2}>
      <box>
        <text fg={theme.textMuted}>{filePath}</text>
        <text fg={theme.border}>{'  '}</text>
        <text fg={added >= 0 ? theme.diffAdded : theme.diffRemoved}>{changeTag} lines</text>
      </box>
      {oldLines.map((line, i) => (
        <box key={`old-${i}`}>
          <text fg={theme.diffRemoved}>{`  ${String(lineStart + i).padStart(3)} `}</text>
          <text fg={theme.diffRemoved} bg="#2d1f26">
            {`- ${line || ' '}`}
          </text>
        </box>
      ))}
      {newLines.map((line, i) => (
        <box key={`new-${i}`}>
          <text fg={theme.diffAdded}>{`  ${String(lineStart + i).padStart(3)} `}</text>
          <text fg={theme.diffAdded} bg="#20303b">
            {`+ ${line || ' '}`}
          </text>
        </box>
      ))}
    </box>
  );
}

export function parseToolEditOutput(content: string): { filePath: string; oldLines: string[]; newLines: string[]; lineStart: number } | null {
  const lines = content.split('\n');
  const firstLine = lines[0] || '';
  if (!firstLine || (!firstLine.startsWith('Edited ') && !firstLine.startsWith('Created ') && !firstLine.startsWith('Wrote '))) return null;

  const filePath = firstLine.replace(/^(Edited|Created|Wrote)\s+/, '').trim();
  const oldLines: string[] = [];
  const newLines: string[] = [];
  for (const line of lines.slice(1)) {
    if (line.startsWith('- ')) oldLines.push(line.slice(2));
    else if (line.startsWith('+ ')) newLines.push(line.slice(2));
  }
  if (oldLines.length === 0 && newLines.length === 0) return null;
  return { filePath, oldLines, newLines, lineStart: 1 };
}
