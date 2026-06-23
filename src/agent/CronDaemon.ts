import * as cron from 'node-cron';
import { AgentLoop } from './AgentLoop.js';
import { ToolRegistry } from '../tools/Registry.js';
import { loadConfig } from './Config.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface CronJob {
  id: string;
  schedule: string;
  prompt: string;
  status: 'active' | 'paused';
  createdAt: number;
}

export class CronDaemon {
  private jobs: Map<string, CronJob> = new Map();
  private scheduledTasks: Map<string, cron.ScheduledTask> = new Map();
  private dbPath: string;
  private registry: ToolRegistry;

  constructor(registry: ToolRegistry) {
    this.registry = registry;
    const aurixDir = path.join(os.homedir(), '.aurix');
    if (!fs.existsSync(aurixDir)) fs.mkdirSync(aurixDir, { recursive: true });
    this.dbPath = path.join(aurixDir, 'cron.json');
    this.loadJobs();
  }

  private loadJobs() {
    if (!fs.existsSync(this.dbPath)) return;
    try {
      const data = JSON.parse(fs.readFileSync(this.dbPath, 'utf8'));
      for (const job of data as CronJob[]) {
        this.jobs.set(job.id, job);
        if (job.status === 'active') {
          this.scheduleJob(job);
        }
      }
    } catch (e) {
      console.error('Failed to load cron jobs:', e);
    }
  }

  private saveJobs() {
    try {
      fs.writeFileSync(this.dbPath, JSON.stringify(Array.from(this.jobs.values()), null, 2));
    } catch (e) {
      console.error('Failed to save cron jobs:', e);
    }
  }

  public addJob(schedule: string, prompt: string): CronJob {
    if (!cron.validate(schedule)) throw new Error('Invalid cron expression');
    
    const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    const job: CronJob = {
      id,
      schedule,
      prompt,
      status: 'active',
      createdAt: Date.now()
    };
    
    this.jobs.set(id, job);
    this.scheduleJob(job);
    this.saveJobs();
    return job;
  }

  public removeJob(id: string): boolean {
    const task = this.scheduledTasks.get(id);
    if (task) {
      task.stop();
      this.scheduledTasks.delete(id);
    }
    const result = this.jobs.delete(id);
    this.saveJobs();
    return result;
  }

  public listJobs(): CronJob[] {
    return Array.from(this.jobs.values());
  }

  private scheduleJob(job: CronJob) {
    const task = cron.schedule(job.schedule, async () => {
      console.log(`[Cron Trigger] Executing job ${job.id}: ${job.prompt}`);
      try {
        const config = await loadConfig();
        const agent = new AgentLoop(config, this.registry);
        // Execute background agent quietly
        agent.setMessages([{ role: 'user', content: `[CRON TRIGGERED TASK] Please execute the following autonomous task: ${job.prompt}\n\nDo not ask the user for confirmation, just do it and log results if any.` }]);
        for await (const _ of agent.run(job.prompt)) {}
        console.log(`[Cron Job ${job.id}] Finished successfully.`);
      } catch (err: any) {
        console.error(`[Cron Job ${job.id}] Execution failed:`, err.message);
      }
    });
    this.scheduledTasks.set(job.id, task);
  }
}
