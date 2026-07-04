const fs = require('fs');
let app = fs.readFileSync('src/cli/App.tsx', 'utf8');

const targetState = `  const [isProcessing, setIsProcessing] = useState(false);`;
const injectState = `  const [isProcessing, setIsProcessing] = useState(false);
  const [isAskingUser, setIsAskingUser] = useState(false);`;
if (!app.includes("isAskingUser")) {
  app = app.replace(targetState, injectState);
}

const targetCallback = `        setMessages(prev => [...prev, {
          role: 'system',
          content,
          timestamp: new Date()
        }]);
      }
    });`;
const injectCallback = `        setMessages(prev => [...prev, {
          role: 'system',
          content,
          timestamp: new Date()
        }]);
        setIsAskingUser(true);
      }
    });`;
if (app.includes(targetCallback)) {
  app = app.replace(targetCallback, injectCallback);
}

const targetSubmit = `  const handleSubmit = useCallback(async (text: string) => {
    if (AskUserManager.isWaiting('default')) {
      setMessages(prev => [...prev, { role: 'user', content: text, timestamp: new Date() }]);
      AskUserManager.submitAnswer('default', text);
      return;
    }`;
const injectSubmit = `  const handleSubmit = useCallback(async (text: string) => {
    if (AskUserManager.isWaiting('default')) {
      setMessages(prev => [...prev, { role: 'user', content: text, timestamp: new Date() }]);
      AskUserManager.submitAnswer('default', text);
      setIsAskingUser(false);
      return;
    }`;
if (app.includes(targetSubmit)) {
  app = app.replace(targetSubmit, injectSubmit);
}

const targetDisabled = `disabled={isProcessing || !!permissionPrompt || showLogin || !!connectModal || showWhatsApp}`;
const injectDisabled = `disabled={(isProcessing && !isAskingUser) || !!permissionPrompt || showLogin || !!connectModal || showWhatsApp}`;
if (app.includes(targetDisabled)) {
  app = app.replace(targetDisabled, injectDisabled);
}

fs.writeFileSync('src/cli/App.tsx', app);
console.log('App.tsx patched for isAskingUser state');
