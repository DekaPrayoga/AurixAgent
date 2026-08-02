import type { SessionInfo } from './SessionBrowser.js';

export function cleanSessionPreview(raw: string): string {
  let value = String(raw || '').trim();
  let previous = '';
  while (value !== previous) {
    previous = value;
    value = value
      .replace(/^\[sent from (?:discord|telegram|whatsapp)[^\r\n]*\]\s*/i, '')
      .replace(/^\[Gateway context:[^\r\n]*(?:\]|$)\s*/i, '')
      .trim();
  }
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized || '(empty)';
}

export function truncateSessionPreview(value: string, width: number): string {
  const limit = Math.max(12, width);
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(1, limit - 1)).trimEnd()}…`;
}

export function sessionCardLines(session: SessionInfo, width: number, relativeTime: string) {
  const preview = truncateSessionPreview(cleanSessionPreview(session.preview), width);
  const platform = session.platform ? ` · ${session.platform[0].toUpperCase()}${session.platform.slice(1)}` : '';
  return {
    id: session.id,
    preview,
    metadata: `${session.messageCount} messages${relativeTime ? ` · ${relativeTime}` : ''}${platform}`,
  };
}
