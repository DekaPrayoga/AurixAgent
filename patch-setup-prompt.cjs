const fs = require('fs');

if (fs.existsSync('src/cli/SetupUI.ts')) {
  let setup = fs.readFileSync('src/cli/SetupUI.ts', 'utf8');

  // In readLine function, inject CTRL+V intercept
  const target = `      // Handle regular characters
      if (ch.length === 1 && !escBuf) {`;
      
  const inject = `      // CTRL+V
      if (ch === '\\x16') {
        try {
          const { execSync } = require('child_process');
          let text = '';
          if (process.platform === 'win32') text = execSync('powershell -NoProfile -Command "Get-Clipboard"', { encoding: 'utf8', windowsHide: true }).replace(/\\r\\n/g, '\\n').trimEnd();
          else if (process.platform === 'darwin') text = execSync('pbpaste', { encoding: 'utf8', timeout: 2000 }).replace(/\\r\\n/g, '\\n').trimEnd();
          else text = execSync('wl-paste --no-newline', { encoding: 'utf8', timeout: 2000 }).replace(/\\r\\n/g, '\\n').trimEnd();
          
          if (text) {
            buf = buf.slice(0, cursor) + text + buf.slice(cursor);
            cursor += text.length;
            selStart = selEnd = -1;
            renderLine();
          }
        } catch {}
        return;
      }
      
      // Handle regular characters
      if (ch.length === 1 && !escBuf) {`;

  if (!setup.includes("if (ch === '\\x16')")) {
    setup = setup.replace(target, inject);
    fs.writeFileSync('src/cli/SetupUI.ts', setup);
    console.log('SetupUI readLine patched for Ctrl+V');
  }
}
