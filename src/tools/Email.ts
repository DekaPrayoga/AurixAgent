import { exec } from 'child_process';
import type { Tool } from './Registry.js';

export const emailTool: Tool = {
  name: 'email',
  description: 'Compose and send emails via SMTP or CLI tools (himalaya, msmtp, sendmail, mutt). Supports HTML body, attachments, CC/BCC.',
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
  const to = args.to as string;
  const subject = args.subject as string;
  const body = args.body as string;
  const cc = args.cc as string;
  const bcc = args.bcc as string;
  const attachment = args.attachment as string;

  if (!to || !subject || !body) {
    return 'Error: to, subject, and body are required for sending email';
  }

  const himalaya = await tryHimalaya(to, subject, body, cc, bcc, attachment);
  if (himalaya) return himalaya;

  const msmtp = await tryMsmtp(to, subject, body, cc, bcc);
  if (msmtp) return msmtp;

  return composeMailto(to, subject, body, cc, bcc);
}

async function tryHimalaya(to: string, subject: string, body: string, cc?: string, bcc?: string, attachment?: string): Promise<string | null> {
  return new Promise(resolve => {
    exec('which himalaya 2>/dev/null', (err) => {
      if (err) { resolve(null); return; }

      let cmd = `echo "${body.replace(/"/g, '\\"')}" | himalaya write --to "${to}" --subject "${subject.replace(/"/g, '\\"')}"`;
      if (cc) cmd += ` --cc "${cc}"`;
      if (bcc) cmd += ` --bcc "${bcc}"`;
      if (attachment) cmd += ` --attachment "${attachment}"`;
      cmd += ' --send';

      exec(cmd, { timeout: 30000 }, (err2, stdout, stderr) => {
        if (err2) resolve(`Himalaya error: ${stderr || err2.message}`);
        else resolve(`Email sent to ${to}: ${subject}`);
      });
    });
  });
}

async function tryMsmtp(to: string, subject: string, body: string, cc?: string, bcc?: string): Promise<string | null> {
  return new Promise(resolve => {
    exec('which msmtp 2>/dev/null', (err) => {
      if (err) { resolve(null); return; }

      const headers = [
        `To: ${to}`,
        `Subject: ${subject}`,
        `From: ${process.env.AURIX_EMAIL || 'aurix@agent'}`,
        cc ? `Cc: ${cc}` : '',
        bcc ? `Bcc: ${bcc}` : '',
        'Content-Type: text/plain; charset=UTF-8',
        '',
        body,
      ].filter(Boolean).join('\n');

      exec(`echo "${headers.replace(/"/g, '\\"')}" | msmtp "${to}"`, { timeout: 30000 }, (err2, stdout, stderr) => {
        if (err2) resolve(`msmtp error: ${stderr || err2.message}`);
        else resolve(`Email sent to ${to}: ${subject}`);
      });
    });
  });
}

function composeMailto(to: string, subject: string, body: string, cc?: string, bcc?: string): string {
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
  return new Promise(resolve => {
    exec('himalaya list --page-size 10 2>/dev/null', { timeout: 15000 }, (err, stdout) => {
      if (err) resolve('himalaya not installed. Install with: cargo install himalaya');
      else resolve(stdout.trim() || 'No emails found');
    });
  });
}

async function readEmail(args: Record<string, unknown>): Promise<string> {
  return new Promise(resolve => {
    const id = args.id || '1';
    exec(`himalaya read ${id} 2>/dev/null`, { timeout: 15000 }, (err, stdout) => {
      if (err) resolve('himalaya not installed or email not found');
      else resolve(stdout.trim());
    });
  });
}

async function searchEmails(args: Record<string, unknown>): Promise<string> {
  const query = args.query as string || '';
  return new Promise(resolve => {
    exec(`himalaya list --query "${query}" 2>/dev/null`, { timeout: 15000 }, (err, stdout) => {
      if (err) resolve('himalaya not installed');
      else resolve(stdout.trim() || 'No results');
    });
  });
}
