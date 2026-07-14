import { exec, spawn } from 'child_process';
import type { Tool, ToolExecutionContext } from './Registry.js';

let activeContext: ToolExecutionContext | undefined;

export const vpsTool: Tool = {
  name: 'vps',
  description:
    'VPS management: monitor resources, manage services, deploy applications, manage Docker, configure nginx, SSL certificates, backup management, security hardening. Safe mode prevents destructive operations.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description:
          'Action: status, services, docker, nginx, ssl, backup, security, deploy, logs, cleanup',
      },
      target: {
        type: 'string',
        description: 'Service name, container, or domain to operate on',
      },
      options: {
        type: 'string',
        description: 'Additional options',
      },
    },
    required: ['action'],
  },
  async execute(args) {
    return runAction(args);
  },
  async executeWithEvents(args, context) {
    activeContext = context;
    try {
      return await runAction(args);
    } finally {
      activeContext = undefined;
    }
  },
};

async function runAction(args: Record<string, unknown>): Promise<string> {
  const action = args.action as string;
  const target = (args.target as string) || '';
  const options = (args.options as string) || '';

  switch (action) {
    case 'status':
      return vpsStatus();
    case 'services':
      return serviceList(target);
    case 'docker':
      return dockerManage(target, options);
    case 'nginx':
      return nginxManage(target, options);
    case 'ssl':
      return sslManage(target);
    case 'backup':
      return backupManage(target, options);
    case 'security':
      return securityHardening(options);
    case 'deploy':
      return deployApp(target, options);
    case 'logs':
      return viewLogs(target, options);
    case 'cleanup':
      return cleanup(options);
    default:
      return `Unknown action: ${action}`;
  }
}

function emitLine(stream: 'stdout' | 'stderr', buffer: { value: string }, chunk: Buffer) {
  if (!activeContext?.onEvent) return;
  buffer.value += chunk.toString();
  const lines = buffer.value.split(/\r\n|\n|\r/);
  buffer.value = lines.pop() || '';
  for (const line of lines) {
    if (line.trim()) activeContext.onEvent({ type: 'chunk', stream, data: line });
  }
}

function flushLine(stream: 'stdout' | 'stderr', buffer: { value: string }) {
  if (!activeContext?.onEvent) return;
  const line = buffer.value.trim();
  if (line) activeContext.onEvent({ type: 'chunk', stream, data: line });
  buffer.value = '';
}

function run(cmd: string, timeout = 30000): Promise<string> {
  if (!activeContext?.onEvent) {
    return new Promise((resolve) => {
      exec(cmd, { timeout, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
        const out = stdout.trim();
        const errOut = stderr.trim();
        if (out) return resolve(out);
        if (errOut) return resolve(errOut);
        if (err) return resolve(`Error: ${err.message}`);
        resolve('(no output)');
      });
    });
  }

  return new Promise((resolve) => {
    const child = spawn('/bin/bash', ['-lc', cmd], { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const stdoutLine = { value: '' };
    const stderrLine = { value: '' };
    let timedOut = false;

    const timer =
      timeout > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
            setTimeout(() => {
              if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
            }, 1000).unref?.();
          }, timeout)
        : undefined;

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      emitLine('stdout', stdoutLine, chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
      emitLine('stderr', stderrLine, chunk);
    });

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      resolve(`Error executing command: ${err.message}`);
    });

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      flushLine('stdout', stdoutLine);
      flushLine('stderr', stderrLine);
      const stdout = Buffer.concat(stdoutChunks).toString().trim();
      const stderr = Buffer.concat(stderrChunks).toString().trim();
      const out = stdout || stderr;
      if (out) return resolve(out);
      if (timedOut) return resolve('[timeout] Command killed after timeout');
      if (code && code !== 0) return resolve(`[exit ${code}]`);
      resolve('(no output)');
    });
  });
}

async function vpsStatus(): Promise<string> {
  const results: string[] = ['=== VPS Status ===\n'];

  results.push('System:');
  results.push(await run('uname -a'));
  results.push('\nUptime:');
  results.push(await run('uptime'));
  results.push('\nCPU:');
  results.push(await run('nproc && cat /proc/cpuinfo | grep "model name" | head -1'));
  results.push('\nMemory:');
  results.push(await run('free -h'));
  results.push('\nDisk:');
  results.push(await run('df -h / /home 2>/dev/null'));
  results.push('\nNetwork:');
  results.push(await run('ip -brief addr 2>/dev/null || hostname -I'));
  results.push('\nLoad Average:');
  results.push(await run('cat /proc/loadavg'));

  return results.join('\n');
}

async function serviceList(target: string): Promise<string> {
  if (target) {
    return run(`systemctl status ${target} 2>/dev/null || service ${target} status 2>/dev/null`);
  }
  return run('systemctl list-units --type=service --state=running 2>/dev/null | head -30');
}

async function dockerManage(target: string, options: string): Promise<string> {
  const docker = await run('which docker 2>/dev/null');
  if (!docker) return 'Docker not installed';

  if (!target) return run('docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>&1');

  switch (target) {
    case 'logs':
      return run(`docker logs ${options || '--tail 50'} 2>&1`);
    case 'start':
      return run(`docker start ${options} 2>&1`);
    case 'stop':
      return run(`docker stop ${options} 2>&1`);
    case 'restart':
      return run(`docker restart ${options} 2>&1`);
    case 'images':
      return run('docker images 2>&1');
    case 'volumes':
      return run('docker volume ls 2>&1');
    case 'network':
      return run('docker network ls 2>&1');
    case 'stats':
      return run('docker stats --no-stream 2>&1');
    default:
      return run(
        `docker ps -a --filter "name=${target}" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>&1`
      );
  }
}

