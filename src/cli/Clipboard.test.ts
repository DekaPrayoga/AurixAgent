import { isPasteKey, normalizeClipboardText } from './Clipboard.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(isPasteKey({ name: 'v', ctrl: true }), 'Ctrl+V should paste');
assert(isPasteKey({ name: 'V', meta: true }), 'Meta+V should paste');
assert(isPasteKey({ name: '', sequence: '\x16' }), 'raw Ctrl+V sequence should paste');
assert(isPasteKey({ name: 'insert', shift: true }), 'Shift+Insert should paste');
assert(!isPasteKey({ name: 'insert' }), 'Insert alone should not paste');
assert(!isPasteKey({ name: 'v' }), 'V alone should not paste');
assert(normalizeClipboardText('a\r\nb\rc') === 'a\nb\nc', 'Windows newlines should normalize');

console.log('Clipboard input tests passed');
