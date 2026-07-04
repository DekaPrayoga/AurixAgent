const fs = require('fs');
let browser = fs.readFileSync('src/tools/Browser.ts', 'utf8');

// 1. Import Metrics
if (!browser.includes("import { Metrics }")) {
  browser = browser.replace(
    "import { loadConfig } from '../agent/Config.js';",
    "import { loadConfig } from '../agent/Config.js';\nimport { Metrics } from '../agent/Metrics.js';"
  );
}

// 2. Add Uptime to case 'status'
const target = `          return \`Browser: running\\nEngine: Chromium\\nProfile: \${session.profileDir}\\nMode: \${browserHeadless ? 'headless' : 'headed'}\\nProxy: \${browserProxy || 'none'}\\nURL: \${session.page.url()}\\nTitle: \${title}\\nOpen tabs: \${session.context.pages().length}\`;`;
const inject = `          return \`Browser: running\\nEngine: Chromium\\nProfile: \${session.profileDir}\\nMode: \${browserHeadless ? 'headless' : 'headed'}\\nProxy: \${browserProxy || 'none'}\\nURL: \${session.page.url()}\\nTitle: \${title}\\nOpen tabs: \${session.context.pages().length}\\nAurix Uptime: \${Metrics.getUptimeFormatted()}\`;`;

if (browser.includes(target)) {
  browser = browser.replace(target, inject);
  fs.writeFileSync('src/tools/Browser.ts', browser);
  console.log('Browser status patched with uptime');
}
