#!/usr/bin/env node
// Import a freely licensed 3D model from Wikimedia Commons into the third-party parts library.
//
//   node scripts/import-wikimedia.ts "File:Some model.stl" [--id slug] [--dry-run] [--max-mb 10]
//
// Looks the file up with the Commons API, checks its license against the allowed list
// (CC0 / CC BY / CC BY-SA / public domain), downloads STL/GLB/OBJ files into
// packages/parts/assets/external/<id>.<ext> and writes <id>.json next to it with full attribution.
// The resulting part is decorative: it carries no mass, connectors or collision data until those
// are added by hand (docs/third-party-parts.md).
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ExternalAsset, ALLOWED_LICENSES, SHARE_ALIKE_LICENSES, type AllowedLicense, type MeshFormat } from '../packages/parts/src/external/manifest.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ASSET_DIR = resolve(REPO_ROOT, 'packages/parts/assets/external');
const API = 'https://commons.wikimedia.org/w/api.php';
const USER_AGENT = 'ProtoLab-import-wikimedia/0.1 (https://github.com/seandmccue/proto-lab; third-party parts importer) node-fetch';

/** Commons LicenseShortName → our SPDX-ish identifiers. Anything missing here is rejected. */
const LICENSE_MAP: Record<string, AllowedLicense> = {
  'cc0': 'CC0-1.0', 'cc0 1.0': 'CC0-1.0', 'cc0-1.0': 'CC0-1.0',
  'cc by 4.0': 'CC-BY-4.0', 'cc-by-4.0': 'CC-BY-4.0',
  'cc by-sa 4.0': 'CC-BY-SA-4.0', 'cc-by-sa-4.0': 'CC-BY-SA-4.0',
  'cc by 3.0': 'CC-BY-3.0', 'cc-by-3.0': 'CC-BY-3.0',
  'cc by-sa 3.0': 'CC-BY-SA-3.0', 'cc-by-sa-3.0': 'CC-BY-SA-3.0',
  'public domain': 'PD', 'pd': 'PD',
};
const FORMAT_BY_EXT: Record<string, MeshFormat> = { stl: 'stl', glb: 'glb', obj: 'obj' }; // gltf needs sidecar files; not auto-imported

interface ImageInfo { url: string; descriptionurl: string; mime: string; size: number; extmetadata?: Record<string, { value: string }> }

function stripHtml(s: string): string { return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(); }
function slugify(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^\x00-\x7f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64).replace(/-+$/g, '');
}
function parseArgs(argv: string[]) {
  const out = { title: '', id: '', dryRun: false, maxMb: 10 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--id') out.id = argv[++i] ?? '';
    else if (a === '--max-mb') out.maxMb = Number(argv[++i]);
    else if (!out.title) out.title = a;
    else throw new Error(`Unexpected argument: ${a}`);
  }
  if (!out.title) throw new Error('Usage: node scripts/import-wikimedia.ts "File:Name.stl" [--id slug] [--dry-run] [--max-mb N]');
  if (!/^File:/i.test(out.title)) out.title = `File:${out.title}`;
  return out;
}

