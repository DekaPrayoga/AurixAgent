import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import type { Tool } from './Registry.js';

const execFileAsync = promisify(execFile);

export const emailTool: Tool = {
  name: 'email',
  description:
    'Compose and send emails via SMTP or CLI tools (himalaya, msmtp, sendmail, mutt). Supports HTML body, attachments, CC/BCC.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'Action: send, draft, list, read, search',
      },
      to: {
        type: 'string',
        description: 'Recipient email address',
      },
      subject: {
        type: 'string',
        description: 'Email subject',
      },
      body: {
        type: 'string',
        description: 'Email body (plain text or HTML)',
      },
      cc: {
        type: 'string',
        description: 'CC recipients (comma-separated)',
      },
      bcc: {
        type: 'string',
        description: 'BCC recipients (comma-separated)',
      },
      attachment: {
        type: 'string',
        description: 'File path to attach',
      },
      id: {
        type: 'string',
        description: 'Message id for read action',
      },
      query: {
        type: 'string',
        description: 'Search query for search action',
      },
    },
    required: ['action'],
  },
  async execute(args) {
    const action = args.action as string;

    switch (action) {
      case 'send':
        return sendEmail(args);
      case 'draft':
        return draftEmail(args);
      case 'list':
        return listEmails();
      case 'read':
        return readEmail(args);
      case 'search':
        return searchEmails(args);
      default:
        return `Unknown action: ${action}. Use: send, draft, list, read, search`;
    }
  },
};

async function sendEmail(args: Record<string, unknown>): Promise<string> {
  const to = asString(args.to);
  const subject = asString(args.subject);
  const body = asString(args.body);
  const cc = asString(args.cc);
  const bcc = asString(args.bcc);
  const attachment = asString(args.attachment);

  if (!to || !subject || !body) {
    return 'Error: to, subject, and body are required for sending email';
  }
  const badHeader = [to, subject, cc, bcc].find((value) => /[\r\n]/.test(value));
  if (badHeader) return 'Error: email headers must not contain newlines.';

  const himalaya = await tryHimalaya(to, subject, body, cc, bcc, attachment);
  if (himalaya) return himalaya;

  const msmtp = await tryMsmtp(to, subject, body, cc, bcc);
  if (msmtp) return msmtp;

  return composeMailto(to, subject, body, cc, bcc);
}

async function tryHimalaya(
  to: string,
  subject: string,
  body: string,
  cc?: string,
  bcc?: string,
  attachment?: string
): Promise<string | null> {
  if (!(await commandExists('himalaya'))) return null;

  const argv = ['write', '--to', to, '--subject', subject];
  if (cc) argv.push('--cc', cc);
  if (bcc) argv.push('--bcc', bcc);
  if (attachment) argv.push('--attachment', attachment);
  argv.push('--send');

  try {
    await runWithStdin('himalaya', argv, body, 30000);
    return `Email sent to ${to}: ${subject}`;
  } catch (e: any) {
    return `Himalaya error: ${e.message}`;
  }
}

async function tryMsmtp(
  to: string,
  subject: string,
  body: string,
  cc?: string,
  bcc?: string
): Promise<string | null> {
  if (!(await commandExists('msmtp'))) return null;

  const headers = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `From: ${process.env.AURIX_EMAIL || 'aurix@agent'}`,
    cc ? `Cc: ${cc}` : '',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    body,
  ]
    .filter(Boolean)
    .join('\n');
  const recipients = splitRecipients(to).concat(splitRecipients(cc), splitRecipients(bcc));

  try {
    await runWithStdin('msmtp', recipients, headers, 30000);
    return `Email sent to ${to}: ${subject}`;
  } catch (e: any) {
    return `msmtp error: ${e.message}`;
  }
}

function composeMailto(
  to: string,
  subject: string,
  body: string,
  cc?: string,
  bcc?: string
): string {
  let mailto = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  if (cc) mailto += `&cc=${encodeURIComponent(cc)}`;
  if (bcc) mailto += `&bcc=${encodeURIComponent(bcc)}`;

  return `No email CLI found. Install himalaya or msmtp.\n\nMailto link: ${mailto}\n\nTo install:\n  cargo install himalaya\n  or: apt install msmtp`;
}

async function draftEmail(args: Record<string, unknown>): Promise<string> {
  const to = args.to || 'recipient@example.com';
  const subject = args.subject || 'Draft';
  const body = args.body || '';

  const bodyStr = (body as string) || '';
  return `Draft prepared:\n  To: ${to}\n  Subject: ${subject}\n  Body: ${bodyStr.slice(0, 200)}${bodyStr.length > 200 ? '...' : ''}\n\nSend with: email send --to "${to}" --subject "${subject}"`;
}

async function listEmails(): Promise<string> {
  if (!(await commandExists('himalaya')))
    return 'himalaya not installed. Install with: cargo install himalaya';
  try {
    const { stdout } = await execFileAsync('himalaya', ['list', '--page-size', '10'], {
      encoding: 'utf8',
      timeout: 15000,
      maxBuffer: 1024 * 1024,
    });
    return String(stdout).trim() || 'No emails found';
  } catch {
    return 'himalaya not installed or email list unavailable';
  }
}

async function readEmail(args: Record<string, unknown>): Promise<string> {
  if (!(await commandExists('himalaya')))
    return 'himalaya not installed. Install with: cargo install himalaya';
  const id = asString(args.id) || '1';
  if (!/^[A-Za-z0-9_.:@-]+$/.test(id)) return `Error: unsafe email id: ${id}`;
  try {
    const { stdout } = await execFileAsync('himalaya', ['read', id], {
      encoding: 'utf8',
      timeout: 15000,
      maxBuffer: 1024 * 1024,
    });
    return String(stdout).trim();
  } catch {
    return 'himalaya email not found or read failed';
  }
}

async function searchEmails(args: Record<string, unknown>): Promise<string> {
  if (!(await commandExists('himalaya'))) return 'himalaya not installed';
  const query = asString(args.query);
  try {
    const { stdout } = await execFileAsync('himalaya', ['list', '--query', query], {
      encoding: 'utf8',
      timeout: 15000,
      maxBuffer: 1024 * 1024,
    });
    return String(stdout).trim() || 'No results';
  } catch {
    return 'himalaya search failed';
  }
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function splitRecipients(value?: string): string[] {
  return (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

async function commandExists(command: string): Promise<boolean> {
  try {
    await execFileAsync(command, ['--version'], { timeout: 5000, encoding: 'utf8' });
    return true;
  } catch {
    return false;
  }
}

function runWithStdin(
  command: string,
  args: string[],
  input: string,
  timeout: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`timeout after ${timeout}ms`));
    }, timeout);

    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `${command} exited with ${code}`));
    });
    child.stdin?.end(input);
  });
}
