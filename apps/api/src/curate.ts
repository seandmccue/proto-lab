import type { DatabaseSync } from 'node:sqlite';
import { VersionRecord } from '@protolab/schema';
import { largeShowcases, type LargeShowcase } from '../../large-showcases.mts';
import type { ObjectStore } from './store.ts';

export function curateLargeShowcases(db: DatabaseSync, store: ObjectStore, entries: readonly LargeShowcase[] = largeShowcases): number {
  const select = db.prepare(`SELECT v.manifest_key, v.model_id FROM inventions i
    JOIN versions v ON v.id=i.current_version_id AND v.invention_id=i.id
    WHERE i.id=? AND v.id=? AND i.visibility='public' AND i.status='passed' AND i.featured=0
      AND v.status='passed' AND v.model_id LIKE 'muse-%'
      AND NOT EXISTS (SELECT 1 FROM jobs WHERE invention_id=i.id AND status IN ('queued', 'running'))`);
  const feature = db.prepare('UPDATE inventions SET featured=1 WHERE id=? AND current_version_id=? AND featured=0');
  let changed = 0;
  for (const entry of entries) {
    const row = select.get(entry.inventionId, entry.versionId) as { manifest_key: string; model_id: string } | undefined;
    if (!row) continue;
    let manifest: unknown;
    try {
      manifest = store.getJson(row.manifest_key);
    } catch (error) {
      console.warn(`[showcase] Could not read curated version ${entry.versionId}`, error instanceof SyntaxError ? 'invalid JSON' : 'object read failed');
      continue;
    }
    const parsed = VersionRecord.safeParse(manifest);
    if (!parsed.success) continue;
    const version = parsed.data;
    if (version.id !== entry.versionId || version.inventionId !== entry.inventionId || version.modelId !== row.model_id ||
      !version.modelId.startsWith('muse-') || version.status !== 'passed' || version.assembly.instances.length !== entry.componentCount ||
      !version.tests.every((test) => test.passed) || !entry.testIds.every((id) => version.tests.some((test) => test.testId === id && test.trace.frames.length > 1))) continue;
    changed += Number(feature.run(entry.inventionId, entry.versionId).changes);
  }
  return changed;
}
