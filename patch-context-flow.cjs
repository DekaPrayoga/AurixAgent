const fs = require('fs');
let ctx = fs.readFileSync('src/agent/Context.ts', 'utf8');

// 1. Refactor the negative file creation prompt into a positive workflow
const targetFileFlow = `  - To create files use write_file. NEVER use 'cat > file << EOF' or echo redirection in the terminal.
  - If you need to create a python script to run in the terminal, use write_file first, then run it with the terminal tool.`;

const injectFileFlow = `  - Follow this workflow to create and run scripts: First, write the complete code using the \`write_file\` tool. Then, execute the created file using the \`terminal\` tool. This ensures proper syntax highlighting and avoids terminal escaping issues.`;

if (ctx.includes(targetFileFlow)) {
  ctx = ctx.replace(targetFileFlow, injectFileFlow);
  console.log('File creation workflow refactored.');
}

// 2. Adjust the Dumb Loop / Failsafe logic to trigger on exact 3x identical commands
const targetLoop = `- SMART FAILSAFE: If a tool fails on the EXACT SAME TARGET twice in a row (e.g. failing to \`fill\` or \`click\` the same CSS selector), DO NOT LOOP. Stop, take a snapshot or screenshot to re-evaluate the DOM, or try a COMPLETELY DIFFERENT approach. Do NOT blindly spam the same failing command like a broken bot.`;

const injectLoop = `- ADAPTIVE PROBLEM SOLVING: If you attempt the exact same command 3 times and it fails every time, pause and re-evaluate the situation. Take a snapshot, review the error logs, or try a completely different approach before continuing.`;

if (ctx.includes(targetLoop)) {
  ctx = ctx.replace(targetLoop, injectLoop);
  console.log('Dumb loop logic updated to 3x exact command failsafe.');
}

fs.writeFileSync('src/agent/Context.ts', ctx);
