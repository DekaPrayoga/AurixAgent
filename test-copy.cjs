const { execSync } = require('child_process');

function testCopy() {
  try {
    const out = execSync('powershell -NoProfile -Command "Get-Clipboard"', { encoding: 'utf8', timeout: 2000, windowsHide: true });
    console.log('Result:', JSON.stringify(out));
  } catch (e) {
    console.log('Error:', e.message);
  }
}
testCopy();
