const fs = require('fs');

let app = fs.readFileSync('src/cli/App.tsx', 'utf8');

// 1. Add AskUserManager import
if (!app.includes("AskUserManager")) {
  app = app.replace("import { TokenCounter }", "import { TokenCounter }\nimport { AskUserManager, setGlobalAskCallback } from '../tools/AskUser.js';");
}

// 2. Set the global callback
const callbackCode = `
    const counter = new TokenCounter();
    agentRef.current = new AgentLoop(config, registry);
    agentRef.current.setTokenCounter(counter);
    setTokenCounter(counter);

    setGlobalAskCallback((sessionKey, question) => {
      if (sessionKey === 'default') {
        setMessages(prev => [...prev, {
          role: 'system',
          content: \`[Human-in-the-Loop Required] \${question}\`,
          timestamp: new Date()
        }]);
      }
    });
`;
app = app.replace(`    const counter = new TokenCounter();
    agentRef.current = new AgentLoop(config, registry);
    agentRef.current.setTokenCounter(counter);
    setTokenCounter(counter);`, callbackCode);


// 3. Intercept input in handleSubmit
const interception = `  const handleSubmit = useCallback(async (text: string) => {
    if (AskUserManager.isWaiting('default')) {
      setMessages(prev => [...prev, { role: 'user', content: text, timestamp: new Date() }]);
      AskUserManager.submitAnswer('default', text);
      return;
    }

    if (isProcessing) return;`;
    
app = app.replace("  const handleSubmit = useCallback(async (text: string) => {\n    if (isProcessing) return;", interception);

fs.writeFileSync('src/cli/App.tsx', app);
console.log('Patched App.tsx successfully');
