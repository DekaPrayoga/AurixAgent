const fs = require('fs');

if (fs.existsSync('src/cli/VisionModal.tsx')) {
  let vision = fs.readFileSync('src/cli/VisionModal.tsx', 'utf8');

  // Fix timeout
  vision = vision.replace("execSync('powershell -NoProfile -Command \"Get-Clipboard\"', { encoding: 'utf8', timeout: 2000, windowsHide: true })", "execSync('powershell -NoProfile -Command \"Get-Clipboard\"', { encoding: 'utf8', windowsHide: true })");

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

  if (!vision.includes("name === 'v' && evt.ctrl")) {
    vision = vision.replace(target, inject);
    fs.writeFileSync('src/cli/VisionModal.tsx', vision);
    console.log('VisionModal patched for Ctrl+V');
  }
}
