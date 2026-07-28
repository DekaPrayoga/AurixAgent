export const CAPSOLVER_TASK_TYPES = [
  'AwsWafClassification',
  'ImageToTextTask',
  'ReCaptchaV2Classification',
  'VisionEngine',
  'ReCaptchaV3TaskProxyLess',
  'ReCaptchaV3Task',
  'ReCaptchaV3EnterpriseTaskProxyLess',
  'ReCaptchaV3EnterpriseTask',
  'ReCaptchaV2TaskProxyLess',
  'ReCaptchaV2EnterpriseTaskProxyLess',
  'ReCaptchaV2EnterpriseTask',
  'MtCaptchaTask',
  'AntiAwsWafTaskProxyLess',
  'AntiAwsWafTask',
  'MtCaptchaTaskProxyLess',
  'AntiCloudflareTask',
  'AntiTurnstileTaskProxyLess',
  'GeeTestTaskProxyLess',
] as const;

export type CapSolverTaskType = (typeof CAPSOLVER_TASK_TYPES)[number];
export type CapSolverTask = Record<string, unknown> & { type: CapSolverTaskType };

const TASK_SET = new Set<string>(CAPSOLVER_TASK_TYPES);
const PROXY_REQUIRED = new Set<CapSolverTaskType>([
  'ReCaptchaV3Task',
  'ReCaptchaV3EnterpriseTask',
  'ReCaptchaV2EnterpriseTask',
  'MtCaptchaTask',
  'AntiAwsWafTask',
  'AntiCloudflareTask',
]);
const WEBSITE_TASKS = new Set<CapSolverTaskType>([
  'ReCaptchaV3TaskProxyLess',
  'ReCaptchaV3Task',
  'ReCaptchaV3EnterpriseTaskProxyLess',
  'ReCaptchaV3EnterpriseTask',
  'ReCaptchaV2TaskProxyLess',
  'ReCaptchaV2EnterpriseTaskProxyLess',
  'ReCaptchaV2EnterpriseTask',
  'MtCaptchaTask',
  'AntiAwsWafTaskProxyLess',
  'AntiAwsWafTask',
  'MtCaptchaTaskProxyLess',
  'AntiCloudflareTask',
  'AntiTurnstileTaskProxyLess',
  'GeeTestTaskProxyLess',
]);
const WEBSITE_KEY_TASKS = new Set<CapSolverTaskType>([
  'ReCaptchaV3TaskProxyLess',
  'ReCaptchaV3Task',
  'ReCaptchaV3EnterpriseTaskProxyLess',
  'ReCaptchaV3EnterpriseTask',
  'ReCaptchaV2TaskProxyLess',
  'ReCaptchaV2EnterpriseTaskProxyLess',
  'ReCaptchaV2EnterpriseTask',
  'MtCaptchaTask',
  'MtCaptchaTaskProxyLess',
  'AntiTurnstileTaskProxyLess',
]);
const IMAGE_TASKS = new Set<CapSolverTaskType>([
  'AwsWafClassification',
  'ImageToTextTask',
  'ReCaptchaV2Classification',
  'VisionEngine',
]);

export function isCapSolverTaskType(value: unknown): value is CapSolverTaskType {
  return typeof value === 'string' && TASK_SET.has(value);
}

export function validateCapSolverTask(input: Record<string, unknown>): CapSolverTask {
  if (!isCapSolverTaskType(input.type)) throw new Error('Unsupported CapSolver task type');
  const task = { ...input, type: input.type } as CapSolverTask;
  if (WEBSITE_TASKS.has(task.type)) {
    if (typeof task.websiteURL !== 'string') throw new Error(`${task.type} requires websiteURL`);
    try {
      const url = new URL(task.websiteURL);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error();
    } catch {
      throw new Error('websiteURL must be a valid HTTP(S) URL');
    }
  }
  if (WEBSITE_KEY_TASKS.has(task.type) && !String(task.websiteKey || '').trim()) {
    throw new Error(`${task.type} requires websiteKey`);
  }
  if (IMAGE_TASKS.has(task.type) && !String(task.body || task.images || '').trim()) {
    throw new Error(`${task.type} requires body or images`);
  }
  if (PROXY_REQUIRED.has(task.type) && !String(task.proxy || '').trim()) {
    throw new Error(`${task.type} requires proxy`);
  }
  if (task.type.endsWith('ProxyLess') && task.proxy) {
    throw new Error(`${task.type} does not accept proxy`);
  }
  if (task.type === 'GeeTestTaskProxyLess') {
    const isV4 = Boolean(String(task.captchaId || '').trim());
    const isV3 = Boolean(String(task.gt || '').trim() && String(task.challenge || '').trim());
    if (!isV3 && !isV4) {
      throw new Error('GeeTestTaskProxyLess requires captchaId (v4) or gt and challenge (v3)');
    }
  }
  if (task.type === 'AntiAwsWafTask' || task.type === 'AntiAwsWafTaskProxyLess') {
    for (const field of ['awsKey', 'awsIv', 'awsContext']) {
      if (!String(task[field] || '').trim()) throw new Error(`${task.type} requires ${field}`);
    }
  }
  return task;
}

export function redactCapSolverValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactCapSolverValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
      key,
      /key|cookie|proxy|token/i.test(key) ? '[REDACTED]' : redactCapSolverValue(nested),
    ])
  );
}
