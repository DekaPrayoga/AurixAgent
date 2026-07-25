import { describe, expect, test } from 'bun:test';
import {
  resolveCommandAction,
  type SlashCommand,
} from '../src/cli/commands.js';

const modelCommand: SlashCommand = {
  name: 'model',
  aliases: ['models'],
  argumentHint: '[model-id]',
  description: 'Browse provider models or switch directly',
  group: 'model',
  source: 'claude-code',
};

const requiredArgumentCommand: SlashCommand = {
  name: 'depth',
  argumentHint: '<low|high>',
  description: 'Set research depth',
  group: 'model',
  source: 'aurix',
};

const commands = [modelCommand, requiredArgumentCommand];

describe('model command interaction', () => {
  test('exact /model submits immediately instead of completing', () => {
    expect(resolveCommandAction(commands, '/model', 0)).toEqual({
      type: 'submit',
      value: '/model',
    });
  });

  test('exact /models alias submits immediately', () => {
    expect(resolveCommandAction(commands, '/models', 0)).toEqual({
      type: 'submit',
      value: '/models',
    });
  });

  test('partial /mo still completes to the selected command', () => {
    expect(resolveCommandAction(commands, '/mo', 0)).toEqual({
      type: 'complete',
      value: '/model ',
    });
  });

  test('commands with required arguments complete instead of submitting', () => {
    expect(resolveCommandAction(commands, '/depth', 0)).toEqual({
      type: 'complete',
      value: '/depth ',
    });
  });
});
