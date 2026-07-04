const fs = require('fs');

let config = fs.readFileSync('src/agent/Config.ts', 'utf8');

// Add enableDashboard to interface
if (!config.includes("enableDashboard?: boolean;")) {
  config = config.replace(
    "gateway?: GatewayConfig;",
    "gateway?: GatewayConfig;\n  enableDashboard?: boolean;"
  );
}

// Map it in mergeWithEnv
if (!config.includes("enableDashboard: file.enableDashboard,")) {
  config = config.replace(
    "gateway: file.gateway,",
    "gateway: file.gateway,\n    enableDashboard: file.enableDashboard,"
  );
}

fs.writeFileSync('src/agent/Config.ts', config);
console.log('Config.ts patched');
