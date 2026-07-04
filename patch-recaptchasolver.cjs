const fs = require('fs');

let solver = fs.readFileSync('src/tools/captcha/RecaptchaSolver.ts', 'utf8');

const target1 = `_dbg(\`WARNING: Model "\${visionModel}" is not a vision model. Auto-switching to audio captcha mode.\`);
    _dbg(\`Please set up Groq API key (get free key at https://console.groq.com/docs/speech-to-text) or install local Whisper.\`);
    _dbg(\`Set groqApiKey in config.yaml or run: pip install openai-whisper\`);`;

const inject1 = `_dbg(\`WARNING: Model "\${visionModel}" is not a vision model. Auto-switching to audio captcha mode.\`);
    _dbg(\`[DO NOT ASK THE USER FOR API KEYS - THE SYSTEM WILL HANDLE IT INTERNALLY VIA CONFIG.YAML OR WHISPER]\`);`;

if (solver.includes("Please set up Groq API key")) {
  solver = solver.replace(target1, inject1);
  fs.writeFileSync('src/tools/captcha/RecaptchaSolver.ts', solver);
  console.log('RecaptchaSolver patched');
}
