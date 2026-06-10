import { exec } from 'child_process';
import type { Tool } from './Registry.js';

export const cybersecTool: Tool = {
  name: 'cybersec',
  description: 'Cybersecurity toolkit: port scanning, vulnerability assessment, network analysis, SSL checking, DNS lookup, WHOIS, firewall audit, log analysis. Red team, blue team, and purple team operations.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'Action: scan, vuln, ssl, dns, whois, firewall, logcheck, banner, recon, pentest_report',
      },
      target: {
        type: 'string',
        description: 'Target host/IP/domain/URL',
      },
      options: {
        type: 'string',
        description: 'Additional options (port range, scan type, etc.)',
      },
      team: {
        type: 'string',
        description: 'Team mode: red (offensive), blue (defensive), purple (both)',
      },
    },
    required: ['action'],
  },
  async execute(args) {
    const action = args.action as string;
    const target = (args.target as string) || '';
    const options = (args.options as string) || '';
    const team = (args.team as string) || 'purple';

    switch (action) {
      case 'scan':
        return portScan(target, options);
      case 'vuln':
        return vulnScan(target, options, team);
      case 'ssl':
        return sslCheck(target);
      case 'dns':
        return dnsLookup(target);
      case 'whois':
        return whoisLookup(target);
      case 'firewall':
        return firewallAudit(options);
      case 'logcheck':
        return logAnalysis(options);
      case 'banner':
        return bannerGrab(target, options);
      case 'recon':
        return recon(target, team);
      case 'pentest_report':
        return pentestReport(target);
      default:
        return `Unknown action: ${action}`;
    }
  },
};

function runCmd(cmd: string, timeout = 30000): Promise<string> {
  return new Promise(resolve => {
    exec(cmd, { timeout, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) resolve(stderr?.trim() || `Error: ${err.message}`);
      else resolve(stdout.trim());
    });
  });
}

async function portScan(target: string, options: string): Promise<string> {
  if (!target) return 'Error: provide a target host/IP';

  const nmap = await runCmd('which nmap 2>/dev/null');
  if (!nmap) return 'nmap not installed. Install: apt install nmap';

  const portRange = options || '-p 1-1000';
  return runCmd(`nmap -sV ${portRange} ${target} 2>&1`, 120000);
}

async function vulnScan(target: string, options: string, team: string): Promise<string> {
  if (!target) return 'Error: provide a target';

  if (team === 'red' || team === 'purple') {
    const nmap = await runCmd('which nmap 2>/dev/null');
    if (!nmap) return 'nmap not installed';

    return runCmd(`nmap --script vuln ${options || '-p 80,443,8080'} ${target} 2>&1`, 180000);
  }

  return `Blue team mode: reviewing security configuration of ${target}...\n` +
    await runCmd(`ss -tuln 2>/dev/null || netstat -tuln 2>/dev/null`, 10000);
}

async function sslCheck(target: string): Promise<string> {
  if (!target) return 'Error: provide a domain or URL';
  const host = target.replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
  return runCmd(`echo | openssl s_client -connect ${host}:443 -servername ${host} 2>/dev/null | openssl x509 -noout -dates -subject -issuer 2>&1`, 15000);
}

async function dnsLookup(target: string): Promise<string> {
  if (!target) return 'Error: provide a domain';
  return runCmd(`dig ${target} ANY +short 2>/dev/null || nslookup ${target} 2>&1`, 10000);
}

async function whoisLookup(target: string): Promise<string> {
  if (!target) return 'Error: provide a domain';
  const whois = await runCmd('which whois 2>/dev/null');
  if (!whois) return 'whois not installed. Install: apt install whois';
  return runCmd(`whois ${target} 2>&1 | head -50`, 15000);
}

async function firewallAudit(options: string): Promise<string> {
  const results: string[] = [];

  results.push('--- Firewall Status ---');
  results.push(await runCmd('ufw status 2>/dev/null || iptables -L -n 2>/dev/null | head -30', 10000));

  results.push('\n--- Listening Ports ---');
  results.push(await runCmd('ss -tuln 2>/dev/null || netstat -tuln 2>/dev/null', 10000));

  results.push('\n--- Open Connections ---');
  results.push(await runCmd('ss -tn state established 2>/dev/null | head -20', 10000));

  return results.join('\n');
}

async function logAnalysis(options: string): Promise<string> {
  const logFile = options || '/var/log/syslog';
  const results: string[] = [];

  results.push(`--- Analyzing: ${logFile} ---`);
  results.push(await runCmd(`tail -50 ${logFile} 2>/dev/null`, 10000));

  results.push('\n--- Failed Auth Attempts ---');
  results.push(await runCmd(`grep -i "failed\\|error\\|denied" ${logFile} 2>/dev/null | tail -10`, 10000));

  results.push('\n--- Recent SSH Logins ---');
  results.push(await runCmd('last -n 10 2>/dev/null', 10000));

  return results.join('\n');
}

async function bannerGrab(target: string, options: string): Promise<string> {
  if (!target) return 'Error: provide target host:port';
  const [host, port] = target.includes(':') ? target.split(':') : [target, options || '80'];

  return runCmd(`echo "" | nc -w 3 ${host} ${port} 2>/dev/null || echo "Connection failed"`, 10000);
}

async function recon(target: string, team: string): Promise<string> {
  if (!target) return 'Error: provide a target domain/IP';

  const results: string[] = [];

  results.push(`--- Reconnaissance: ${target} ---`);
  results.push(`Team: ${team}\n`);

  results.push('DNS Records:');
  results.push(await runCmd(`dig ${target} ANY +short 2>/dev/null`, 10000));

  results.push('\nSubdomain check (common):');
  for (const sub of ['www', 'mail', 'ftp', 'admin', 'api', 'dev', 'staging']) {
    const result = await runCmd(`dig ${sub}.${target} +short 2>/dev/null`, 5000);
    if (result) results.push(`  ${sub}.${target}: ${result}`);
  }

  if (team === 'red' || team === 'purple') {
    results.push('\nTechnology detection:');
    results.push(await runCmd(`curl -sI https://${target} 2>/dev/null | grep -i "server\\|x-powered\\|x-aspnet"`, 10000));
  }

  return results.join('\n');
}

async function pentestReport(target: string): Promise<string> {
  if (!target) return 'Error: provide target scope';

  return `Pentest Report Template - ${target}
==========================================
Date: ${new Date().toISOString().split('T')[0]}
Scope: ${target}
Team: Purple

1. EXECUTIVE SUMMARY
   [Auto-generated findings will appear here]

2. SCOPE
   Target: ${target}

3. METHODOLOGY
   - Reconnaissance (passive + active)
   - Vulnerability scanning
   - Exploitation (authorized only)
   - Post-exploitation analysis

4. FINDINGS
   Run individual checks (scan, vuln, ssl, firewall, logcheck)
   to populate findings automatically.

5. RECOMMENDATIONS
   [Based on findings above]

6. RISK RATING
   [Critical / High / Medium / Low / Info]`;
}
