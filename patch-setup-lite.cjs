const fs = require('fs');

let setup = fs.readFileSync('src/agent/Setup.ts', 'utf8');

const target = `{ id: 'cli_dashboard', label: 'CLI + Gateway + Web Dashboard', desc: 'Spins up the Next.js Web UI on http://localhost:3000' }`;
const inject = `{ id: 'cli_dashboard', label: 'CLI + Gateway + Web Dashboard', desc: 'Spins up the Next.js Web UI on http://localhost:3000' },
      { id: 'lite_mode', label: 'Lite Mode (Text Only)', desc: 'Fast, basic scrolling terminal UI without OpenTUI (like Claude Code)' }`;

if (!setup.includes("lite_mode")) {
  setup = setup.replace(target, inject);
  
  // also add the flag mapping
  const targetRet = `if (ans === '__skip__' || ans === 'cli_only') return false;`;
  const injectRet = `if (ans === 'lite_mode') { process.argv.push('--lite'); return false; }\n  if (ans === '__skip__' || ans === 'cli_only') return false;`;
  setup = setup.replace(targetRet, injectRet);

  fs.writeFileSync('src/agent/Setup.ts', setup);
  console.log('Setup.ts patched for Lite Mode option');
}
