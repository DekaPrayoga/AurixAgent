const fs = require('fs');
let setup = fs.readFileSync('src/agent/Setup.ts', 'utf8');

const target = `    prompt: 'Dashboard Mode:',`;
const inject = `    title: 'Dashboard Mode:',`;
setup = setup.replace(target, inject);

// Remove the unsupported subtitle field and append it to the title instead
const target2 = `    subtitle: '*You Can Change This Setting By aurix dashboard or aurix dashboard --shutdown or click on shutdown on the website',`;
const inject2 = ``;
setup = setup.replace(target2, inject2);

const target3 = `title: 'Dashboard Mode:',`;
const inject3 = `title: 'Dashboard Mode: (*You Can Change This Setting By aurix dashboard or aurix dashboard --shutdown or click on shutdown on the website)',`;
setup = setup.replace(target3, inject3);

fs.writeFileSync('src/agent/Setup.ts', setup);
console.log('Setup patched again');
