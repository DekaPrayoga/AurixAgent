const fs = require('fs');

if (fs.existsSync('src/cli/ConnectModal.tsx')) {
  let connect = fs.readFileSync('src/cli/ConnectModal.tsx', 'utf8');

  const target = `    if (name === 'backspace') {`;
  const inject = `    if (name === 'v' && evt.ctrl) {
      evt.preventDefault();
      // Import readClipboard from child_process dynamically
      import('child_process').then(({ execSync }) => {
        try {
          let text = '';
          if (process.platform === 'win32') text = execSync('powershell -NoProfile -Command "Get-Clipboard"', { encoding: 'utf8', windowsHide: true }).replace(/\\r\\n/g, '\\n').trimEnd();
          else if (process.platform === 'darwin') text = execSync('pbpaste', { encoding: 'utf8', timeout: 2000 }).replace(/\\r\\n/g, '\\n').trimEnd();
          else text = execSync('wl-paste --no-newline', { encoding: 'utf8', timeout: 2000 }).replace(/\\r\\n/g, '\\n').trimEnd();
          if (!text) return;
          const insertAt = cursor;
          setValue(prev => prev.slice(0, insertAt) + text + prev.slice(insertAt));
          setCursor(insertAt + text.length);
        } catch {}
      }).catch(() => {});
      return;
    }

    if (name === 'backspace') {`;

  if (!connect.includes("name === 'v' && evt.ctrl")) {
    connect = connect.replace(target, inject);
    fs.writeFileSync('src/cli/ConnectModal.tsx', connect);
    console.log('ConnectModal patched for Ctrl+V');
  }
}
