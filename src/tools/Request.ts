import type { Tool } from './Registry.js';

export const httpRequestTool: Tool = {
  name: 'http_request',
  description:
    'Make an HTTP request and return status, headers, and body. Use this to inspect APIs, test endpoints, debug auth flows, or send webhooks. Supports GET, POST, PUT, PATCH, DELETE.',

  parameters: {
    type: 'object',
    properties: {
      method: {
        type: 'string',
        description: 'HTTP method. Default GET.',
      },
      url: {
        type: 'string',
        description: 'Target URL.',
      },
      headers: {
        type: 'object',
        description: 'Optional request headers as key-value pairs.',
      },
      body: {
        type: 'string',
        description: 'Optional request body for POST/PUT/PATCH.',
      },
      timeoutMs: {
        type: 'number',
        description: 'Request timeout in milliseconds. Default 15000, max 60000.',
      },
    },
    required: ['url'],
  },

  async execute(args) {
    const method = String(args.method || 'GET').trim().toUpperCase();
    const url = String(args.url || '').trim();
    const headers = (args.headers && typeof args.headers === 'object') ? args.headers as Record<string, string> : {};
    const body = typeof args.body === 'string' ? args.body : undefined;
    const timeoutMs = Math.min(60000, Math.max(1000, Number(args.timeoutMs) || 15000));

    if (!url) return 'Error: url wajib diisi.';
    if (!/^https?:\/\//i.test(url)) return `Error: url tidak valid: ${url}`;
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(method)) {
      return `Error: method tidak didukung: ${method}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const start = Date.now();
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          'user-agent': 'AurixAgent/3.0 http_request',
          'accept': 'application/json, text/plain, */*',
          ...headers,
        },
        body: body || undefined,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      const msg = String(err);
      if (msg.includes('aborted')) {
        return `Error: request timeout setelah ${timeoutMs}ms`;
      }
      return `Error: request gagal — ${msg}`;
    } finally {
      clearTimeout(timer);
    }

    const ms = Date.now() - start;
    let responseBody = '';
    let contentType = String(res.headers.get('content-type') || '');
    const isJson = contentType.includes('application/json');

    try {
      responseBody = await res.text();
      if (isJson) {
        try {
          const parsed = JSON.parse(responseBody);
          responseBody = JSON.stringify(parsed, null, 2);
        } catch {
          // keep raw text
        }
      }
    } catch {
      responseBody = '(tidak dapat membaca body)';
    }

    const headerEntries: string[] = [];
    for (const [k, v] of res.headers as any) {
      headerEntries.push(`${k}: ${v}`);
    }
    const truncatedBody = responseBody.length > 12000 ? `${responseBody.slice(0, 12000)}\n... [truncated ${responseBody.length - 12000} chars]` : responseBody;

    const summary = [
      `${method} ${url}`,
      `Status: ${res.status} ${res.statusText}`,
      `Time: ${ms}ms`,
      `Size: ${responseBody.length} chars`,
      '',
      'Headers:',
      ...headerEntries,
      '',
      'Body:',
      truncatedBody,
    ];

    return summary.join('\n');
  },
};
