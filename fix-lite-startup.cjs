const fs = require('fs');

let idx = fs.readFileSync('src/index.tsx', 'utf8');

// The React createRoot(renderer) complains if it's called or instantiated when we don't actually render it,
// so we need to defer or separate the renderer creation.
// Currently it's doing: `renderer = await createCliRenderer(...)` before checking `--lite`.
const targetRenderBlock = `  let renderer;
  try {
    renderer = await createCliRenderer({
      clearOnMount: true,
      fullscreen: true,
    });
  } catch (e: any) {
    drawWarning('OpenTUI renderer failed to initialize.');
    console.error(e.message);
    process.exit(1);
  }

  const { createRoot } = require('react-reconciler/constants');`;

const injectRenderBlock = `
  if (process.argv.includes('--lite')) {
    await runLiteApp(config, registry);
    return;
  }

  let renderer;
  try {
    renderer = await createCliRenderer({
      clearOnMount: true,
      fullscreen: true,
    });
  } catch (e: any) {
    drawWarning('OpenTUI renderer failed to initialize.');
    console.error(e.message);
    process.exit(1);
  }

  const { createRoot } = require('react-reconciler/constants');`;

if (idx.includes(targetRenderBlock)) {
  idx = idx.replace(targetRenderBlock, injectRenderBlock);
  fs.writeFileSync('src/index.tsx', idx);
  console.log('src/index.tsx patched for Lite mode startup');
}
