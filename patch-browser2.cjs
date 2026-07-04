const fs = require('fs');

let browser = fs.readFileSync('src/tools/Browser.ts', 'utf8');

browser = browser.replace(/sessionId/g, "sessionName");

fs.writeFileSync('src/tools/Browser.ts', browser);
console.log('Patched Browser.ts successfully');
