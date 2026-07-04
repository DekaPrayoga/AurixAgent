const fs = require('fs');
let setup = fs.readFileSync('src/agent/Setup.ts', 'utf8');

const target = `  const ans = await drawSelector('Dashboard Mode:', [`;
const inject = `  const ans = await drawSelector({
    prompt: 'Dashboard Mode:',
    items: [
      { id: 'cli_only', label: 'CLI + Gateway Only', desc: 'Lightweight, runs only the terminal and gateway features' },
      { id: 'cli_dashboard', label: 'CLI + Gateway + Web Dashboard', desc: 'Spins up the Next.js Web UI on http://localhost:3000' }
    ],
    subtitle: '*You Can Change This Setting By aurix dashboard or aurix dashboard --shutdown or click on shutdown on the website',
    allowSkip: true
  });`;

setup = setup.replace(/  const ans = await drawSelector\('Dashboard Mode:', \[\n[\s\S]*?  \}\);/m, inject);
fs.writeFileSync('src/agent/Setup.ts', setup);
console.log('Setup patched');
