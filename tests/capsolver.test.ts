import { afterEach, describe, expect, test } from 'bun:test';
import { CapSolverClient, capSolverConfigured } from '../src/tools/captcha/CapSolverClient.js';
import { CAPSOLVER_TASK_TYPES, validateCapSolverTask } from '../src/tools/captcha/CapSolverTypes.js';

const validTasks: Record<string, Record<string, unknown>> = {
  AwsWafClassification: { body: 'base64' },
  ImageToTextTask: { body: 'base64' },
  ReCaptchaV2Classification: { body: 'base64' },
  VisionEngine: { body: 'base64' },
  ReCaptchaV3TaskProxyLess: { websiteURL: 'https://example.com', websiteKey: 'key', pageAction: 'login' },
  ReCaptchaV3Task: { websiteURL: 'https://example.com', websiteKey: 'key', pageAction: 'login', proxy: 'http:host:80:user:pass' },
  ReCaptchaV3EnterpriseTaskProxyLess: { websiteURL: 'https://example.com', websiteKey: 'key', pageAction: 'login' },
  ReCaptchaV3EnterpriseTask: { websiteURL: 'https://example.com', websiteKey: 'key', pageAction: 'login', proxy: 'http:host:80:user:pass' },
  ReCaptchaV2TaskProxyLess: { websiteURL: 'https://example.com', websiteKey: 'key' },
  ReCaptchaV2EnterpriseTaskProxyLess: { websiteURL: 'https://example.com', websiteKey: 'key' },
  ReCaptchaV2EnterpriseTask: { websiteURL: 'https://example.com', websiteKey: 'key', proxy: 'http:host:80:user:pass' },
  MtCaptchaTask: { websiteURL: 'https://example.com', websiteKey: 'key', proxy: 'http:host:80:user:pass' },
  AntiAwsWafTaskProxyLess: { websiteURL: 'https://example.com', awsKey: 'key', awsIv: 'iv', awsContext: 'ctx' },
  AntiAwsWafTask: { websiteURL: 'https://example.com', awsKey: 'key', awsIv: 'iv', awsContext: 'ctx', proxy: 'http:host:80:user:pass' },
  MtCaptchaTaskProxyLess: { websiteURL: 'https://example.com', websiteKey: 'key' },
  AntiCloudflareTask: { websiteURL: 'https://example.com', proxy: 'http:host:80:user:pass' },
  AntiTurnstileTaskProxyLess: { websiteURL: 'https://example.com', websiteKey: 'turnstile-key' },
  GeeTestTaskProxyLess: { websiteURL: 'https://example.com', gt: 'gt', challenge: 'challenge' },
};

const originalEnabled = process.env.AURIX_CAPSOLVER_ENABLED;
const originalKey = process.env.AURIX_CAPSOLVER_API_KEY;
afterEach(() => {
  if (originalEnabled === undefined) delete process.env.AURIX_CAPSOLVER_ENABLED;
  else process.env.AURIX_CAPSOLVER_ENABLED = originalEnabled;
  if (originalKey === undefined) delete process.env.AURIX_CAPSOLVER_API_KEY;
  else process.env.AURIX_CAPSOLVER_API_KEY = originalKey;
});

describe('CapSolver task validation', () => {
  test('supports every requested task type', () => {
    for (const type of CAPSOLVER_TASK_TYPES) {
      expect(validateCapSolverTask({ type, ...validTasks[type] }).type).toBe(type);
    }
  });

  test('requires explicit enablement even when a key exists', () => {
    expect(capSolverConfigured({ provider: 'openai', apiKey: '', model: 'x', capSolverApiKey: 'CAP-key', IsSolverApiEnabled: false })).toBe(false);
    expect(capSolverConfigured({ provider: 'openai', apiKey: '', model: 'x', capSolverApiKey: 'CAP-key', IsSolverApiEnabled: true })).toBe(true);
  });

  test('rejects missing proxy and proxy on proxyless tasks', () => {
    expect(() => validateCapSolverTask({ type: 'ReCaptchaV3Task', websiteURL: 'https://example.com', websiteKey: 'k' })).toThrow('requires proxy');
    expect(() => validateCapSolverTask({ type: 'ReCaptchaV3TaskProxyLess', websiteURL: 'https://example.com', websiteKey: 'k', proxy: 'x' })).toThrow('does not accept proxy');
  });

  test('validates proxyless Turnstile tasks', () => {
    expect(validateCapSolverTask({ type: 'AntiTurnstileTaskProxyLess', websiteURL: 'https://example.com', websiteKey: 'site-key' }).type).toBe('AntiTurnstileTaskProxyLess');
    expect(() => validateCapSolverTask({ type: 'AntiTurnstileTaskProxyLess', websiteURL: 'https://example.com' })).toThrow('requires websiteKey');
    expect(() => validateCapSolverTask({ type: 'AntiTurnstileTaskProxyLess', websiteURL: 'https://example.com', websiteKey: 'site-key', proxy: 'x' })).toThrow('does not accept proxy');
  });

  test('supports GeeTest v4 and requires AWS challenge fields', () => {
    expect(validateCapSolverTask({ type: 'GeeTestTaskProxyLess', websiteURL: 'https://example.com', captchaId: 'id' }).type).toBe('GeeTestTaskProxyLess');
    expect(() => validateCapSolverTask({ type: 'AntiAwsWafTaskProxyLess', websiteURL: 'https://example.com' })).toThrow('requires awsKey');
  });
});

