import type { Tool } from './Registry.js';

export class AskUserManager {
  // Key: sessionKey/agentKey, Value: Promise resolver callback
  private static pendings = new Map<
    string,
    { resolve: (answer: string) => void; reject: (error: Error) => void }
  >();

  /**
   * Prompts the user and waits for their response.
   * This suspends the execution until the user replies.
   */
  static async ask(
    sessionKey: string,
    question: string,
    options: string[] | undefined,
    askCallback: (q: string, o?: string[]) => void
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const existing = this.pendings.get(sessionKey);
      if (existing) {
        existing.reject(new Error('New question asked'));
      }
      this.pendings.set(sessionKey, { resolve, reject });
      askCallback(question, options);
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
    const pending = this.pendings.get(sessionKey);
    if (pending) {
      this.pendings.delete(sessionKey);
      pending.resolve(answer);
      return true;
    }
    return false;
  }
}

// Global callback set by App.tsx (CLI) or Gateway.ts to physically show the message to the user
export let globalAskCallback: (sessionKey: string, question: string, options?: string[]) => void = (
  s,
  q,
  o
) => {
  console.log(`[AskUser: ${s}] ${q}`);
};

export function setGlobalAskCallback(
  cb: (sessionKey: string, question: string, options?: string[]) => void
) {
  globalAskCallback = cb;
}

async function askUserInput(args: Record<string, unknown>, freeTextOnly = false): Promise<string> {
  const question = String(args.question || 'Awaiting user input...');
  const sessionKey = (args._sessionKey as string) || 'default';

  try {
    const options = freeTextOnly ? undefined : (args.options as string[] | undefined);
    const answer = await AskUserManager.ask(sessionKey, question, options, (q, o) => {
      globalAskCallback(sessionKey, q, o);
    });
    return `User answered: ${answer}`;
  } catch (e: any) {
    return `Failed to ask user: ${e.message}`;
  }
}

export const askUserTool: Tool = {
  name: 'ask_user',
  description:
    'Pause execution and ask the user a question. Use ask_input_user for free-text answers; use this tool when you need explicit multiple-choice options. The tool execution will pause until the user replies.',
  parameters: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description:
          'The question, prompt, or instruction to show the user (e.g. "Please provide the OTP sent to your email").',
      },
      options: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional array of choices to display as interactive buttons. E.g. ["Yes", "No"] or ["English", "Spanish"]',
      },
    },
    required: ['question'],
  },
  async execute(args: Record<string, unknown>): Promise<string> {
    return askUserInput(args);
  },
};

export const askInputUserTool: Tool = {
  name: 'ask_input_user',
  description:
    'Pause execution and ask the user for a free-text answer. Use this when you need the user to type a preference, answer, OTP, credential, clarification, or any open-ended input. The tool execution will pause until the user replies under the gateway message.',
  parameters: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description:
          'The exact question or prompt to show the user. The user will type the answer below the message.',
      },
    },
    required: ['question'],
  },
  async execute(args: Record<string, unknown>): Promise<string> {
    return askUserInput(args, true);
  },
};