async function apiGet(params: Record<string, string>): Promise<any> {
  const url = new URL(API);
  for (const [k, v] of Object.entries({ format: 'json', ...params })) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Commons API ${res.status} ${res.statusText}`);
  return res.json();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`Looking up ${args.title} on Wikimedia Commons…`);
  const data = await apiGet({ action: 'query', prop: 'imageinfo', iiprop: 'url|extmetadata|mime|size', titles: args.title });
  const page = Object.values(data.query?.pages ?? {})[0] as any;
  if (!page || page.missing !== undefined || !page.imageinfo?.[0]) {
    console.error(`REJECTED: ${args.title} was not found on Commons.`); process.exit(2);
  }
  const info: ImageInfo = page.imageinfo[0];
  info.url = info.url.replace(/\?utm_[^#]*$/, ""); // drop Commons tracking params
  const meta = info.extmetadata ?? {};
  const get = (k: string) => stripHtml(meta[k]?.value ?? '');
  const licenseShort = get('LicenseShortName');
  const artist = get('Artist') || get('Credit') || 'Unknown';
  const credit = get('Credit');
  const licenseUrl = get('LicenseUrl');
  const objectName = get('ObjectName') || page.title.replace(/^File:/, '').replace(/\.[^.]+$/, '');
  const ext = (page.title.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase();
  const format = FORMAT_BY_EXT[ext];

  console.log(`  title:    ${page.title}`);
  console.log(`  mime:     ${info.mime}  size: ${(info.size / 1e6).toFixed(2)} MB`);
  console.log(`  license:  ${licenseShort || '(none)'}  ${licenseUrl}`);
  console.log(`  artist:   ${artist}`);
  if (credit && credit !== artist) console.log(`  credit:   ${credit}`);

  const license = LICENSE_MAP[licenseShort.toLowerCase()];
  if (!license) {
    console.error(`\nREJECTED: license "${licenseShort || 'unknown'}" is not in the allowed list (${ALLOWED_LICENSES.join(', ')}).`);
    console.error('Only CC0, CC BY, CC BY-SA and public-domain files may enter the parts library.');
    process.exit(3);
  }
  if (!format) {
    console.error(`\nREJECTED: ".${ext}" is not an importable mesh format (stl, glb, obj).`); process.exit(4);
  }
  if (info.size > args.maxMb * 1e6) {
    console.error(`\nREJECTED: ${(info.size / 1e6).toFixed(1)} MB exceeds --max-mb ${args.maxMb}.`); process.exit(5);
  }

  const id = args.id || slugify(objectName) || slugify(page.title.replace(/^File:/, ''));
  const shareAlike = SHARE_ALIKE_LICENSES.has(license);
  const attribution = license === 'CC0-1.0' || license === 'PD'
    ? `"${objectName}" by ${artist}, ${license === 'PD' ? 'public domain' : 'CC0 1.0'}, via Wikimedia Commons`
    : `"${objectName}" by ${artist}, ${licenseShort} (${licenseUrl}), via Wikimedia Commons`;
  const localPath = relative(REPO_ROOT, resolve(ASSET_DIR, `${id}.${ext}`));
  const asset = ExternalAsset.parse({
    id, title: objectName, sourceUrl: info.descriptionurl, fileUrl: info.url, creator: artist, license, attribution, shareAlike,
    format, decorative: true, localPath, licenseUrl: licenseUrl || undefined, importedAt: new Date().toISOString(),
  });

  if (args.dryRun) {
    console.log('\nDRY RUN — would write manifest:'); console.log(JSON.stringify(asset, null, 2)); return;
  }

  console.log(`\nDownloading ${info.url}`);
  const res = await fetch(info.url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  mkdirSync(ASSET_DIR, { recursive: true });
  const meshPath = resolve(REPO_ROOT, localPath);
  const manifestPath = resolve(ASSET_DIR, `${id}.json`);
  if (existsSync(manifestPath)) console.log(`  (overwriting existing manifest ${relative(REPO_ROOT, manifestPath)})`);
  writeFileSync(meshPath, bytes);
  writeFileSync(manifestPath, JSON.stringify(asset, null, 2) + '\n');

  console.log(`\nImported ${id}`);
  console.log(`  mesh:        ${localPath} (${(bytes.length / 1e6).toFixed(2)} MB, ${format})`);
  console.log(`  manifest:    ${relative(REPO_ROOT, manifestPath)}`);
  console.log(`  license:     ${license}${shareAlike ? ' (share-alike: derivatives must carry the same license)' : ''}`);
  console.log(`  attribution: ${attribution}`);
  console.log('  decorative:  true — add mass_kg, dimensions_m, connectors and collision geometry under "engineering" and set decorative:false to make it a component.');
}

main().catch((err) => { console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`); process.exit(1); });
