import { resolveModelCapabilities } from './ModelCapabilities.js';
import { Scratchpad } from './Scratchpad.js';
import { EvidenceGate } from './EvidenceGate.js';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const caps = resolveModelCapabilities({ provider: 'openai', apiKey: '', model: 'gpt-4o' } as any);
assert(caps.vision, 'gpt-4o should be vision-capable');
assert(caps.tools, 'gpt-4o should support tools');

const scratch = new Scratchpad('test');
scratch.startTurn('turn_1', 'fix build');
scratch.recordToolResult({
  toolName: 'terminal',
  args: { command: 'npm run build' },
  result: 'ok',
  status: 'success',
  turnId: 'turn_1',
});
assert(
  scratch.renderForPrompt().includes('Passed: npm run build'),
  'scratchpad should record evidence refs'
);

const gate = new EvidenceGate();
const decision = gate.evaluate({
  userMessage: 'fix build',
  assistantText: 'Done, fixed successfully.',
  scratchpad: scratch.getState(),
  evidence: [],
  toolResultsThisTurn: [
    {
      toolName: 'write_file',
      args: { file_path: 'x.ts' },
      result: 'ok',
      status: 'success',
      turnId: 'turn_1',
    },
  ],
});
assert(decision.action === 'block', 'completion claim after mutation should require evidence');

console.log('Brain tests passed');
