import crypto from 'node:crypto';
import type { Tool } from './Registry.js';

const MAIL_TM_BASE_URL = 'https://api.mail.tm';
const DEFAULT_PASSWORD_PREFIX = 'aurix-temp';

type TempMailAction = 'create' | 'token' | 'inbox' | 'read';

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`${MAIL_TM_BASE_URL}${path}`, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...(init?.headers || {}),
    },
  });
  const body = await resp.text();
  if (!resp.ok) {
    const detail = body ? `\n${body.slice(0, 1000)}` : '';
    throw new Error(`mail.tm HTTP ${resp.status} ${resp.statusText}${detail}`);
  }
  return body ? (JSON.parse(body) as T) : ({} as T);
}

function authHeaders(token: string): HeadersInit {
  if (!token) throw new Error('token is required for this action.');
  return { authorization: `Bearer ${token}` };
}

function stripHtml(html: unknown): string {
  const raw = Array.isArray(html) ? html.join('\n') : typeof html === 'string' ? html : '';
  return raw
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractCode(text: string, regex?: string): string | undefined {
  if (regex) {
    const match = text.match(new RegExp(regex, 'i'));
    return match ? match[1] || match[0] : undefined;
  }
  const match = text.match(/\b\d{4,8}\b/);
  return match?.[0];
}

export const tempMailingTool: Tool = {
  name: 'temp_mailing',
  displayName: 'Temp-Mailing',
  description:
    'Create disposable mail.tm inboxes and read messages for authorized signup/testing workflows. Actions: create, token, inbox, read.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['create', 'token', 'inbox', 'read'],
        description:
          'create: new inbox, token: auth token from address/password, inbox: list messages, read: read one message.',
      },
      address_prefix: {
        type: 'string',
        description: 'Optional address prefix for create. Random suffix is added automatically.',
      },
      address: { type: 'string', description: 'Email address for token action.' },
      password: {
        type: 'string',
        description: 'Password returned by create or chosen for token action.',
      },
      token: {
        type: 'string',
        description: 'Bearer token returned by create/token, used for inbox/read.',
      },
      message_id: {
        type: 'string',
        description: 'Message id returned by inbox, required for read.',
      },
      limit: { type: 'number', description: 'Maximum messages to show for inbox. Default 10.' },
      extract_regex: {
        type: 'string',
        description: 'Optional regex for read to extract OTP/link/code.',
      },
    },
    required: ['action'],
  },
  async execute(args: Record<string, unknown>): Promise<string> {
    const action = asString(args.action) as TempMailAction;

    try {
      if (action === 'create') {
        const domains = await fetchJson<{ 'hydra:member'?: { domain?: string }[] }>('/domains');
        const domain = domains['hydra:member']?.find((d) => d.domain)?.domain;
        if (!domain) return '[ERROR] Temp-Mailing: no mail.tm domains available.';

        const prefix =
          (asString(args.address_prefix) || 'aurix').replace(/[^a-z0-9._-]/gi, '').slice(0, 24) ||
          'aurix';
        const suffix = crypto.randomBytes(5).toString('hex');
        const address = `${prefix}_${suffix}@${domain}`.toLowerCase();
        const password =
          asString(args.password) ||
          `${DEFAULT_PASSWORD_PREFIX}-${crypto.randomBytes(12).toString('hex')}`;

        await fetchJson('/accounts', {
          method: 'POST',
          body: JSON.stringify({ address, password }),
        });
        const tokenData = await fetchJson<{ token?: string; id?: string }>('/token', {
          method: 'POST',
          body: JSON.stringify({ address, password }),
        });
        if (!tokenData.token) return '[ERROR] Temp-Mailing: account created but token was missing.';

        return [
          '[OK] Temp-Mailing inbox created',
          `address: ${address}`,
          `password: ${password}`,
          `token: ${tokenData.token}`,
          '',
          'Use temp_mailing action="inbox" with token, then action="read" with message_id.',
        ].join('\n');
      }

      if (action === 'token') {
        const address = asString(args.address);
        const password = asString(args.password);
        if (!address || !password)
          return '[ERROR] Temp-Mailing token requires address and password.';
        const data = await fetchJson<{ token?: string }>('/token', {
          method: 'POST',
          body: JSON.stringify({ address, password }),
        });
        return data.token
          ? `[OK] Temp-Mailing token\ntoken: ${data.token}`
          : '[ERROR] Temp-Mailing token missing in response.';
      }

      if (action === 'inbox') {
        const token = asString(args.token);
        const limit = Math.max(1, Math.min(50, Number(args.limit || 10)));
        const data = await fetchJson<{ 'hydra:member'?: any[] }>('/messages', {
          headers: authHeaders(token),
        });
        const messages = data['hydra:member'] || [];
        if (messages.length === 0) return '[OK] Temp-Mailing inbox empty.';
        const lines = messages.slice(0, limit).map((msg, i) => {
          const from = msg.from?.address || msg.from?.name || 'unknown';
          return `${i + 1}. id=${msg.id} from=${from} subject=${msg.subject || '(no subject)'}`;
        });
        return `[OK] Temp-Mailing inbox (${messages.length} message(s))\n${lines.join('\n')}`;
      }

      if (action === 'read') {
        const token = asString(args.token);
        const messageId = asString(args.message_id || args.id);
        if (!messageId) return '[ERROR] Temp-Mailing read requires message_id.';
        const msg = await fetchJson<any>(`/messages/${encodeURIComponent(messageId)}`, {
          headers: authHeaders(token),
        });
        const bodyText = asString(msg.text) || stripHtml(msg.html);
        const preview =
          bodyText.length > 4000 ? `${bodyText.slice(0, 4000)}\n... [truncated]` : bodyText;
        const extracted = extractCode(bodyText, asString(args.extract_regex));
        return [
          '[OK] Temp-Mailing message',
          `id: ${msg.id || messageId}`,
          `from: ${msg.from?.address || msg.from?.name || 'unknown'}`,
          `subject: ${msg.subject || '(no subject)'}`,
          extracted ? `extracted: ${extracted}` : undefined,
          '',
          preview || '(empty message)',
        ]
          .filter(Boolean)
          .join('\n');
      }

      return '[ERROR] Temp-Mailing action must be one of: create, token, inbox, read.';
    } catch (e: any) {
      return `[ERROR] Temp-Mailing failed: ${e.message}`;
    }
  },
};
