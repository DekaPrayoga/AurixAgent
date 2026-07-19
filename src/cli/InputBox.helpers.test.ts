import {
  expandPastedPlaceholders,
  extractAtQuery,
  extractCommandQuery,
  makePastedPlaceholder,
  shouldCompactPaste,
} from './InputBox.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(!shouldCompactPaste('short single line'), 'short single-line paste should stay inline');
assert(shouldCompactPaste('line one\nline two'), 'multi-line paste should use placeholder');
assert(shouldCompactPaste('x'.repeat(201)), 'long paste should use placeholder');
assert(makePastedPlaceholder(3) === '[pasted-3]', 'placeholder format should be stable');

const blocks = new Map([
  ['[pasted-1]', 'alpha\nbeta'],
  ['[pasted-2]', 'gamma'],
]);
assert(
  expandPastedPlaceholders('before [pasted-1] middle [pasted-2] [pasted-1]', blocks) ===
    'before alpha\nbeta middle gamma alpha\nbeta',
  'submit should expand all pasted placeholders'
);

assert(extractCommandQuery('/he') === 'he', 'slash command query should be extracted');
assert(extractCommandQuery('/help now') === null, 'slash query stops after whitespace');
assert(extractCommandQuery('hello /he') === null, 'slash query only starts at beginning');

assert(extractAtQuery('open @src/cli') === 'src/cli', 'trailing file query should be extracted');
assert(extractAtQuery('@') === '', 'empty file query should be extracted');
assert(extractAtQuery('open @src then') === null, 'non-trailing file query should be ignored');

console.log('InputBox helper tests passed');
