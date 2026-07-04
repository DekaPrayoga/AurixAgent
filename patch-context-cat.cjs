const fs = require('fs');
let ctx = fs.readFileSync('src/agent/Context.ts', 'utf8');

const target = `  - To create files use write_file instead of cat with heredoc or echo redirection`;
const inject = `  - To create files use write_file. NEVER use 'cat > file << EOF' or echo redirection in the terminal.
  - If you need to create a python script to run in the terminal, use write_file first, then run it with the terminal tool.`;

if (ctx.includes(target)) {
  ctx = ctx.replace(target, inject);
  fs.writeFileSync('src/agent/Context.ts', ctx);
  console.log('Context.ts patched for write_file enforcement');
}
