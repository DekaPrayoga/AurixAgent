const fs = require('fs');
let ctx = fs.readFileSync('src/agent/Context.ts', 'utf8');

// The bug is unescaped backticks in a template literal.
// We need to change \`write_file\` to \\\`write_file\\\`
const target = `  - Follow this workflow to create and run scripts: First, write the complete code using the \`write_file\` tool. Then, execute the created file using the \`terminal\` tool. This ensures proper syntax highlighting and avoids terminal escaping issues.`;
const inject = `  - Follow this workflow to create and run scripts: First, write the complete code using the \\\`write_file\\\` tool. Then, execute the created file using the \\\`terminal\\\` tool. This ensures proper syntax highlighting and avoids terminal escaping issues.`;

if (ctx.includes(target)) {
  ctx = ctx.replace(target, inject);
  fs.writeFileSync('src/agent/Context.ts', ctx);
  console.log('Fixed quotes in Context.ts');
}
