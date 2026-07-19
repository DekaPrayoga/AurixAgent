import type { Message } from '../providers/index.js';
import type { ChatMessage } from './ChatArea.js';

const MAX_RESUMED_MESSAGES = 80;
const MAX_RESUMED_CHARS = 160_000;
const MAX_RESUMED_MESSAGE_CHARS = 32_000;

export function buildResumedDisplayMessages(
  messages: Message[],
  sessionId: string,
  options: { maxMessages?: number; maxChars?: number; maxMessageChars?: number } = {}
): ChatMessage[] {
  const maxMessages = options.maxMessages ?? MAX_RESUMED_MESSAGES;
  const maxChars = options.maxChars ?? MAX_RESUMED_CHARS;
  const maxMessageChars = options.maxMessageChars ?? MAX_RESUMED_MESSAGE_CHARS;
  const display: ChatMessage[] = [];
  let chars = 0;

  for (let index = messages.length - 1; index >= 0 && display.length < maxMessages; index--) {
    const message = messages[index];
    if (message.role === 'system') continue;
    const original = message.content || '';
    const content = original.length > maxMessageChars
      ? `${original.slice(0, maxMessageChars)}\n\n… ${original.length - maxMessageChars} more characters hidden from resumed display.`
      : original;
    if (display.length > 0 && chars + content.length > maxChars) break;
    chars += content.length;
    display.push({
      id: `${sessionId}:${index}`,
      role: message.role as ChatMessage['role'],
      content,
      timestamp: new Date(),
    });
  }

  return display.reverse();
}
