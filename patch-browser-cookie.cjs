const fs = require('fs');

let browser = fs.readFileSync('src/tools/Browser.ts', 'utf8');

// 1. Add description to parameters
const paramTarget = `          return err(\`Unknown action: "\${action}"\`, \`Available: navigate, click, fill, type, screenshot, snapshot, text, html, url, title, scroll, back, forward, press-key, select, wait, evaluate, new-tab, switch-tab, close-tab, open-tabs, cookies, upload, signup-assist, signin-assist, get-temp-email, wait-email, set-proxy, set-ui, detect-captcha, solve-captcha, get-temp-email, wait-email, captcha-grid, click-tile, captcha-verify, slider-analyze, drag-to, hold-click, close, status\`);`;
const paramInject = `          return err(\`Unknown action: "\${action}"\`, \`Available: navigate, click, fill, type, screenshot, snapshot, text, html, url, title, scroll, back, forward, press-key, select, wait, evaluate, new-tab, switch-tab, close-tab, open-tabs, cookies, upload, signup-assist, signin-assist, get-temp-email, wait-email, set-proxy, set-ui, detect-captcha, solve-captcha, get-temp-email, wait-email, captcha-grid, click-tile, captcha-verify, slider-analyze, drag-to, hold-click, close, status, extract-cookies\`);`;

if (!browser.includes("extract-cookies")) {
  browser = browser.replace(paramTarget, paramInject);
}

// 2. Add the actual case logic
const caseTarget = `        case 'status': {`;
const caseInject = `        case 'extract-cookies': {
          try {
            const { exec } = await import('child_process');
            const { promisify } = await import('util');
            const execAsync = promisify(exec);
            
            // We use Python to run the extraction logic. We assume the system has python3 installed.
            // Using a simple inline script that calls the existing cookie_extract.py logic
            const pythonScript = \`
import sys
import json
import os
sys.path.insert(0, os.path.abspath('skills/research/social-researching/scripts'))
try:
    from lib.cookie_extract import extract_cookies
    # Try all browsers in auto mode
    cookies = extract_cookies('auto', '.x.com', ['auth_token', 'ct0'])
    if cookies:
        print(json.dumps(cookies))
    else:
        print(json.dumps({"error": "No cookies found"}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
\`;
            
            const { stdout } = await execAsync(\`python3 -c "\${pythonScript.replace(/\\n/g, '\\n')}"\`);
            const parsed = JSON.parse(stdout.trim());
            
            if (parsed.error) {
              return err(\`Cookie extraction failed: \${parsed.error}\`);
            }
            
            if (parsed.auth_token && parsed.ct0) {
              const envContent = \`AUTH_TOKEN="\${parsed.auth_token}"\\nCT0="\${parsed.ct0}"\\n\`;
              const fsNode = await import('fs');
              const envPath = 'skills/research/social-researching/.env';
              fsNode.writeFileSync(envPath, envContent);
              return ok('Successfully extracted Twitter cookies from local browser and saved to .env', {
                auth_token: parsed.auth_token.substring(0, 10) + '...',
                ct0: parsed.ct0.substring(0, 10) + '...'
              });
            } else {
              return err('Cookies extracted but missing auth_token or ct0');
            }
          } catch (e: any) {
            return err(\`Failed to extract cookies: \${e.message}\`);
          }
        }

        case 'status': {`;

if (!browser.includes("case 'extract-cookies':")) {
  browser = browser.replace(caseTarget, caseInject);
  fs.writeFileSync('src/tools/Browser.ts', browser);
  console.log('Browser.ts patched with extract-cookies');
}
