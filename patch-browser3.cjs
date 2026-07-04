const fs = require('fs');

let browser = fs.readFileSync('src/tools/Browser.ts', 'utf8');

// fix sessionName -> sessionId for the new switch cases only
const regex = /case 'get-temp-email': [\s\S]*?case 'status': \{/g;
let match = browser.match(regex);
if (match) {
  let modified = match[0].replace(/sessionName/g, "sessionId");
  browser = browser.replace(match[0], modified);
  fs.writeFileSync('src/tools/Browser.ts', browser);
  console.log('Fixed sessionId');
} else {
  console.log('regex match not found');
}
