import * as cron from 'node-cron';
import crypto from 'crypto';
import { AgentLoop } from './AgentLoop.js';
import { loadConfig } from './Config.js';
import type { ToolRegistry } from '../tools/Registry.js';
import {
  getSessionStore,
  installObserverBusSessionSink,
  type ScheduledJob,
  type ScheduledJobRun,
} from './SessionStore.js';
import { agentObserverBus } from './AgentObserverBus.js';

export interface CronTarget {
  platform?: string;
  channelId?: string;
  replyTo?: string;
}

export type CronDelivery = (job: ScheduledJob, result: string) => Promise<void>;

export type CronJob = ScheduledJob;

export class CronDaemon {
  private scheduledTasks = new Map<string, cron.ScheduledTask>();
  private ready: Promise<void> | null = null;

  constructor(
    private registry: ToolRegistry,
    private deliver?: CronDelivery
  ) {
    installObserverBusSessionSink();
  }

  setDelivery(deliver: CronDelivery): void {
    this.deliver = deliver;
  }

  async start(): Promise<void> {
    if (!this.ready) {
      this.ready = this.loadJobs();
    }
    await this.ready;
  }

  private async loadJobs(): Promise<void> {
    const store = await getSessionStore();
    for (const job of store.listScheduledJobs(false)) {
      this.scheduleJob(job);
    }
  }

  private scheduleJob(job: ScheduledJob): void {
    if (this.scheduledTasks.has(job.id)) return;
    if (!cron.validate(job.schedule)) return;
    const task = cron.schedule(job.schedule, () => {
      this.runJob(job.id).catch((err) => {
        console.error(`[Cron Job ${job.id}] Execution failed:`, err?.message || String(err));
      });
    });
    this.scheduledTasks.set(job.id, task);
  }

  async addJob(schedule: string, prompt: string, target: CronTarget = {}): Promise<CronJob> {
    await this.start();
    if (!cron.validate(schedule)) throw new Error('Invalid cron expression');
    const store = await getSessionStore();
    const id = `cron_${crypto.randomBytes(5).toString('hex')}`;
    const job = store.upsertScheduledJob({
      id,
      schedule,
      prompt,
      status: 'active',
      targetPlatform: target.platform,
      targetChannelId: target.channelId,
      targetReplyTo: target.replyTo,
    });
    this.scheduleJob(job);
    agentObserverBus.publish({
      jobId: id,
      source: 'cron',
      eventType: 'job_added',
      status: 'success',
      summary: `Scheduled ${schedule}: ${prompt}`,
      payload: { schedule, target },
    });
    return job;
  }

  async removeJob(id: string): Promise<boolean> {
    await this.start();
    const task = this.scheduledTasks.get(id);
    if (task) {
      task.stop();
      this.scheduledTasks.delete(id);
    }
    const store = await getSessionStore();
    const removed = store.removeScheduledJob(id);
    agentObserverBus.publish({
      jobId: id,
      source: 'cron',
      eventType: 'job_removed',
      status: removed ? 'success' : 'error',
      summary: removed ? `Removed cron job ${id}` : `Cron job not found: ${id}`,
    });
    return removed;
  }

  async listJobs(): Promise<CronJob[]> {
    await this.start();
    const store = await getSessionStore();
    return store.listScheduledJobs(true);
  }

  async runJob(id: string, options: { deliver?: boolean } = {}): Promise<ScheduledJobRun> {
    await this.start();
    const store = await getSessionStore();
    const job = store.listScheduledJobs(true).find((j) => j.id === id);
    if (!job) throw new Error(`Cron job not found: ${id}`);
    if (job.status !== 'active') throw new Error(`Cron job is ${job.status}: ${id}`);

    const startedAt = new Date().toISOString();
    const runId = store.recordScheduledJobRun({ jobId: id, startedAt, status: 'running' });
    agentObserverBus.publish({
      jobId: id,
      source: 'cron',
      eventType: 'run_start',
      status: 'running',
      summary: job.prompt,
      payload: { runId, schedule: job.schedule },
    });

    try {
      const config = loadConfig();
      const agent = new AgentLoop(config, this.registry);
      agent.setSessionKey(`cron:${id}`);
      let finalText = '';
      const prompt = `[CRON TRIGGERED TASK]\n${job.prompt}\n\nRun autonomously. If this job has a gateway delivery target, produce a concise final answer suitable for sending to that chat.`;
      for await (const event of agent.run(prompt)) {
        agentObserverBus.publishAgentEvent('cron', event, {
          sessionId: event.sessionId || agent.getSessionId(),
          turnId: event.turnId,
          jobId: id,
        });
        if (event.type === 'text' && event.data) finalText = event.data;
        if (event.type === 'error' && event.data) finalText = `Error: ${event.data}`;
      }
      const finishedAt = new Date().toISOString();
      const result = finalText || '(cron job completed with no final text)';
      if (options.deliver !== false && this.deliver && job.targetPlatform && job.targetChannelId) {
        await this.deliver(job, result);
        agentObserverBus.publish({
          jobId: id,
          source: 'cron',
          eventType: 'delivery_success',
          status: 'success',
          summary: `${job.targetPlatform}:${job.targetChannelId}`,
          payload: {
            runId,
            targetPlatform: job.targetPlatform,
            targetChannelId: job.targetChannelId,
          },
        });
      }
      const run: ScheduledJobRun = {
        id: runId,
        jobId: id,
        startedAt,
        finishedAt,
        status: 'success',
        result,
      };
      store.recordScheduledJobRun(run);
      agentObserverBus.publish({
        jobId: id,
        source: 'cron',
        eventType: 'run_end',
        status: 'success',
        summary: result,
        payload: { runId, finishedAt },
      });
      return run;
    } catch (err: any) {
      const finishedAt = new Date().toISOString();
      const run: ScheduledJobRun = {
        id: runId,
        jobId: id,
        startedAt,
        finishedAt,
        status: 'error',
        error: err?.message || String(err),
      };
      store.recordScheduledJobRun(run);
      agentObserverBus.publish({
        jobId: id,
        source: 'cron',
        eventType: 'run_end',
        status: 'error',
        summary: err?.message || String(err),
        payload: { runId, finishedAt },
      });
      return run;
    }
  }

  stop(): void {
    for (const task of this.scheduledTasks.values()) task.stop();
    this.scheduledTasks.clear();
  }
}
