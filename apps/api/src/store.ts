import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

/** Local object store standing in for R2. Keys are relative paths; served under /store/. */
export class ObjectStore {
  constructor(private root: string) { mkdirSync(root, { recursive: true }); }
  private path(key: string) {
    const p = normalize(join(this.root, key));
    if (!p.startsWith(normalize(this.root))) throw new Error('bad key');
    return p;
  }
  putJson(key: string, value: unknown) { const p = this.path(key); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(value)); }
  putBytes(key: string, bytes: Uint8Array) { const p = this.path(key); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, bytes); }
  getJson<T>(key: string): T | null { const p = this.path(key); return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as T) : null; }
  getBytes(key: string): Buffer | null { const p = this.path(key); return existsSync(p) ? readFileSync(p) : null; }
  has(key: string) { return existsSync(this.path(key)); }
}
