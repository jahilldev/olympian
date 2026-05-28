import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import { METRIC_PREFIX, type AgentPhaseLabel, type AgentRunStatusLabel } from './metrics.model.js';

@Injectable()
export class MetricsService {
  private readonly registry = new Registry();

  readonly webhookEvents: Counter<'event' | 'action'>;
  readonly jobTransitions: Counter<'from' | 'to'>;
  readonly jobsByState: Gauge<'state'>;
  readonly queueDepth: Gauge<'status'>;
  readonly agentRuns: Counter<'phase' | 'status'>;
  readonly agentRunDuration: Histogram<'phase'>;
  readonly reviewConfidence: Gauge;

  constructor() {
    collectDefaultMetrics({ register: this.registry, prefix: METRIC_PREFIX });

    this.webhookEvents = new Counter({
      name: `${METRIC_PREFIX}webhook_events_total`,
      help: 'GitHub webhook deliveries received.',
      labelNames: ['event', 'action'],
      registers: [this.registry],
    });
    this.jobTransitions = new Counter({
      name: `${METRIC_PREFIX}job_transitions_total`,
      help: 'Job state transitions.',
      labelNames: ['from', 'to'],
      registers: [this.registry],
    });
    this.jobsByState = new Gauge({
      name: `${METRIC_PREFIX}jobs_by_state`,
      help: 'Number of jobs currently in each state.',
      labelNames: ['state'],
      registers: [this.registry],
    });
    this.queueDepth = new Gauge({
      name: `${METRIC_PREFIX}queue_depth`,
      help: 'Queue tasks by status.',
      labelNames: ['status'],
      registers: [this.registry],
    });
    this.agentRuns = new Counter({
      name: `${METRIC_PREFIX}agent_runs_total`,
      help: 'Hermes agent invocations by phase and terminal status.',
      labelNames: ['phase', 'status'],
      registers: [this.registry],
    });
    this.agentRunDuration = new Histogram({
      name: `${METRIC_PREFIX}agent_run_duration_seconds`,
      help: 'Wall-clock duration of Hermes agent invocations.',
      labelNames: ['phase'],
      buckets: [5, 15, 30, 60, 120, 300, 600, 1200, 1800],
      registers: [this.registry],
    });
    this.reviewConfidence = new Gauge({
      name: `${METRIC_PREFIX}last_review_confidence`,
      help: 'Confidence (0-100) of the most recent review pass.',
      registers: [this.registry],
    });
  }

  recordWebhook(event: string, action?: string): void {
    this.webhookEvents.inc({ event, action: action ?? 'none' });
  }

  recordTransition(from: string | null, to: string): void {
    this.jobTransitions.inc({ from: from ?? 'none', to });
  }

  recordAgentRun(phase: AgentPhaseLabel, status: AgentRunStatusLabel, durationMs: number): void {
    this.agentRuns.inc({ phase, status });
    this.agentRunDuration.observe({ phase }, durationMs / 1000);
  }

  setJobsByState(counts: Record<string, number>): void {
    this.jobsByState.reset();
    for (const [state, count] of Object.entries(counts)) {
      this.jobsByState.set({ state }, count);
    }
  }

  setQueueDepth(counts: Record<string, number>): void {
    this.queueDepth.reset();
    for (const [status, count] of Object.entries(counts)) {
      this.queueDepth.set({ status }, count);
    }
  }

  async render(): Promise<{ contentType: string; body: string }> {
    return { contentType: this.registry.contentType, body: await this.registry.metrics() };
  }
}
