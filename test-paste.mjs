#!/usr/bin/env node
// Quick paste test - simulates setup input
import { readClipboard } from './dist/cli/InputBox.js';

console.log('Testing readClipboard...');
console.log('DISPLAY:', process.env.DISPLAY);
console.log('XAUTHORITY:', process.env.XAUTHORITY);

const clip = await readClipboard();
console.log('Clipboard content:', clip ? `"${clip}"` : 'EMPTY/FAILED');

// Now test raw stdin with Ctrl+V detection
console.log('\nNow testing raw stdin. Press Ctrl+V then Enter:');
const stdin = process.stdin;
if (stdin.isTTY) stdin.setRawMode(true);
stdin.resume();
stdin.setEncoding('utf8');

// Enable bracketed paste
process.stdout.write('\x1b[?2004h');

let escBuf = '';
stdin.on('data', (ch) => {
  const c = ch.charCodeAt(0);
  console.log(`[RAW] charCode=${c} hex=0x${c.toString(16)} char=${JSON.stringify(ch)}`);
  
  if (escBuf.length > 0) {
    escBuf += ch;
    if (escBuf.endsWith('\x1b[200~')) {
      console.log('[BRACKETED PASTE START DETECTED]');
      escBuf = '';
      return;
    }
    if (escBuf.endsWith('\x1b[201~')) {
      console.log('[BRACKETED PASTE END DETECTED]');
      escBuf = '';
      return;
    }
    if (/[A-Za-z~]/.test(ch)) {
      escBuf = '';
      return;
    }
    return;
  }
  
  if (c === 22) {
    console.log('[CTRL+V RAW BYTE DETECTED - 0x16]');
    readClipboard().then(clip => {
      console.log('[CLIPBOARD]', clip ? `"${clip}"` : 'EMPTY');
    });
    return;
  }
  
  if (c === 27) {
    escBuf = ch;
    return;
  }
  
  if (c === 13 || c === 10) {
    console.log('[ENTER] exiting...');
    process.stdout.write('\x1b[?2004l');
    if (stdin.isTTY) stdin.setRawMode(false);
    process.exit(0);
  }
});
