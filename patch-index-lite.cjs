const fs = require('fs');

let index = fs.readFileSync('src/index.tsx', 'utf8');

if (!index.includes("import { runLiteApp }")) {
  index = index.replace(
    "import { App } from './cli/App.js';",
    "import { App } from './cli/App.js';\nimport { runLiteApp } from './cli/LiteApp.js';"
  );
}

const targetRender = `const root = createRoot(renderer);
  root.render(
    <App 
      config={config} 
      registry={registry} 
      onExit={() => {
        root.unmount();
        process.exit(0);
      }} 
    />
  );`;

const injectRender = `  if (process.argv.includes('--lite')) {
    await runLiteApp(config, registry);
  } else {
    const root = createRoot(renderer);
    root.render(
      <App 
        config={config} 
        registry={registry} 
        onExit={() => {
          root.unmount();
          process.exit(0);
        }} 
      />
    );
  }`;

if (!index.includes("process.argv.includes('--lite')")) {
  index = index.replace(targetRender, injectRender);
  fs.writeFileSync('src/index.tsx', index);
  console.log('src/index.tsx patched for --lite mode fallback');
}
