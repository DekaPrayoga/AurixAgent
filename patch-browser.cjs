const fs = require('fs');

let browser = fs.readFileSync('src/tools/Browser.ts', 'utf8');

// Add import
const importStatement = "import { TempMail } from './tempmail/TempMail';\nimport { FuncaptchaSolver";
browser = browser.replace("import { FuncaptchaSolver", importStatement);

// Add TempMail map at module level
const tempMailMap = "\nconst tempMails = new Map<string, TempMail>();\n\ninterface BrowserSession";
browser = browser.replace("interface BrowserSession", tempMailMap);

// Add case handlers just before case 'status'
const newCases = `        case 'get-temp-email': {
          if (!tempMails.has(sessionId)) {
            tempMails.set(sessionId, new TempMail());
          }
          const tempMail = tempMails.get(sessionId)!;
          try {
            const address = await tempMail.initialize();
            return ok(\`Temporary email generated: \${address}\`, { 
              email: address, 
              note: 'Use this email to sign up, then use action "wait-email" to check the inbox for verification code/links.'
            });
          } catch (e: any) {
            return err(\`Failed to get temp email: \${e.message}\`);
          }
        }

        case 'wait-email': {
          if (!tempMails.has(sessionId)) {
            return err('No temporary email generated for this session. Use "get-temp-email" first.');
          }
          const tempMail = tempMails.get(sessionId)!;
          const { timeout = 60, regex } = (typeof options === 'object' ? options : {});
          
          try {
            const result = await tempMail.waitForEmail(Number(timeout), regex ? String(regex) : undefined);
            
            return ok(\`Email received: "\${result.subject}"\`, {
              extracted: result.extracted || 'Regex/Auto-extract did not find anything',
              body_preview: result.text
            });
          } catch (e: any) {
            return err(\`Wait email failed: \${e.message}\`);
          }
        }

        case 'status': {`;

browser = browser.replace("        case 'status': {", newCases);

fs.writeFileSync('src/tools/Browser.ts', browser);
console.log('Patched Browser.ts successfully');
