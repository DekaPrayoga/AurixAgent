const fs = require('fs');

let ctx = fs.readFileSync('src/agent/Context.ts', 'utf8');

const target = `# NEVER ASK — JUST DO`;
const inject = `# NEVER ASK — JUST DO
- NEVER use \`ask_user\` to request API keys, tokens, or passwords (e.g. Groq API keys, OpenAI keys). Keys are managed internally by the system. If a tool output says a key is missing, DO NOT ask the user for it. Simply fail gracefully or continue with another task.`;

if (!ctx.includes("NEVER use \`ask_user\` to request API keys")) {
  ctx = ctx.replace(target, inject);
  fs.writeFileSync('src/agent/Context.ts', ctx);
  console.log('Context patched');
}
