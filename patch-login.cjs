const fs = require('fs');

let login = fs.readFileSync('src/cli/LoginModal.tsx', 'utf8');

// 1. Fix readClipboard timeout
login = login.replace("execSync('powershell -NoProfile -Command \"Get-Clipboard\"', { encoding: 'utf8', timeout: 2000, windowsHide: true })", "execSync('powershell -NoProfile -Command \"Get-Clipboard\"', { encoding: 'utf8', windowsHide: true })");

// 2. Add ctrl+v handling inside useKeyboard
const target = `    if (name === 'backspace') {`;
const inject = `    if (name === 'v' && evt.ctrl) {
      evt.preventDefault();
      readClipboard().then(text => {
        if (!text) return;
        const insertAt = cursor;
        current.setter((prev: string) => prev.slice(0, insertAt) + text + prev.slice(insertAt));
        setCursor(insertAt + text.length);
      }).catch(() => {});
      return;
    }

    if (name === 'backspace') {`;

if (!login.includes("name === 'v' && evt.ctrl")) {
  login = login.replace(target, inject);
  fs.writeFileSync('src/cli/LoginModal.tsx', login);
  console.log('LoginModal patched for Ctrl+V');
}
