const fs = require('fs');
let index = fs.readFileSync('src/index.tsx', 'utf8');

const target = `import { App } from './cli/App.js';`;
const inject = `import { App } from './cli/App.js';

// --- CRITICAL FIX FOR 9ROUTER / LOCALHOST PROXY ISSUES ---
// Node.js/Bun fetch aggressively uses these env vars, causing local requests (127.0.0.1:20128)
// to be routed through residential proxies and returning 403 Connect BanAddress.
// We must delete them from the process environment so internal LLM requests are direct.
delete process.env.HTTP_PROXY;
delete process.env.http_proxy;
delete process.env.HTTPS_PROXY;
delete process.env.https_proxy;
delete process.env.ALL_PROXY;
delete process.env.all_proxy;
`;

if (!index.includes("delete process.env.HTTP_PROXY")) {
  index = index.replace(target, inject);
  fs.writeFileSync('src/index.tsx', index);
  console.log('src/index.tsx patched to nuke global proxy envs');
}
