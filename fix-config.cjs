const fs = require('fs');
let config = fs.readFileSync('src/agent/Config.ts', 'utf8');
if (!config.includes("enableDashboard?: boolean;")) {
  config = config.replace(
    "gateway?: {",
    "enableDashboard?: boolean;\n  gateway?: {"
  );
  fs.writeFileSync('src/agent/Config.ts', config);
}
