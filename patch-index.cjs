const fs = require('fs');

let index = fs.readFileSync('src/index.tsx', 'utf8');

// Inside main(), right before booting the renderer or App
const target = `  const registry = new ToolRegistry();`;
const inject = `  const registry = new ToolRegistry();

  if (config.enableDashboard) {
    import('./api/Server.js').then(({ AurixServer }) => {
      const server = new AurixServer(registry);
      server.start(3000);
    }).catch(e => {
      console.error('Failed to auto-start dashboard server:', e);
    });
  }
`;

if (!index.includes("config.enableDashboard")) {
  index = index.replace(target, inject);
  fs.writeFileSync('src/index.tsx', index);
  console.log('src/index.tsx patched');
}
