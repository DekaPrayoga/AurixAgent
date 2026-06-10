import si from 'systeminformation';
import type { Tool } from './Registry.js';

export const systemMonitorTool: Tool = {
  name: 'system_info',
  description: 'Get system information: CPU, RAM, disk, OS, uptime, temperature, network. Use for monitoring hardware and system status.',
  parameters: {
    type: 'object',
    properties: {
      section: {
        type: 'string',
        description: 'Which info to get: cpu, memory, disk, os, network, all (default: all)',
      },
    },
  },
  async execute(args) {
    const section = (args.section as string) || 'all';
    const results: string[] = [];

    try {
      if (section === 'cpu' || section === 'all') {
        const cpu = await si.cpu();
        const load = await si.currentLoad();
        results.push(`CPU: ${cpu.manufacturer} ${cpu.brand} (${cpu.cores} cores)`);
        results.push(`Load: ${load.currentLoad.toFixed(1)}%`);
      }

      if (section === 'memory' || section === 'all') {
        const mem = await si.mem();
        const usedGB = (mem.used / 1073741824).toFixed(1);
        const totalGB = (mem.total / 1073741824).toFixed(1);
        const pct = ((mem.used / mem.total) * 100).toFixed(1);
        results.push(`RAM: ${usedGB}GB / ${totalGB}GB (${pct}%)`);
      }

      if (section === 'disk' || section === 'all') {
        const disks = await si.fsSize();
        for (const d of disks.slice(0, 3)) {
          const usedGB = (d.used / 1073741824).toFixed(1);
          const totalGB = (d.size / 1073741824).toFixed(1);
          results.push(`Disk ${d.mount}: ${usedGB}GB / ${totalGB}GB (${d.use}%)`);
        }
      }

      if (section === 'os' || section === 'all') {
        const os = await si.osInfo();
        const uptime = await si.time();
        results.push(`OS: ${os.distro} ${os.release} (${os.arch})`);
        results.push(`Uptime: ${Math.floor(uptime.uptime / 3600)}h ${Math.floor((uptime.uptime % 3600) / 60)}m`);
      }

      if (section === 'network' || section === 'all') {
        const nets = await si.networkInterfaces();
        const withIp = nets.filter(n => n.ip4);
        for (const n of withIp.slice(0, 2)) {
          results.push(`Network: ${n.iface} (${n.type || 'unknown'}) - ${n.ip4}`);
        }
      }
    } catch (e: any) {
      results.push(`Error: ${e.message}`);
    }

    return results.join('\n');
  },
};
