import type { Message } from '../providers/index.js';

const CORE_TOOLS = ['browser', 'web_search', 'research_forums', 'terminal', 'read_file', 'search_files'];

export function recoveryMessages(messages: Message[], attempt: number): Message[] {
  const prepared = messages.map((message) => ({
    ...message,
    ...(attempt >= 1 ? { images: undefined } : {}),
  }));
  if (attempt >= 1) {
    prepared.push({
      role: 'user',
      content:
        '[System] Continue the original task now. Use one relevant tool for the next concrete action, or answer briefly from evidence already available.',
    });
  }
  return prepared;
}

export function recoveryToolNames(userMessage: string, attempt: number): string[] {
  if (attempt < 1) return [];
  const text = userMessage.toLowerCase();
  const names = new Set<string>();
  if (/\b(browser|browse|open|website|web page|news|berita|reddit|search|cari)\b/.test(text)) {
    names.add('browser');
    names.add('web_search');
    names.add('research_forums');
  }
  if (/\b(file|code|repo|terminal|command|build|test|read|write|edit)\b/.test(text)) {
    names.add('terminal');
    names.add('read_file');
    names.add('search_files');
  }
  if (names.size === 0) CORE_TOOLS.forEach((name) => names.add(name));
  return [...names];
}

export function deterministicEmptyFallback(userMessage: string, toolTask: boolean): string {
  const task = userMessage.replace(/^\[sent from [^\]]+\]\s*/i, '').trim().slice(0, 180);
  return toolTask
    ? `The provider returned an invalid empty completion before I could finish the original task${task ? `: “${task}”` : ''}. The task is preserved; retrying the same request in the next message will resume from the current tool and browser state.`
    : `The provider returned an invalid empty completion for the original task${task ? `: “${task}”` : ''}. Please retry once; the conversation state is preserved.`;
}
