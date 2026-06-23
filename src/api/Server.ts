import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Metrics } from '../agent/Metrics.js';
import { ToolRegistry } from '../tools/Registry.js';
import { CronDaemon } from '../agent/CronDaemon.js';
import { AgentLoop } from '../agent/AgentLoop.js';
import { loadConfig } from '../agent/Config.js';
import * as path from 'path';
import * as fs from 'fs';

export class AurixServer {
  private fastify = Fastify({ logger: false });
  private cronDaemon: CronDaemon;
  private registry: ToolRegistry;

  constructor(registry: ToolRegistry) {
    this.registry = registry;
    this.cronDaemon = new CronDaemon(registry);
    this.setupRoutes();
  }

  private setupRoutes() {
    this.fastify.register(cors, { origin: '*' });

    // Status / Health
    this.fastify.get('/api/status', async (request, reply) => {
      return {
        status: 'online',
        uptime: Metrics.getUptimeFormatted(),
        uptimeMs: Metrics.getUptimeMs()
      };
    });

    // Cron Jobs
    this.fastify.get('/api/cron', async (request, reply) => {
      return this.cronDaemon.listJobs();
    });

    this.fastify.post('/api/cron', async (request: any, reply) => {
      const { schedule, prompt } = request.body;
      if (!schedule || !prompt) return reply.status(400).send({ error: 'schedule and prompt required' });
      try {
        const job = this.cronDaemon.addJob(schedule, prompt);
        return job;
      } catch (e: any) {
        return reply.status(400).send({ error: e.message });
      }
    });

    this.fastify.delete('/api/cron/:id', async (request: any, reply) => {
      const { id } = request.params;
      const success = this.cronDaemon.removeJob(id);
      return { success };
    });

    // Execute Agent task immediately (sync/async)
    this.fastify.post('/api/execute', async (request: any, reply) => {
      const { prompt, isAsync = true } = request.body;
      if (!prompt) return reply.status(400).send({ error: 'prompt required' });
      
      const config = await loadConfig();
      const agent = new AgentLoop(config, this.registry);
      agent.setMessages([{ role: 'user', content: prompt }]);

      if (isAsync) {
        // Run in background
        (async () => { for await (const _ of agent.run(prompt)) {} })().catch((e: any) => console.error('API Agent Background Error:', e));
        return { status: 'started', message: 'Task is running in background' };
      } else {
        // Wait for result
        for await (const _ of agent.run(prompt)) {}
        const lastMsg = agent.getMessages().filter(m => m.role === 'assistant').pop();
        return { status: 'completed', response: lastMsg?.content || '' };
      }
    });
  }

  public async start(port: number = 3000) {
    try {
      await this.fastify.listen({ port, host: '0.0.0.0' });
      console.log(`\n🚀 Aurix Dashboard API running at http://localhost:${port}`);
    } catch (err) {
      this.fastify.log.error(err);
      process.exit(1);
    }
  }
}
