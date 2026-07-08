import type { AgentEvent } from './AgentLoop.js';

export type AgentObserverSource =
  | 'agent_loop'
  | 'multi_agent'
  | 'spawn_agent'
  | 'cron'
  | 'research';

export type AgentObserverStatus = 'running' | 'success' | 'error' | 'timeout' | 'cancelled';

export interface AgentObserverEvent {
  sessionId?: string;
  turnId?: string;
  jobId?: string;
  source: AgentObserverSource;
  eventType: string;
  status?: AgentObserverStatus;
  toolName?: string;
  summary?: string;
  payload?: Record<string, unknown>;
  createdAt?: string;
}

export type AgentObserverListener = (event: AgentObserverEvent) => void | Promise<void>;

export class AgentObserverBus {
  private listeners = new Set<AgentObserverListener>();

  subscribe(listener: AgentObserverListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(event: AgentObserverEvent): void {
    const normalized = {
      ...event,
      status: event.status || (event.eventType === 'error' ? 'error' : undefined),
      createdAt: event.createdAt || new Date().toISOString(),
    };
    for (const listener of this.listeners) {
      try {
        Promise.resolve(listener(normalized)).catch(() => {
          // Observability must never break agent execution.
        });
      } catch {
        // Observability must never break agent execution.
      }
    }
  }

  publishAgentEvent(
    source: AgentObserverSource,
    event: AgentEvent,
    context: Pick<AgentObserverEvent, 'sessionId' | 'turnId' | 'jobId'> = {}
  ): void {
    this.publish({
      ...context,
      source,
      eventType: event.type,
      status: event.status,
      toolName: event.toolName,
      summary: event.data?.slice(0, 500),
      payload: {
        data: event.data,
        toolArgs: event.toolArgs,
        toolCallId: event.toolCallId,
        durationMs: event.durationMs,
        errorType: event.errorType,
      },
    });
  }

  clear(): void {
    this.listeners.clear();
  }
}

export const agentObserverBus = new AgentObserverBus();
