import type { Tool } from './Registry.js';

export const osintTool: Tool = {
  name: 'osint_investigate',
  description: 'Perform OSINT investigation on a target (domain, email, username, IP).',
  parameters: {
    type: 'object',
    properties: {
      target: { type: 'string', description: 'Target: domain, email, username, or IP' },
      type: { type: 'string', description: 'domain, email, username, ip, or all' },
    },
    required: ['target'],
  },
  async execute(args) {
    const target = args.target as string;
    const type = (args.type as string) || 'all';
    const results: string[] = [`OSINT Investigation: ${target}\nType: ${type}\n`];

    if (type === 'domain' || type === 'all') {
      if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(target)) {
        try {
          const { execSync } = await import('child_process');
          const whois = execSync(`whois ${target} 2>/dev/null | head -30`, { encoding: 'utf8', timeout: 10000 });
          results.push(`WHOIS:\n${whois}`);
        } catch {
          results.push('WHOIS: not available');
        }
        try {
          const { execSync } = await import('child_process');
          const dns = execSync(`dig ${target} +short 2>/dev/null`, { encoding: 'utf8', timeout: 10000 });
          results.push(`DNS:\n${dns}`);
        } catch {
          results.push('DNS: not available');
        }
      }
    }

    if (type === 'email' || type === 'all') {
      if (target.includes('@')) {
        const [user, domain] = target.split('@');
        results.push(`Email: ${user}@${domain}\nDomain: ${domain}\nFormat valid: yes`);
      }
    }

    if (type === 'ip' || type === 'all') {
      if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(target)) {
        try {
          const res = await fetch(`http://ip-api.com/json/${target}`);
          const data = await res.json() as any;
          results.push(`IP Info:\n  Country: ${data.country}\n  City: ${data.city}\n  ISP: ${data.isp}\n  Org: ${data.org}`);
        } catch {
          results.push('IP lookup: not available');
        }
      }
    }

    return results.join('\n\n') || 'No results found.';
  },
};