async function nginxManage(target: string, options: string): Promise<string> {
  if (!target) {
    return `Nginx Status:\n${await run('systemctl status nginx 2>/dev/null | head -10')}\n\nSites:\n${await run('ls /etc/nginx/sites-enabled/ 2>/dev/null')}`;
  }

  switch (target) {
    case 'test':
      return run('nginx -t 2>&1');
    case 'reload':
      return run('systemctl reload nginx 2>&1');
    case 'restart':
      return run('systemctl restart nginx 2>&1');
    case 'sites':
      return run('ls -la /etc/nginx/sites-available/ 2>/dev/null');
    case 'logs':
      return run('tail -20 /var/log/nginx/error.log 2>/dev/null');
    default:
      return `Viewing site config: ${target}\n${await run(`cat /etc/nginx/sites-available/${target} 2>/dev/null`)}`;
  }
}

async function sslManage(target: string): Promise<string> {
  if (!target) {
    return `SSL Certificates:\n${await run('certbot certificates 2>/dev/null || ls /etc/letsencrypt/live/ 2>/dev/null')}`;
  }
  return run(
    `echo | openssl s_client -connect ${target}:443 -servername ${target} 2>/dev/null | openssl x509 -noout -dates -subject 2>&1`
  );
}

async function backupManage(target: string, options: string): Promise<string> {
  if (!target) {
    return `Backup directories:\n${await run('ls -la /backup/ 2>/dev/null || echo "No /backup/ directory"')}`;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = `/backup/${timestamp}`;

  switch (target) {
    case 'create':
      return run(
        `mkdir -p ${backupDir} && tar -czf ${backupDir}/backup-${options || 'system'}.tar.gz ${options || '/etc /home'} 2>&1 && echo "Backup created: ${backupDir}"`
      );
    case 'list':
      return run(`find /backup/ -name "*.tar.gz" -ls 2>/dev/null`);
    case 'verify':
      return run(`tar -tzf ${options} 2>&1 | tail -10`);
    default:
      return `Unknown backup action: ${target}`;
  }
}

async function securityHardening(options: string): Promise<string> {
  const results: string[] = ['=== Security Audit ===\n'];

  results.push('SSH Config:');
  results.push(
    await run(
      'grep -E "PermitRootLogin|PasswordAuthentication|Port " /etc/ssh/sshd_config 2>/dev/null'
    )
  );

  results.push('\nFirewall:');
  results.push(await run('ufw status 2>/dev/null || iptables -L -n 2>/dev/null | head -15'));

  results.push('\nFailed Logins (last 10):');
  results.push(
    await run(
      'lastb -n 10 2>/dev/null || grep "Failed password" /var/log/auth.log 2>/dev/null | tail -10'
    )
  );

  results.push('\nListening Ports:');
  results.push(await run('ss -tuln 2>/dev/null'));

  results.push('\nUsers with UID 0 (root):');
  results.push(await run("awk -F: '$3 == 0 {print $1}' /etc/passwd"));

  results.push('\nWorld-writable files in /etc:');
  results.push(await run('find /etc -perm -o+w -type f 2>/dev/null | head -10'));

  return results.join('\n');
}

async function deployApp(target: string, options: string): Promise<string> {
  if (!target) return 'Provide deployment target (docker-compose, pm2, systemd)';

  switch (target) {
    case 'pm2':
      return run(`pm2 list 2>/dev/null || echo "PM2 not installed"`);
    case 'docker-compose':
      return run(`docker compose ps 2>/dev/null || docker-compose ps 2>/dev/null`);
    case 'systemd':
      return run(`systemctl list-units --type=service --state=running 2>/dev/null | head -20`);
    default:
      return `Unknown deploy target: ${target}`;
  }
}

async function viewLogs(target: string, options: string): Promise<string> {
  const lines = options || '50';
  if (!target) return run(`journalctl -n ${lines} --no-pager 2>/dev/null`);
  return run(
    `journalctl -u ${target} -n ${lines} --no-pager 2>/dev/null || tail -${lines} /var/log/${target}.log 2>/dev/null`
  );
}

async function cleanup(options: string): Promise<string> {
  const results: string[] = ['=== Cleanup Report (safe mode) ===\n'];

  results.push('Disk usage before:');
  results.push(await run('df -h /'));

  results.push('\nApt cache size:');
  results.push(await run('du -sh /var/cache/apt/archives/ 2>/dev/null'));

  results.push('\nDocker cleanup potential:');
  results.push(await run('docker system df 2>/dev/null'));

  results.push('\nLog files > 100MB:');
  results.push(await run('find /var/log -size +100M -exec ls -lh {} \\; 2>/dev/null'));

  results.push('\nTmp files older than 7 days:');
  results.push(await run('find /tmp -mtime +7 -type f 2>/dev/null | wc -l'));

  results.push('\n[No destructive actions performed. Run specific cleanup commands to execute.]');

  return results.join('\n');
}
