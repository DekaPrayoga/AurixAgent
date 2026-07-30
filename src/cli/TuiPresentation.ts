export interface PasteAttachment {
  id: number;
  kind: 'image' | 'text';
  marker: string;
  payload: string;
}

const STATUS_LABEL = /^(Summary|Result|Files?|Tests?|Status|Warning|Error|Success|Next steps?|Verification|Changes?|Notes?):\s*(.*)$/i;
const FENCE = /^\s*(`{3,}|~{3,})/;

export function enrichAssistantMarkdown(content: string): string {
  let fence = '';
  return content.split('\n').map((line) => {
    const fenceMatch = line.match(FENCE);
    if (fenceMatch) {
      const token = fenceMatch[1];
      if (!fence) fence = token[0];
      else if (token[0] === fence && /^\s*(`{3,}|~{3,})\s*$/.test(line)) fence = '';
      return line;
    }
    if (fence || /^\s*#{1,6}\s/.test(line) || /^\s*\|/.test(line)) return line;
    const status = line.match(STATUS_LABEL);
    if (status) return `**${status[1]}:**${status[2] ? ` ${status[2]}` : ''}`;
    return line;
  }).join('\n');
}

export function assistantSemanticClasses(content: string): string[] {
  const enriched = enrichAssistantMarkdown(content);
  const classes = new Set<string>(['body']);
  if (/^#{1,6}\s/m.test(enriched)) classes.add('heading');
  if (/\*\*[^*]+\*\*/.test(enriched)) classes.add('strong');
  if (/(^|\s)[*-]\s/m.test(enriched) || /^\s*\d+\.\s/m.test(enriched)) classes.add('list');
  if (/`[^`]+`/.test(enriched)) classes.add('code');
  if (/```|~~~/.test(enriched)) classes.add('code-block');
  if (/\[[^\]]+\]\([^)]+\)/.test(enriched) || /https?:\/\//.test(enriched)) classes.add('link');
  if (/^>\s/m.test(enriched)) classes.add('quote');
  if (/^\s*\|.*\|\s*$/m.test(enriched)) classes.add('table');
  return [...classes];
}

export function makePasteMarker(kind: PasteAttachment['kind'], id: number): string {
  return kind === 'image' ? `[Image ${id}]` : `[Pasted ${id}]`;
}

export function reconcilePasteAttachments(value: string, attachments: readonly PasteAttachment[]): PasteAttachment[] {
  return attachments.filter((attachment) => value.includes(attachment.marker));
}

export function removeTouchedPasteAttachment(
  previous: string,
  next: string,
  attachments: readonly PasteAttachment[]
): { value: string; attachments: PasteAttachment[] } {
  let value = next;
  const retained: PasteAttachment[] = [];
  for (const attachment of attachments) {
    if (value.includes(attachment.marker)) {
      retained.push(attachment);
      continue;
    }
    if (!previous.includes(attachment.marker)) continue;
    const markerStart = previous.indexOf(attachment.marker);
    let prefix = 0;
    while (prefix < previous.length && prefix < value.length && previous[prefix] === value[prefix]) prefix++;
    let suffix = 0;
    while (
      suffix < previous.length - prefix &&
      suffix < value.length - prefix &&
      previous[previous.length - 1 - suffix] === value[value.length - 1 - suffix]
    ) suffix++;
    const changedStart = prefix;
    const changedEnd = previous.length - suffix;
    if (changedStart <= markerStart + attachment.marker.length && changedEnd >= markerStart) {
      const nextMarker = value.indexOf('[', markerStart + 1);
      const nextSpace = value.indexOf(' ', markerStart);
      const partialEnd = nextMarker >= 0
        ? nextMarker
        : nextSpace >= 0
          ? nextSpace + 1
          : Math.min(value.length, markerStart + attachment.marker.length);
      const tail = value.slice(partialEnd);
      value = value.slice(0, markerStart) + (markerStart === 0 ? tail.replace(/^\s+/, '') : tail);
    }
  }
  return { value, attachments: reconcilePasteAttachments(value, retained) };
}

export function expandTextAttachments(value: string, attachments: readonly PasteAttachment[]): string {
  let expanded = value;
  for (const attachment of attachments) {
    if (attachment.kind === 'text' && expanded.includes(attachment.marker)) {
      expanded = expanded.split(attachment.marker).join(attachment.payload);
    }
  }
  return expanded;
}

export function pendingSidebarTodos<T extends { done: boolean }>(todos: readonly T[], limit = 8): {
  visible: T[];
  pending: number;
  hidden: number;
} {
  const pending = todos.filter((todo) => !todo.done);
  return {
    visible: pending.slice(0, limit),
    pending: pending.length,
    hidden: Math.max(0, pending.length - limit),
  };
}

export interface CommandRowLayout {
  command: string;
  commandPad: string;
  description: string;
  hint: string;
}

export function layoutCommandRows(
  items: Array<{ command: string; description: string; hint?: string }>,
  width: number,
  stringWidth: (value: string) => number = (value) => value.length
): CommandRowLayout[] {
  const commandWidth = Math.max(0, ...items.map((item) => stringWidth(item.command)));
  const hintWidth = Math.max(0, ...items.map((item) => stringWidth(item.hint || '')));
  return items.map((item) => {
    const available = Math.max(8, width - commandWidth - hintWidth - 5);
    let description = item.description;
    while (stringWidth(description) > available && description.length > 1) description = description.slice(0, -1);
    if (description !== item.description) description = `${description.slice(0, -1)}…`;
    return {
      command: item.command,
      commandPad: ' '.repeat(Math.max(0, commandWidth - stringWidth(item.command) + 2)),
      description,
      hint: item.hint || '',
    };
  });
}
