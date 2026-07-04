const fs = require('fs');
let browser = fs.readFileSync('src/tools/Browser.ts', 'utf8');

const target = `      if (process.platform === 'win32') {
        // cloakbrowser's custom Chromium on Windows only supports
        // --fingerprint-*, --window-size, --no-first-run, --no-default-browser-check.
        // All --disable-* and --no-sandbox flags cause "unsupported command-line flag"
        // warnings and silent navigation failures (about:blank).
        return base.filter(a =>
          a.startsWith('--fingerprint') ||
          a.startsWith('--window-size') ||
          a === '--no-first-run' ||
          a === '--no-default-browser-check'
        );
      }`;

const inject = `      if (process.platform === 'win32') {
        // Absolute minimal args for Windows to prevent about:blank navigation silent failures
        // We drop ALL custom cloakbrowser flags and use only the bare minimum for Playwright
        return [
          '--ignore-certificate-errors',
          '--no-first-run',
          '--no-default-browser-check',
          \`--window-size=\${vp.width},\${vp.height}\`
        ];
      }`;

if (browser.includes(target)) {
  browser = browser.replace(target, inject);
  fs.writeFileSync('src/tools/Browser.ts', browser);
  console.log('Browser.ts patched for Windows minimal args');
} else {
  console.log('Browser.ts Windows arg patch target not found');
}
