const fs = require('fs');
let ctx = fs.readFileSync('src/agent/Context.ts', 'utf8');

const targetLoop = `- SMART FAILSAFE: If a tool fails on the EXACT SAME TARGET twice in a row (e.g. failing to \`fill\` or \`click\` the same CSS selector), DO NOT LOOP. Stop, take a snapshot or screenshot to re-evaluate the DOM, or try a COMPLETELY DIFFERENT approach. Do NOT blindly spam the same failing command like a broken bot.`;

const injectLoop = `- ADAPTIVE PROBLEM SOLVING: If you attempt the exact same command 3 times and it fails every time, pause and re-evaluate the situation. Review the error logs, inspect the state (e.g., take a browser snapshot if in a web task, or read the directory/file), or try a completely different approach before continuing.`;

if (ctx.includes(targetLoop)) {
  ctx = ctx.replace(targetLoop, injectLoop);
  console.log('Dumb loop logic updated for context-aware snapshotting.');
  fs.writeFileSync('src/agent/Context.ts', ctx);
}
