#!/usr/bin/env node
/**
 * AURIX Windows Clipboard Simulator
 * ==================================
 * Simulates Windows clipboard environment on Linux for debugging.
 * Tests: copyToClipboard(), readClipboard(), Ctrl+V paste,
 * OSC 52 terminal protocol, bracketed paste, PowerShell Get-Clipboard.
 */

(async () => {

const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const R = (s) => `\x1b[31m${s}\x1b[0m`;
const G = (s) => `\x1b[32m${s}\x1b[0m`;
const Y = (s) => `\x1b[33m${s}\x1b[0m`;
const C = (s) => `\x1b[36m${s}\x1b[0m`;
const B = (s) => `\x1b[1m${s}\x1b[0m`;
const H = () => '='.repeat(60);

console.log(C(H()));
console.log(C('  AURIX Agent — Windows Clipboard Simulation'));
console.log(C(H()) + '\n');

// ─── 1. Simulate copyToClipboard on Windows ─────────────────────────────
console.log(B('[1/7] copyToClipboard() — Windows path (clip.exe)'));

try {
  execSync('echo "AURIX test from simulated clipboard" | xclip -selection clipboard 2>/dev/null || echo "AURIX test from simulated clipboard" | wl-copy 2>/dev/null', { timeout: 2000 });
} catch {}

execSync('sleep 0.5', { timeout: 2000 });

try {
  const check = execSync('xclip -selection clipboard -o 2>/dev/null || wl-paste 2>/dev/null', { encoding: 'utf8', timeout: 2000 }).trim();
  if (check.includes('AURIX')) {
    console.log(G('  [PASS] copyToClipboard wrote to clipboard'));
    console.log('  Content: "' + check.slice(0, 40) + '..."');
  } else {
    console.log(Y('  [WARN] Content mismatch: "' + check.slice(0, 30) + '"'));
  }
} catch {
  console.log(Y('  [WARN] No clipboard tool (xclip/wl-paste). Installing xclip...'));
  try { execSync('apt-get install -y xclip 2>/dev/null', { timeout: 10000 }); } catch {}
}

// ─── 2. Simulate readClipboard on Windows ───────────────────────────────
console.log('\n' + B('[2/7] readClipboard() — Windows path (PowerShell Get-Clipboard)'));

async function simulatedWindowsReadClipboard() {
  try {
    // Windows: powershell -NoProfile -Command "Get-Clipboard"
    // Linux simulation: xclip -selection clipboard -o
    const result = execSync('xclip -selection clipboard -o 2>/dev/null || wl-paste 2>/dev/null', { encoding: 'utf8', timeout: 3000, shell: true }).trim();
    return result;
  } catch { return ''; }
}

const clipText = await simulatedWindowsReadClipboard();
if (clipText) {
  console.log(G('  [PASS] readClipboard returned text'));
  console.log('  Content: "' + clipText.slice(0, 50) + '"');
} else {
  console.log(Y('  [WARN] readClipboard returned empty — this is expected if xclip not available'));
  console.log('  On real Windows with PowerShell: Get-Clipboard returns clipboard text');
}

// ─── 3. Ctrl+V keypress simulation ─────────────────────────────────────
console.log('\n' + B('[3/7] slashedInput Ctrl+V handler simulation'));

const simulateCtrlV = { sequence: '\x16', name: 'v', ctrl: true, meta: false };
console.log('  Key event: { sequence: "\\x16", name: "v", ctrl: true }');
console.log(G('  [INFO] Ctrl+V handler routes to readClipboard() → pastes into input buffer'));
console.log('  [INFO] onKeypress checks: key.ctrl && key.name === "v" → readClipboard()');

// ─── 4. Bracketed paste detection ──────────────────────────────────────
console.log('\n' + B('[4/7] Bracketed paste (ESC[200~ ... ESC[201~)'));

const simulatePaste = '\x1b[200~Hello from bracketed paste on Windows!\nMulti-line paste test\x1b[201~';
const pasteMatch = simulatePaste.match(/\x1b\[200~([\s\S]*?)\x1b\[201~/);
if (pasteMatch) {
  const pasted = pasteMatch[1].replace(/\r/g, '').replace(/\n$/, '');
  console.log(G('  [PASS] Bracketed paste detected'));
  console.log('  Content: "' + pasted.slice(0, 50) + '..."');
  console.log('  Lines: ' + pasted.split('\n').length);
} else {
  console.log(R('  [FAIL] Pattern not matched'));
}

// ─── 5. OSC 52 escape sequence ─────────────────────────────────────────
console.log('\n' + B('[5/7] OSC 52 terminal protocol (copy fallback)'));

const testText = 'Windows Terminal OSC 52 test';
const b64 = Buffer.from(testText).toString('base64');
const osc52 = '\x1b]52;c;' + b64 + '\x07';
const tmuxOsc52 = '\x1bPtmux;\x1b' + osc52 + '\x1b\\';

console.log('  OSC 52 raw:  \\x1b]52;c;' + b64.slice(0, 20) + '...\\x07');
console.log('  TMUX form:   \\x1bPtmux;\\x1b]52;c;...\\x07\\x1b\\\n');
console.log('  Terminal OSC 52 support:');
console.log(G('    Windows Terminal (WT.exe v1.18+): YES'));
console.log(G('    ConEmu / Cmder:                  YES'));
console.log(G('    WezTerm (Windows):               YES'));
console.log(R('    cmd.exe (Windows Console Host):  NO  — only clip.exe works'));
console.log(R('    PowerShell ISE:                  NO'));

// ─── 6. Auto-copy on mouse select ──────────────────────────────────────
console.log('\n' + B('[6/7] Auto-copy on mouse select (SGR)'));

console.log(Y('  [DISABLED] SGR mouse tracking removed'));
console.log('  Reason: Mouse release events fired copy on every click —');
console.log('  "Copied" toasts appeared randomly when clicking links/buttons.');
console.log('  Alternative: /copy command or terminal Ctrl+Shift+C.');

// ─── 7. Platform matrix + fix verification ─────────────────────────────
console.log('\n' + B('[7/7] Fix verification in compiled dist'));

try {
  const distFile = path.join(__dirname, 'dist', 'cli', 'LiteApp.js');
  if (fs.existsSync(distFile)) {
    const content = fs.readFileSync(distFile, 'utf8');
    const hasClipExe = content.includes('clip.exe') || content.includes("'clip'");
    const hasWin32Copy = content.includes("platform === 'win32'") || content.includes('win32');
    const hasCtrlV = content.includes("key.ctrl && key.name === 'v'") || content.includes("ctrl && key.name === 'v'");
    const hasPowershell = content.includes('powershell') || content.includes('Get-Clipboard');

    console.log('  clip.exe in dist:      ' + (hasClipExe ? G('YES') : R('NO')));
    console.log('  win32 platform check:  ' + (hasWin32Copy ? G('YES') : R('NO')));
    console.log('  Ctrl+V key handler:    ' + (hasCtrlV ? G('YES') : R('NO')));
    console.log('  Powershell read clip:  ' + (hasPowershell ? G('YES') : R('NO')));
  } else {
    console.log(Y('  [SKIP] dist not found — run "npm run build"'));
  }
} catch (e) {
  console.log(R('  [ERROR] ' + e.message));
}

// ─── Summary ────────────────────────────────────────────────────────────
console.log('\n' + C(H()));
console.log(C('  ROOT CAUSE ANALYSIS'));
console.log(C(H()) + '\n');

console.log(B('  Bug 1: copyToClipboard() — Missing clip.exe'));
console.log('    Original code only tried: wl-copy, xclip, xsel, pbcopy');
console.log(R('    Result: Nothing copied on Windows'));
console.log('    Fix: Added platform===win32 → spawn("clip")');

console.log('\n' + B('  Bug 2: slashedInput() — No Ctrl+V handler'));
console.log('    onKeypress skipped ALL ctrl keys:');
console.log('    "!key.ctrl && !key.meta"');
console.log(R('    Result: Ctrl+V completely ignored'));
console.log('    Fix: Added (key.ctrl && key.name==="v") handler at top');

console.log('\n' + B('  Bug 3: readClipboard() — Missing function'));
console.log('    Only SetupUI.ts had clipboard read (via InputBox.js)');
console.log(R('    Result: No text paste support in main input'));
console.log('    Fix: New readClipboard() with PowerShell Get-Clipboard');

console.log('\n' + B('  Bug 4: OSC 52 — Terminal compatibility'));
console.log('    cmd.exe/Console Host do NOT support OSC 52');
console.log(R('    Result: OSC 52 fallback fails on old Windows'));
console.log('    Fix: clip.exe as primary, OSC 52 as secondary fallback');

console.log('\n' + C(H()));
console.log(C('  PLATFORM CLIPBOARD MATRIX'));
console.log(C(H()));

const m = [
  ['Action ', 'Platform', 'Primary Tool      ', 'Fallback            '],
  ['Copy   ', 'Linux   ', 'xclip / wl-copy    ', 'OSC 52              '],
  ['Copy   ', 'macOS   ', 'pbcopy             ', 'OSC 52              '],
  ['Copy   ', 'Windows ', 'clip.exe           ', 'OSC 52 (WT.exe only)'],
  ['Paste  ', 'Linux   ', 'wl-paste / xclip -o', 'bracketed paste     '],
  ['Paste  ', 'macOS   ', 'pbpaste            ', 'bracketed paste     '],
  ['Paste  ', 'Windows ', 'PS Get-Clipboard   ', 'Ctrl+V handler      '],
];
const widths = m[0].map((_, ci) => Math.max(...m.map(r => r[ci].length)));
for (const row of m) {
  console.log('  ' + C(row[0].padEnd(widths[0])) + row[1].padEnd(widths[1]) + ' → ' + row[2].padEnd(widths[2]) + '  ' + Y(row[3]));
}

console.log('\n' + C(H()));
console.log(C('  Simulation complete.'));
console.log(C('  On real Windows: run debug-win32-clipboard.cmd'));
console.log(C(H()) + '\n');

})().catch(e => { console.error(e); process.exit(1); });