describe('CapSolver client', () => {
  test('checks positive balance before creating and polling a task', async () => {
    const paths: string[] = [];
    const fetcher = (async (url: string | URL | Request) => {
      const path = new URL(String(url)).pathname;
      paths.push(path);
      if (path === '/getBalance') return new Response(JSON.stringify({ errorId: 0, balance: 1.25 }));
      if (path === '/createTask') return new Response(JSON.stringify({ errorId: 0, taskId: 'task-1' }));
      return new Response(JSON.stringify({ errorId: 0, status: 'ready', solution: { gRecaptchaResponse: 'token' } }));
    }) as typeof fetch;
    const result = await new CapSolverClient('CAP-key', fetcher).solveTask(
      { type: 'ReCaptchaV2TaskProxyLess', websiteURL: 'https://example.com', websiteKey: 'k' },
      { pollIntervalMs: 1 },
    );
    expect(result.ok).toBe(true);
    expect(paths).toEqual(['/getBalance', '/createTask', '/getTaskResult']);
  });

  test('zero balance prevents paid task creation', async () => {
    const paths: string[] = [];
    const fetcher = (async (url: string | URL | Request) => {
      paths.push(new URL(String(url)).pathname);
      return new Response(JSON.stringify({ errorId: 0, balance: 0 }));
    }) as typeof fetch;
    const result = await new CapSolverClient('CAP-key', fetcher).solveTask({ type: 'ImageToTextTask', body: 'base64' });
    expect(result.ok).toBe(false);
    expect(paths).toEqual(['/getBalance']);
  });

  test('respects a short polling timeout without a full interval overshoot', async () => {
    const fetcher = (async (url: string | URL | Request) => {
      const path = new URL(String(url)).pathname;
      if (path === '/getBalance') return new Response(JSON.stringify({ errorId: 0, balance: 1 }));
      return new Response(JSON.stringify({ errorId: 0, taskId: 'task-1', status: 'processing' }));
    }) as typeof fetch;
    const startedAt = Date.now();
    const result = await new CapSolverClient('CAP-key', fetcher).solveTask(
      { type: 'ImageToTextTask', body: 'base64' },
      { timeoutMs: 20, pollIntervalMs: 60_000 },
    );
    expect(result.ok).toBe(false);
    expect(Date.now() - startedAt).toBeLessThan(500);
  });

  test('rejects ready polling responses without a solution', async () => {
    const fetcher = (async (url: string | URL | Request) => {
      const path = new URL(String(url)).pathname;
      if (path === '/getBalance') return new Response(JSON.stringify({ errorId: 0, balance: 1 }));
      if (path === '/createTask') return new Response(JSON.stringify({ errorId: 0, taskId: 'task-1' }));
      return new Response(JSON.stringify({ errorId: 0, status: 'ready' }));
    }) as typeof fetch;
    const result = await new CapSolverClient('CAP-key', fetcher).solveTask(
      { type: 'ImageToTextTask', body: 'base64' },
      { pollIntervalMs: 1 },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('without a solution');
  });

  test('does not expose API key in a malformed response error', async () => {
    const fetcher = (async () => new Response('not-json')) as typeof fetch;
    const result = await new CapSolverClient('CAP-secret', fetcher).getBalance();
    expect(result.error).not.toContain('CAP-secret');
  });
});
