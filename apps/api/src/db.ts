import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export interface InventionRow { id: string; owner_id: string; title: string; description: string; visibility: 'private' | 'public'; current_version_id: string | null; status: string; parent_version_id: string | null; source_invention_id: string | null; prompt: string; featured: number; created_at: string; updated_at: string }
export interface VersionRow { id: string; invention_id: string; parent_version_id: string | null; iteration: number; prompt: string; spec_json: string; manifest_key: string; metrics_json: string; model_id: string; status: string; created_at: string }
export interface JobRow { id: string; invention_id: string; version_id: string | null; status: 'queued' | 'running' | 'done' | 'error'; step: string; progress_json: string; error_code: string | null; baseline_version_id?: string | null; change_request?: string | null; created_at: string; updated_at: string }

export function openDb(dataDir: string): DatabaseSync {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, 'protolab.sqlite'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, display_name TEXT, created_at TEXT);
    CREATE TABLE IF NOT EXISTS inventions (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      visibility TEXT NOT NULL DEFAULT 'private', current_version_id TEXT, status TEXT NOT NULL DEFAULT 'queued',
      parent_version_id TEXT, source_invention_id TEXT, prompt TEXT NOT NULL, featured INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS versions (
      id TEXT PRIMARY KEY, invention_id TEXT NOT NULL, parent_version_id TEXT, iteration INTEGER NOT NULL, prompt TEXT NOT NULL,
      spec_json TEXT NOT NULL, manifest_key TEXT NOT NULL, metrics_json TEXT NOT NULL, model_id TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS versions_invention ON versions(invention_id, iteration);
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, invention_id TEXT NOT NULL, version_id TEXT, status TEXT NOT NULL, step TEXT NOT NULL DEFAULT '',
      progress_json TEXT NOT NULL DEFAULT '[]', error_code TEXT, baseline_version_id TEXT, change_request TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS gallery_assets (id TEXT PRIMARY KEY, version_id TEXT NOT NULL, kind TEXT NOT NULL, key TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS remixes (id TEXT PRIMARY KEY, source_version_id TEXT NOT NULL, derived_invention_id TEXT NOT NULL, change_request TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, invention_id TEXT NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL);
  `);
  const jobColumns = new Set(db.prepare('PRAGMA table_info(jobs)').all().map(({ name }) => name));
  if (!jobColumns.has('baseline_version_id')) db.exec('ALTER TABLE jobs ADD COLUMN baseline_version_id TEXT');
  if (!jobColumns.has('change_request')) db.exec('ALTER TABLE jobs ADD COLUMN change_request TEXT');
  return db;
}
