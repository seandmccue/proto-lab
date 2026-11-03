import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { type AgentEvent } from '@protolab/agent';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import type { Assembly, VersionRecord } from '@protolab/schema';
import type { ObjectStore } from './store.ts';
import type { JobRow, InventionRow } from './db.ts';

export const newId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
export const now = () => new Date().toISOString();

export type PublicEvent =
  | { t: string; type: 'status'; message: string }
  | { t: string; type: 'spec'; spec: unknown }
  | { t: string; type: 'tool'; tool: string; ok: boolean; summary: string; parts?: unknown[] }
  | { t: string; type: 'assembly'; iteration: number; rationale: string; instances: number; mass_kg: number }
  | { t: string; type: 'test'; iteration: number; testId: string; kind: string; passed: boolean; metrics: Record<string, number>; failureReasons: string[] }
  | { t: string; type: 'version'; versionId: string; iteration: number; status: string }
  | { t: string; type: 'handoff'; from: string; to: string; message: string }
  | { t: string; type: 'done'; status: string; summary: string; modelId: string }
  | { t: string; type: 'error'; message: string };

export function stripTrace(v: VersionRecord): VersionRecord {
  return { ...v, tests: v.tests.map((t) => ({ ...t, trace: { dt: t.trace.dt, frames: [] } })) };
}

export function versionSummary(v: VersionRecord) {
  return {
    id: v.id, iteration: v.iteration, status: v.status, modelId: v.modelId, parentVersionId: v.parentVersionId, createdAt: v.createdAt,
    tests: v.tests.map((t) => ({ testId: t.testId, kind: t.kind, passed: t.passed, metrics: t.metrics, failureReasons: t.failureReasons })),
    decisions: v.decisions,
  };
}

export class JobRunner {
  private queue: Array<() => Promise<void>> = [];
  private active = 0;
  /** Builds run in parallel worker threads (model calls are network-bound); several judges can build at once. */
  private readonly maxConcurrent = Math.max(1, Number(process.env.JOB_CONCURRENCY) || 3);
  private live = new Map<string, PublicEvent[]>();
  private liveAssembly = new Map<string, { assembly: Assembly; iteration: number; rationale: string; at: string }>(); // latest in-progress assembly per job, for "watch it assemble"
  constructor(private db: DatabaseSync, private store: ObjectStore) {}

  events(jobId: string): PublicEvent[] | null { return this.live.get(jobId) ?? null; }
  assemblySnapshot(jobId: string) { return this.liveAssembly.get(jobId) ?? null; }

  enqueue(job: JobRow, invention: InventionRow, opts: { parent: VersionRecord | null; changeRequest?: string }) {
    this.queue.push(() => this.run(job, invention, opts));
    void this.pump();
  }

  private pump() {
    while (this.queue.length && this.active < this.maxConcurrent) {
      const next = this.queue.shift()!; this.active++;
      next().catch((e) => console.error('job failed', e)).finally(() => { this.active--; this.pump(); });
    }
  }
  /** Queue depth + running jobs, for the UI's "N builds ahead of you" hint. */
  load() { return { active: this.active, queued: this.queue.length, maxConcurrent: this.maxConcurrent }; }

