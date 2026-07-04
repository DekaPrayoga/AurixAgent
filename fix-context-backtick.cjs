const fs = require('fs');
let ctx = fs.readFileSync('src/agent/Context.ts', 'utf8');

// Escape the backticks around ask_user
ctx = ctx.replace(
  "- NEVER use `ask_user` to request API keys",
  "- NEVER use \\`ask_user\\` to request API keys"
);

fs.writeFileSync('src/agent/Context.ts', ctx);
