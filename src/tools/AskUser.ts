import type { Tool } from './Registry.js';

export class AskUserManager {
  // Key: sessionKey/agentKey, Value: Promise resolver callback
  private static pendings = new Map<string, (answer: string) => void>();

  /**
   * Prompts the user and waits for their response.
   * This suspends the execution until the user replies.
   */
  static async ask(sessionKey: string, question: string, askCallback: (q: string) => void): Promise<string> {
    return new Promise((resolve) => {
      // If there's already a pending question, resolve it to abort it
      if (this.pendings.has(sessionKey)) {
        this.pendings.get(sessionKey)!('Aborted: New question asked');
      }

      this.pendings.set(sessionKey, resolve);
      
      // Notify the frontend/gateway to display the question to the user
      askCallback(question);
    });
  }

  /**
   * Checks if a session is currently waiting for a user answer
   */
  static isWaiting(sessionKey: string): boolean {
    return this.pendings.has(sessionKey);
  }

  /**
   * Provides the answer to the pending question and resumes execution
   */
  static submitAnswer(sessionKey: string, answer: string): boolean {
    const resolve = this.pendings.get(sessionKey);
    if (resolve) {
      this.pendings.delete(sessionKey);
      resolve(answer);
      return true;
    }
    return false;
  }
}

// Global callback set by App.tsx (CLI) or Gateway.ts to physically show the message to the user
export let globalAskCallback: (sessionKey: string, question: string) => void = (s, q) => {
  console.log(`[AskUser: ${s}] ${q}`);
};

export function setGlobalAskCallback(cb: (sessionKey: string, question: string) => void) {
  globalAskCallback = cb;
}

export const askUserTool: Tool = {
  name: 'ask_user',
  description: 'Pause execution and ask the user a question. Use this when you need OTP, passwords, or explicit choices from the human. The tool execution will pause until the user replies.',
  parameters: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'The question, prompt, or instruction to show the user (e.g. "Please provide the OTP sent to your email").'
      }
    },
    required: ['question']
  },
  async execute(args: Record<string, unknown>): Promise<string> {
    const question = String(args.question || 'Awaiting user input...');
    // We use a global variable injected by the loop or context to know the current session key
    // For simplicity, if args.sessionKey is provided we use it, otherwise 'default' for CLI
    const sessionKey = (args._sessionKey as string) || 'default';
    
    try {
      const answer = await AskUserManager.ask(sessionKey, question, (q) => {
        globalAskCallback(sessionKey, q);
      });
      return `User answered: ${answer}`;
    } catch (e: any) {
      return `Failed to ask user: ${e.message}`;
    }
  }
};