  private async run(job: JobRow, invention: InventionRow, opts: { parent: VersionRecord | null; changeRequest?: string }) {
    const events: PublicEvent[] = [];
    this.live.set(job.id, events);
    const update = (status: JobRow['status'], step: string, versionId: string | null = null, errorCode: string | null = null) => {
      this.db.prepare('UPDATE jobs SET status=?, step=?, progress_json=?, version_id=COALESCE(?, version_id), error_code=?, updated_at=? WHERE id=?')
        .run(status, step, JSON.stringify(events.slice(-200)), versionId, errorCode, now(), job.id);
    };
    const push = (e: PublicEvent) => { events.push(e); };
    update('running', 'Starting');
    this.db.prepare('UPDATE inventions SET status=?, updated_at=? WHERE id=?').run('running', now(), invention.id);
    let lastVersionId: string | null = null;
    const onEvent = (e: AgentEvent) => {
      const t = now();
      switch (e.type) {
        case 'status': push({ t, type: 'status', message: e.message }); update('running', e.message); break;
        case 'spec': push({ t, type: 'spec', spec: e.spec }); break;
        case 'tool':
          if (!e.entry.ok) console.warn(`[agent] ${e.entry.tool} rejected: ${e.entry.summary} | args: ${JSON.stringify(e.entry.args ?? null).slice(0, 600)}`); // so input shorthand the model uses can be added to the normalisers
          push({ t, type: 'tool', tool: e.entry.tool, ok: e.entry.ok, summary: e.entry.summary, parts: e.entry.parts }); break;
        case 'assembly': {
          const partMass = new Map(e.assembly.parts.map((p) => [p.id, p.mass_kg]));
          const mass = e.assembly.instances.reduce((m, i) => m + (partMass.get(i.partId) ?? 0), 0);
          this.liveAssembly.set(job.id, { assembly: e.assembly, iteration: e.iteration, rationale: e.rationale, at: t });
          push({ t, type: 'assembly', iteration: e.iteration, rationale: e.rationale, instances: e.assembly.instances.length, mass_kg: +mass.toFixed(3) }); break;
        }
        case 'test': push({ t, type: 'test', iteration: e.iteration, testId: e.result.testId, kind: e.result.kind, passed: e.result.passed, metrics: e.result.metrics, failureReasons: e.result.failureReasons }); break;
        case 'version': {
          const v = e.version;
          this.store.putJson(`versions/${v.id}.json`, v);
          const metrics = JSON.stringify(v.tests.map((x) => ({ testId: x.testId, kind: x.kind, passed: x.passed, metrics: x.metrics, failureReasons: x.failureReasons })));
          this.db.prepare(`INSERT INTO versions (id, invention_id, parent_version_id, iteration, prompt, spec_json, manifest_key, metrics_json, model_id, status, created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET metrics_json=excluded.metrics_json, status=excluded.status, spec_json=excluded.spec_json`)
            .run(v.id, v.inventionId, v.parentVersionId, v.iteration, v.prompt, JSON.stringify(v.spec), `versions/${v.id}.json`, metrics, v.modelId, v.status, v.createdAt);
          lastVersionId = v.id;
          this.db.prepare('UPDATE inventions SET current_version_id=?, updated_at=? WHERE id=?').run(v.id, now(), invention.id);
          push({ t, type: 'version', versionId: v.id, iteration: v.iteration, status: v.status });
          update('running', `Version ${v.iteration} recorded`, v.id);
          break;
        }
        case 'handoff': push({ t, type: 'handoff', from: e.from, to: e.to, message: e.message }); update('running', e.message); break;
        case 'done': push({ t, type: 'done', status: e.status, summary: e.summary, modelId: e.modelId }); break;
        case 'error': push({ t, type: 'error', message: e.message }); break;
      }
    };
    try {
      const startIteration = (this.db.prepare('SELECT COALESCE(MAX(iteration), 0) AS n FROM versions WHERE invention_id=?').get(invention.id) as { n: number }).n;
      // The agent (model calls + Rapier simulation) runs in a worker thread so HTTP polling stays responsive.
      const out = await new Promise<{ status: 'passed' | 'failed' | 'error'; summary: string; modelId: string }>((resolve, reject) => {
        const worker = new Worker(fileURLToPath(new URL('./agentWorker.ts', import.meta.url)), { workerData: { prompt: invention.prompt, inventionId: invention.id, parent: opts.parent, changeRequest: opts.changeRequest, startIteration, versionIds: Array.from({ length: 40 }, () => newId('ver')) }, env: process.env as Record<string, string> });
        worker.on('message', (m: { kind: 'event'; event: AgentEvent } | { kind: 'result'; status: 'passed' | 'failed' | 'error'; summary: string; modelId: string }) => { if (m.kind === 'event') onEvent(m.event); else resolve(m); });
        worker.on('error', (e) => reject(e));
        worker.on('exit', (code) => { if (code !== 0) reject(new Error(`agent worker exited with code ${code}`)); });
      });
      // The description follows the latest build's summary until the owner publishes (publishing stores their own text).
      this.db.prepare('UPDATE inventions SET status=?, description=CASE WHEN visibility=\'public\' AND description<>\'\' THEN description ELSE ? END, updated_at=? WHERE id=?').run(out.status, out.summary, now(), invention.id);
      update(out.status === 'error' ? 'error' : 'done', out.status === 'passed' ? 'Passed' : out.status === 'failed' ? 'Did not pass' : 'Error', lastVersionId, out.status === 'error' ? 'agent_error' : null);
    } catch (e) {
      push({ t: now(), type: 'error', message: (e as Error).message });
      this.db.prepare('UPDATE inventions SET status=?, updated_at=? WHERE id=?').run('error', now(), invention.id);
      update('error', 'Error', lastVersionId, 'agent_error');
    } finally {
      setTimeout(() => { this.live.delete(job.id); this.liveAssembly.delete(job.id); }, 5 * 60_000).unref();
    }
  }
}
