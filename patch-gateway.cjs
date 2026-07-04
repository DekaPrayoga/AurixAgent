const fs = require('fs');
let gateway = fs.readFileSync('src/gateway/Gateway.ts', 'utf8');

const target = `import { AskUserManager } from '../tools/AskUser.js';`;
const inject = `import { AskUserManager, setGlobalAskCallback } from '../tools/AskUser.js';`;

if (!gateway.includes("setGlobalAskCallback")) {
  gateway = gateway.replace(target, inject);
}

const targetConstructor = `  constructor(config: AurixConfig, registry: ToolRegistry) {
    super();
    this.config = config;
    this.registry = registry;
    this.startTime = Date.now();
  }`;

const injectConstructor = `  constructor(config: AurixConfig, registry: ToolRegistry) {
    super();
    this.config = config;
    this.registry = registry;
    this.startTime = Date.now();
    
    // Wire up global ask callback to send interactive buttons to the correct platform
    setGlobalAskCallback((sessionKey, question, options) => {
      const [platformName, channelId] = sessionKey.split(':');
      const platform = this.platforms.get(platformName);
      
      if (platform) {
        let sendOpts: any = undefined;
        
        // If the platform is Telegram and we have options, format as Inline Keyboard
        if (platformName === 'telegram' && options && options.length > 0) {
          sendOpts = {
            reply_markup: {
              inline_keyboard: [
                options.map(opt => ({ text: opt, callback_data: opt }))
              ]
            }
          };
        }
        
        // Push the question to the platform
        platform.send(\`⏳ *Action Required*\\n\\n\${question}\`, channelId, undefined, sendOpts).catch(() => {});
      } else {
        // Fallback if not a gateway session (e.g. CLI 'default')
        console.log(\`\\n[Action Required] \${question}\`);
        if (options) console.log(\`Options: \${options.join(' | ')}\`);
      }
    });
  }`;

if (!gateway.includes("setGlobalAskCallback(")) {
  gateway = gateway.replace(targetConstructor, injectConstructor);
  fs.writeFileSync('src/gateway/Gateway.ts', gateway);
  console.log('Gateway.ts patched for AskUser routing');
}
