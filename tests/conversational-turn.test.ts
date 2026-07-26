import { describe, expect, test } from 'bun:test';
import { CONVERSATIONAL_TURN } from '../src/agent/AgentLoop.js';

/**
 * A match here means the turn is treated as small talk and the request is sent with NO tools
 * at all. A false positive therefore does not merely waste a few tokens — it leaves the agent
 * unable to act for that turn, so it answers with questions instead of doing the work.
 */
describe('conversational turn detection', () => {
  test('work requests keep their tools, in Indonesian too', () => {
    // The previous classifier matched a list of English verbs and stripped tools from
    // everything else, so every one of these arrived with an empty tool array.
    for (const text of [
      'ayo login langsung aja gass',
      'Gas login:',
      'buka google terus screenshot',
      'bikin script python buat scrape',
      'cari file config di repo',
      'hapus folder temp',
      'tolong daftar akun baru',
      'jalanin test dong',
      'coba deploy ke vercel',
      'push ke github ya',
      'okay so now read the file',
      'thanks, now fix the bug',
    ]) {
      expect(CONVERSATIONAL_TURN.test(text)).toBe(false);
    }
  });

  test('actual small talk is recognised', () => {
    for (const text of [
      'halo',
      'hi there',
      'hey',
      'pagi',
      'makasih bro',
      'terima kasih',
      'thanks',
      'nice',
      'mantap',
      'keren',
      'ok',
      'oke',
      'siap',
      'yes',
      'noted',
      'paham',
      'wkwkwk',
      'hahaha',
      'siapa kamu',
      'what can you do',
    ]) {
      expect(CONVERSATIONAL_TURN.test(text)).toBe(true);
    }
  });

  test('an acknowledgement followed by work is not small talk', () => {
    // The bare-acknowledgement branch is anchored at both ends for exactly this reason.
    expect(CONVERSATIONAL_TURN.test('oke')).toBe(true);
    expect(CONVERSATIONAL_TURN.test('oke lanjut hapus file itu')).toBe(false);
    expect(CONVERSATIONAL_TURN.test('yes')).toBe(true);
    expect(CONVERSATIONAL_TURN.test('yes please run the build')).toBe(false);
  });
});
