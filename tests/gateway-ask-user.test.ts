import { EventEmitter } from 'events';
import { afterEach, describe, expect, test } from 'bun:test';
import { Gateway } from '../src/gateway/Gateway.js';
import { ToolRegistry } from '../src/tools/Registry.js';
import { AskUserManager, askUserTool, askInputUserTool } from '../src/tools/AskUser.js';
import type { AurixConfig } from '../src/agent/Config.js';

interface Sent {
  text: string;
  opts?: any;
}

class FakePlatform extends EventEmitter {
  sent: Sent[] = [];
  constructor(public name: string) {
    super();
  }
  async connect() {}
  async disconnect() {}
  async send(text: string, _channelId: string, _replyTo?: string, options?: any) {
    this.sent.push({ text, opts: options });
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Resolves to a marker instead of hanging forever, so a regression fails loudly. */
const settle = (p: Promise<string>) => Promise.race([p, wait(1200).then(() => 'HUNG')]);

async function harness(platformName: string) {
  const platform = new FakePlatform(platformName);
  const registry = new ToolRegistry();
  registry.register(askUserTool);
  registry.register(askInputUserTool);
  const config = {
    provider: 'custom',
    apiKey: 'k',
    baseUrl: 'http://127.0.0.1:1/v1',
    model: 'm',
    allowedUsers: [],
  } as unknown as AurixConfig;
  const gateway = new Gateway(config, registry);
  gateway.register(platform as never);

  const send = (content: string, isCallback = false) =>
    platform.emit('message', {
      platform: platformName,
      authorId: '4242',
      authorName: 'operator',
      channelId: 'chan',
      content,
      replyTo: '1',
      chatType: 'dm',
      isCallback,
    });

  send('halo');
  await wait(400);
  const agentKey = (gateway as unknown as { agents: Map<string, unknown> }).agents.keys().next()
    .value as string;
  platform.sent = [];
  return { platform, send, agentKey };
}

afterEach(() => {
  AskUserManager.cancel('default');
});

describe('gateway ask_user', () => {
  test('telegram renders one button per option plus a free-text escape', async () => {
    const { platform, agentKey } = await harness('telegram');
    const answer = askUserTool.execute({
      question: 'Pick a deploy strategy',
      options: ['blue-green', 'rolling', 'canary'],
      _sessionKey: agentKey,
    });
    await wait(300);

    const keyboard = platform.sent.find((s) => s.opts?.reply_markup)?.opts.reply_markup
      .inline_keyboard;
    expect(keyboard).toBeDefined();
    expect(keyboard.flat().map((b: any) => b.callback_data)).toEqual([
      '__aurix_opt_0__',
      '__aurix_opt_1__',
      '__aurix_opt_2__',
      '__aurix_type_answer__',
    ]);

    AskUserManager.cancel(agentKey);
    await answer;
  });

  test('tapping a button resolves to the option value, not the token', async () => {
    const { send, agentKey } = await harness('telegram');
    const answer = askUserTool.execute({
      question: 'Pick one',
      options: ['blue-green', 'rolling', 'canary'],
      _sessionKey: agentKey,
    });
    await wait(250);
    send('__aurix_opt_2__', true);
    expect(await settle(answer)).toBe('User answered: canary');
  });

  test('"Type Your Answer" keeps the question open for the next message', async () => {
    const { send, agentKey } = await harness('telegram');
    const answer = askUserTool.execute({
      question: 'Pick one',
      options: ['a', 'b'],
      _sessionKey: agentKey,
    });
    await wait(250);
    send('__aurix_type_answer__', true);
    await wait(250);
    expect(AskUserManager.isWaiting(agentKey)).toBe(true);
    send('something else entirely');
    expect(await settle(answer)).toBe('User answered: something else entirely');
  });

  test('ask_input_user takes free text with no buttons', async () => {
    const { platform, send, agentKey } = await harness('telegram');
    const answer = askInputUserTool.execute({ question: 'Enter the OTP', _sessionKey: agentKey });
    await wait(250);
    expect(platform.sent.some((s) => s.opts?.reply_markup)).toBe(false);
    send('123456');
    expect(await settle(answer)).toBe('User answered: 123456');
  });

  test('/cancel escapes the question instead of becoming its answer', async () => {
    // Without an escape hatch every command typed while a question is open is submitted
    // as the answer, so a stuck ask can only be left by answering it.
    const { send, agentKey } = await harness('telegram');
    const answer = askUserTool.execute({
      question: 'Proceed?',
      options: ['ya', 'tidak'],
      _sessionKey: agentKey,
    });
    await wait(250);
    send('/cancel');
    expect(await settle(answer)).toBe('Failed to ask user: Cancelled by user');
    expect(AskUserManager.isWaiting(agentKey)).toBe(false);
  });

  test('a platform without buttons can answer by number', async () => {
    // Discord gets a numbered list, which invites "3" — that has to map to the option.
    const { platform, send, agentKey } = await harness('discord');
    const answer = askUserTool.execute({
      question: 'Pick a deploy strategy',
      options: ['blue-green', 'rolling', 'canary'],
      _sessionKey: agentKey,
    });
    await wait(300);
    expect(platform.sent.some((s) => s.text.includes('3. canary'))).toBe(true);
    send('3');
    expect(await settle(answer)).toBe('User answered: canary');
  });

  test('option text answers are case-insensitive', async () => {
    const { send, agentKey } = await harness('discord');
    const answer = askUserTool.execute({
      question: 'Pick one',
      options: ['blue-green', 'Canary'],
      _sessionKey: agentKey,
    });
    await wait(300);
    send('canary');
    expect(await settle(answer)).toBe('User answered: Canary');
  });
});
