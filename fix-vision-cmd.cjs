const fs = require('fs');

let app = fs.readFileSync('src/cli/App.tsx', 'utf8');

const targetVision = `      if (commandName === 'mcp') {`;
const injectVision = `      if (commandName === 'vision') {
        setShowVisionConfig(true);
        return;
      }
      if (commandName === 'mcp') {`;

if (app.includes(targetVision) && !app.includes("commandName === 'vision'")) {
  app = app.replace(targetVision, injectVision);
  fs.writeFileSync('src/cli/App.tsx', app);
  console.log('App.tsx patched for /vision command');
}
