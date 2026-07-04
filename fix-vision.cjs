const fs = require('fs');
let vision = fs.readFileSync('src/cli/VisionModal.tsx', 'utf8');

const target = `    if (name === 'v' && evt.ctrl) {
      evt.preventDefault();
      readClipboard().then(text => {`;

const inject = `    if (name === 'v' && evt.ctrl) {
      evt.preventDefault();
      import('child_process').then(({ execSync }) => {
        try {
          let text = '';
          if (process.platform === 'win32') text = execSync('powershell -NoProfile -Command "Get-Clipboard"', { encoding: 'utf8', windowsHide: true }).replace(/\\r\\n/g, '\\n').trimEnd();
          else if (process.platform === 'darwin') text = execSync('pbpaste', { encoding: 'utf8', timeout: 2000 }).replace(/\\r\\n/g, '\\n').trimEnd();
          else text = execSync('wl-paste --no-newline', { encoding: 'utf8', timeout: 2000 }).replace(/\\r\\n/g, '\\n').trimEnd();`;

if (vision.includes("readClipboard().then")) {
  vision = vision.replace(target, inject);
  fs.writeFileSync('src/cli/VisionModal.tsx', vision);
  console.log('Vision fixed');
}
