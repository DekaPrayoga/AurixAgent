const fs = require('fs');

let app = fs.readFileSync('src/cli/App.tsx', 'utf8');

// Inject setGlobalAskCallback into App.tsx init hook.
// Finding a good place to put it: inside a useEffect that runs once.
const target = "  useEffect(() => {";
const callbackCode = `  useEffect(() => {
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
app = app.replace(target, callbackCode);

fs.writeFileSync('src/cli/App.tsx', app);
console.log('App callback patched');
