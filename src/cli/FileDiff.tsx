import React from 'react';
import { theme } from './theme.js';

interface DiffProps {
  filePath: string;
  oldLines: string[];
  newLines: string[];
  lineStart?: number;
}

export function FileDiff({ filePath, oldLines, newLines, lineStart = 1 }: DiffProps) {
  const maxLines = 10;
  const trimmedOld = oldLines.length > maxLines ? oldLines.slice(0, maxLines) : oldLines;
  const trimmedNew = newLines.length > maxLines ? newLines.slice(0, maxLines) : newLines;
  const oldTruncated = oldLines.length > maxLines;
  const newTruncated = newLines.length > maxLines;

  const added = newLines.length - oldLines.length;
  const changeTag = added > 0 ? `+${added}` : added < 0 ? `${added}` : '~';

  const removedBg = '#7f1d1d';
  const addedBg = '#14532d';
  const removedFg = '#ffffff';
  const addedFg = '#ffffff';
  const lineWidth = Math.max(
    3,
    String(lineStart + Math.max(oldLines.length, newLines.length)).length
  );

  const renderDiffLine = (
    key: string,
    sign: '+' | '-',
    lineNo: number,
    line: string,
    bg: string,
    fg: string
  ) => (
    <box key={key} backgroundColor={bg} flexShrink={0}>
      <text fg={fg} bg={bg}>{`${sign}${String(lineNo).padStart(lineWidth)} ${line || ' '}`}</text>
    </box>
  );

  return (
    <box flexDirection="column" paddingLeft={4} paddingRight={2}>
      <box>
        <text fg={theme.tool}>▸ </text>
        <text fg={theme.textMuted}>{filePath}</text>
        <text fg={theme.border}>{'  '}</text>
        <text fg={added >= 0 ? theme.diffAdded : theme.diffRemoved}>{changeTag} lines</text>
      </box>
      {trimmedOld.map((line, i) =>
        renderDiffLine(`old-${i}`, '-', lineStart + i, line, removedBg, removedFg)
      )}
      {oldTruncated && (
        <box>
          <text fg={theme.textMuted}>{`... ${oldLines.length - maxLines} more removed`}</text>
        </box>
      )}
      {trimmedNew.map((line, i) =>
        renderDiffLine(`new-${i}`, '+', lineStart + i, line, addedBg, addedFg)
      )}
      {newTruncated && (
        <box>
          <text fg={theme.textMuted}>{`... ${newLines.length - maxLines} more added`}</text>
        </box>
      )}
    </box>
  );
}

export function parseToolEditOutput(
  content: string
): { filePath: string; oldLines: string[]; newLines: string[]; lineStart: number } | null {
  const lines = content.split('\n');
  const firstLineIndex = lines.findIndex(
    (line) => line.startsWith('Edited ') || line.startsWith('Created ') || line.startsWith('Wrote ')
  );
  if (firstLineIndex < 0) return null;

  const firstLine = lines[firstLineIndex] || '';
  let afterPrefix = firstLine.replace(/^(Edited|Created|Wrote)\s+/, '');
  const filePath = afterPrefix.split(/\s{2,}/)[0] || afterPrefix.trim();

  let lineStart = 1;
  const lineMatch = afterPrefix.match(/lines\s+(\d+)/);
  if (lineMatch) {
    lineStart = parseInt(lineMatch[1], 10);
  }

  const oldLines: string[] = [];
  const newLines: string[] = [];
  for (const line of lines.slice(1)) {
    if (line.startsWith('- ')) oldLines.push(line.slice(2));
    else if (line.startsWith('+ ')) newLines.push(line.slice(2));
  }
  if (oldLines.length === 0 && newLines.length === 0) return null;
  return { filePath, oldLines, newLines, lineStart };
}
