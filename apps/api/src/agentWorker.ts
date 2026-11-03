// Runs one agent job in a worker thread so simulation CPU never blocks the HTTP server.
import { parentPort, workerData } from 'node:worker_threads';
import { runAgent, type AgentEvent } from '@protolab/agent';
import { initSimulator } from '@protolab/simulator';
import type { VersionRecord } from '@protolab/schema';

interface Input { prompt: string; inventionId: string; parent: VersionRecord | null; changeRequest?: string; startIteration: number; versionIds: string[] }
const input = workerData as Input;
let n = 0;
await initSimulator();
const out = await runAgent({ prompt: input.prompt, inventionId: input.inventionId, parent: input.parent, changeRequest: input.changeRequest, startIteration: input.startIteration, newVersionId: () => input.versionIds[n++] ?? `ver_${Date.now().toString(36)}${n}` }, (e: AgentEvent) => parentPort!.postMessage({ kind: 'event', event: e }));
parentPort!.postMessage({ kind: 'result', status: out.status, summary: out.summary, modelId: out.modelId });
