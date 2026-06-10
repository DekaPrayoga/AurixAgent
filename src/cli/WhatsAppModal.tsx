import React, { useState, useEffect } from 'react';
import { TextAttributes } from '@opentui/core';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { theme } from './theme.js';
import * as QRCode from 'qrcode';

interface WhatsAppModalProps {
  qrData: string | null;
  status: 'initializing' | 'waiting' | 'connected' | 'error';
  errorMsg?: string;
  onClose: () => void;
}

function renderQR(data: string): string[] {
  const lines: string[] = [];

  try {
    const matrix = QRCode.create(data, { errorCorrectionLevel: 'M' });
    const modules = matrix.modules;
    const moduleCount = modules.size;

    for (let y = 0; y < moduleCount; y += 2) {
      let line = '  ';
      for (let x = 0; x < moduleCount; x++) {
        const top = modules.get(x, y);
        const bottom = y + 1 < moduleCount ? modules.get(x, y + 1) : false;
        if (top && bottom) {
          line += '█';
        } else if (top && !bottom) {
          line += '▀';
        } else if (!top && bottom) {
          line += '▄';
        } else {
          line += ' ';
        }
      }
      lines.push(line);
    }
  } catch {
    lines.push('  (QR rendering error)');
  }

  return lines;
}

export function WhatsAppModal({ qrData, status, errorMsg, onClose }: WhatsAppModalProps) {
  const { width: termWidth, height: termHeight } = useTerminalDimensions();

  useEffect(() => {
    if (status === 'connected') {
      const timer = setTimeout(onClose, 1500);
      return () => clearTimeout(timer);
    }
  }, [status, onClose]);

  useKeyboard((evt) => {
    if (evt.name === 'escape') {
      evt.preventDefault();
      onClose();
    }
  });

  const modalWidth = Math.min(50, termWidth - 8);
  const modalTop = Math.max(1, Math.floor((termHeight - 25) / 2));

  let statusText = '';
  let statusColor = theme.textMuted;
  switch (status) {
    case 'initializing':
      statusText = 'Initializing WhatsApp...';
      statusColor = theme.textMuted;
      break;
    case 'waiting':
      statusText = 'Scan with WhatsApp > Linked Devices';
      statusColor = theme.warn;
      break;
    case 'connected':
      statusText = 'Connected!';
      statusColor = theme.ok;
      break;
    case 'error':
      statusText = errorMsg || 'Connection failed';
      statusColor = theme.error;
      break;
  }

  const qrLines = qrData ? renderQR(qrData) : [];

  return (
    <box
      flexDirection="column"
      position="absolute"
      top={modalTop}
      left={Math.floor((termWidth - modalWidth) / 2)}
      width={modalWidth}
      backgroundColor={theme.bgPanel}
      border={["top", "bottom", "left", "right"]}
      borderColor={status === 'connected' ? theme.ok : status === 'error' ? theme.error : theme.borderActive}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
      alignItems="center"
    >
      <text fg={theme.primary} attributes={TextAttributes.BOLD}>Connect WhatsApp</text>
      <box height={1} />

      {status === 'initializing' && !qrData && (
        <text fg={theme.textMuted}>Loading...</text>
      )}

      {qrLines.length > 0 && (
        <box flexDirection="column" alignItems="center">
          {qrLines.map((line, i) => (
            <text key={i} fg={theme.text}>{line}</text>
          ))}
        </box>
      )}

      <box height={1} />
      <text fg={statusColor} attributes={TextAttributes.BOLD}>{statusText}</text>

      {status !== 'connected' && (
        <box marginTop={1}>
          <text fg={theme.textMuted}>esc to cancel</text>
        </box>
      )}
    </box>
  );
}
