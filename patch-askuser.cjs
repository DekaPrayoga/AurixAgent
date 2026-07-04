const fs = require('fs');

let ask = fs.readFileSync('src/tools/AskUser.ts', 'utf8');

const target = `export let globalAskCallback: (sessionKey: string, question: string) => void = (s, q) => {`;
const inject = `export let globalAskCallback: (sessionKey: string, question: string, options?: string[]) => void = (s, q, o) => {`;

ask = ask.replace(target, inject);

const target2 = `export function setGlobalAskCallback(cb: (sessionKey: string, question: string) => void) {`;
const inject2 = `export function setGlobalAskCallback(cb: (sessionKey: string, question: string, options?: string[]) => void) {`;

ask = ask.replace(target2, inject2);

const target3 = `        description: 'The question, prompt, or instruction to show the user (e.g. "Please provide the OTP sent to your email").'
      }
    },
    required: ['question']`;

const inject3 = `        description: 'The question, prompt, or instruction to show the user (e.g. "Please provide the OTP sent to your email").'
      },
      options: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional array of choices to display as interactive buttons. E.g. ["Yes", "No"] or ["English", "Spanish"]'
      }
    },
    required: ['question']`;

if (!ask.includes("Optional array of choices")) {
  ask = ask.replace(target3, inject3);
}

const targetAsk = `  static async ask(sessionKey: string, question: string, askCallback: (q: string) => void): Promise<string> {
    return new Promise((resolve) => {
      // If there's already a pending question, resolve it to abort it
      if (this.pendings.has(sessionKey)) {
        this.pendings.get(sessionKey)!('Aborted: New question asked');
      }

      this.pendings.set(sessionKey, resolve);
      
      // Notify the frontend/gateway to display the question to the user
      askCallback(question);
    });
  }`;

const injectAsk = `  static async ask(sessionKey: string, question: string, options: string[] | undefined, askCallback: (q: string, o?: string[]) => void): Promise<string> {
    return new Promise((resolve) => {
      if (this.pendings.has(sessionKey)) {
        this.pendings.get(sessionKey)!('Aborted: New question asked');
      }
      this.pendings.set(sessionKey, resolve);
      askCallback(question, options);
    });
  }`;

ask = ask.replace(targetAsk, injectAsk);

const targetExecute = `      const answer = await AskUserManager.ask(sessionKey, question, (q) => {
        globalAskCallback(sessionKey, q);
      });`;

const injectExecute = `      const options = args.options as string[] | undefined;
      const answer = await AskUserManager.ask(sessionKey, question, options, (q, o) => {
        globalAskCallback(sessionKey, q, o);
      });`;

ask = ask.replace(targetExecute, injectExecute);

fs.writeFileSync('src/tools/AskUser.ts', ask);
console.log('AskUser.ts patched to support button options');
