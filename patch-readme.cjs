const fs = require('fs');

let readme = fs.readFileSync('README.md', 'utf8');

// 1. Update version mentions
readme = readme.replace(/v2\.11/g, "v2.12");

// 2. Add Auto-OTP and Human-in-the-Loop highlights under What's New
const newFeatures = `### What's New in v2.12.0

### Autonomous Email Verification & OTP Extraction
AURIX can now autonomously sign up for services requiring email verification:
- **TempMail API integration**: Generates throwaway email addresses on the fly
- **Inbox Polling & Auto-Extraction**: Waits for incoming emails and uses Regex to automatically extract 4-8 digit OTPs or verification links — no need for the LLM to read bloated HTML emails
- **Browser Actions**: Exposed via \`get-temp-email\` and \`wait-email\` browser tools

### Interactive Human-in-the-Loop (HITL) Prompting
When AURIX needs real user credentials (not throwaway) or encounters an MFA prompt, it pauses execution without wasting tokens:
- **CLI Mode**: Pauses terminal execution and shows an interactive prompt asking you to paste the OTP.
- **Gateway Mode**: When running on Telegram, Discord, or WhatsApp, the agent stops and sends you a message ("Send your OTP for login"). It resumes only when you reply.
- **Under the hood**: Driven by the new \`ask_user\` tool that suspends the Promise loop.

### Human-like Browser Behaviors
Further reducing bot-detection across Arkose and Cloudflare:
- **Human-like Scroll**: Ease-out cubic animation with variable steps and a 20% chance of overshooting the target and correcting back.
- **Human-like Typing (\`humanType\`)**: Types with dynamic character delays, 5% QWERTY-proximity typo probability, and natural backspace corrections. 
- **Persona-Anchored Fingerprinting**: 5 realistic hardware combinations (e.g. Windows RTX 3080 Gamer, MacBook Pro M1) instead of randomized fingerprints.

`;

// Insert right before "### Hybrid CAPTCHA Solver" (which was the old v2.11 header)
readme = readme.replace("### Hybrid CAPTCHA Solver (Image + Audio)", newFeatures + "### Hybrid CAPTCHA Solver (Image + Audio)");

// 3. Update the description at the top to be more punchy based on user's request
const oldDesc = `AURIX is an **Autonomous Multi-Agent AI Workspace**. It is not a chat wrapper — it is an AI that has hands, eyes, and memory.`;
const newDesc = `AURIX is an **Autonomous Multi-Agent AI Workspace**. It is not a chat wrapper — it is an AI that has hands, eyes, and memory. 

**It can automatically control your social media, upload content, conduct deep research on it, and solve any CAPTCHA with hybrid AI audio-visual models.**`;

readme = readme.replace(oldDesc, newDesc);

fs.writeFileSync('README.md', readme);
console.log('README.md patched');
