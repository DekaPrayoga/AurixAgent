const fs = require('fs');

let setup = fs.readFileSync('src/agent/Setup.ts', 'utf8');

// 1. Add stepDashboard function
const dashboardFunc = `
async function stepDashboard(): Promise<boolean> {
  const ans = await drawSelector('Dashboard Mode:', [
    { id: 'cli_only', label: 'CLI + Gateway Only', desc: 'Lightweight, runs only the terminal and gateway features' },
    { id: 'cli_dashboard', label: 'CLI + Gateway + Web Dashboard', desc: 'Spins up the Next.js Web UI on http://localhost:3000' }
  ], {
    subtitle: '*You Can Change This Setting By aurix dashboard or aurix dashboard --shutdown or click on shutdown on the website'
  });

  if (ans === '__skip__' || ans === 'cli_only') return false;
  return true;
}
`;

if (!setup.includes("async function stepDashboard()")) {
  setup += dashboardFunc;
}

// 2. Inject it into runSetup
const targetRun = `  const captchaAudio = await stepCaptcha();`;
const injectRun = `  const captchaAudio = await stepCaptcha();\n  const enableDashboard = await stepDashboard();`;

if (!setup.includes("const enableDashboard = await stepDashboard();")) {
  setup = setup.replace(targetRun, injectRun);
}

// 3. Save to config
const targetSave = `    captchaAudio: captchaAudio.mode,`;
const injectSave = `    captchaAudio: captchaAudio.mode,\n    enableDashboard: enableDashboard,`;

if (setup.includes(targetSave) && !setup.includes("enableDashboard: enableDashboard")) {
  setup = setup.replace(targetSave, injectSave);
}

fs.writeFileSync('src/agent/Setup.ts', setup);
console.log('Setup.ts patched');
