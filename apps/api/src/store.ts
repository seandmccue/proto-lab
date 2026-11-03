import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync, renameSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/** Local object store standing in for R2. Keys are relative paths; served under /store/. */
export class ObjectStore {
  constructor(private root: string) { mkdirSync(root, { recursive: true }); }
  private path(key: string) {
    const p = resolve(this.root, key);
    const rel = relative(this.root, p);
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('bad key');
    return p;
  }
  private write(key: string, value: string | Uint8Array) {
    const target = this.path(key);
    mkdirSync(dirname(target), { recursive: true });
    // Stage beside the store so snapshots only see complete files and the rename stays on the same filesystem.
    const temp = mkdtempSync(join(dirname(resolve(this.root)), '.store-write-'));
    try {
      const staged = join(temp, 'object');
      writeFileSync(staged, value);
      renameSync(staged, target);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  }
  putJson(key: string, value: unknown) { this.write(key, JSON.stringify(value)); }
  putBytes(key: string, bytes: Uint8Array) { this.write(key, bytes); }
  getJson<T>(key: string): T | null { const p = this.path(key); return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as T) : null; }
  getBytes(key: string): Buffer | null { const p = this.path(key); return existsSync(p) ? readFileSync(p) : null; }
  has(key: string) { return existsSync(this.path(key)); }
}
