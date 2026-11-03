import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { PartDefinition, Connector, GeometryPiece, PartCategory, Vec3 } from '@protolab/schema';

// ============================================================================
// Third-party parts library: manifests for externally sourced meshes (Wikimedia Commons, etc.).
// A manifest records provenance and licensing. By default an imported mesh is *decorative*: it has
// a mesh to look at but no engineering data, so it is not a mechanical component until someone
// adds mass, dimensions, connectors and collision proxies by hand (see docs/third-party-parts.md).
// ============================================================================

/** Licenses the pipeline accepts. Anything else is rejected at import time. */
export const AllowedLicense = z.enum(['CC0-1.0', 'CC-BY-4.0', 'CC-BY-SA-4.0', 'CC-BY-3.0', 'CC-BY-SA-3.0', 'PD']);
export type AllowedLicense = z.infer<typeof AllowedLicense>;
export const ALLOWED_LICENSES = AllowedLicense.options;

/** Licenses whose derivatives must be shared under the same terms. */
export const SHARE_ALIKE_LICENSES: ReadonlySet<string> = new Set(['CC-BY-SA-4.0', 'CC-BY-SA-3.0']);
/** Licenses that require the creator to be credited wherever the part is shown (BOM, credits, exports). */
export const ATTRIBUTION_LICENSES: ReadonlySet<string> = new Set(['CC-BY-4.0', 'CC-BY-3.0', 'CC-BY-SA-4.0', 'CC-BY-SA-3.0']);

export const MeshFormat = z.enum(['glb', 'gltf', 'stl', 'obj']);
export type MeshFormat = z.infer<typeof MeshFormat>;

/** Optional engineering data that promotes a decorative mesh to a real component. */
export const ExternalEngineering = z.object({
  mass_kg: z.number().positive(),
  dimensions_m: Vec3,
  /** Connectors in mesh-local metres. */
  connectors: z.array(Connector),
  /** Collision proxies (primitive shapes) approximating the mesh for the simulator. */
  geometry: z.array(GeometryPiece).min(1),
  category: PartCategory.default('misc'),
  material: z.string().default('unknown'),
  description: z.string().optional(),
});
export type ExternalEngineering = z.infer<typeof ExternalEngineering>;

export const ExternalAsset = z.object({
  /** Stable slug; also the file stem under packages/parts/assets/external/. */
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$/, 'id must be a lowercase slug'),
  title: z.string().min(1),
  /** Page describing the asset (e.g. the Commons file page). */
  sourceUrl: z.string().url(),
  /** Direct download URL of the mesh. */
  fileUrl: z.string().url(),
  creator: z.string().min(1),
  license: AllowedLicense,
  /** Human-readable attribution line to display wherever the part appears. */
  attribution: z.string().min(1),
  shareAlike: z.boolean(),
  format: MeshFormat,
  /** Decorative meshes have no mechanical properties and may not be mounted as structure. */
  decorative: z.boolean().default(true),
  engineering: ExternalEngineering.optional(),
  /** Repo-relative path of the downloaded mesh, when it has been fetched. */
  localPath: z.string().optional(),
  licenseUrl: z.string().url().optional(),
  /** ISO timestamp of the import. */
  importedAt: z.string().optional(),
});
export type ExternalAsset = z.infer<typeof ExternalAsset>;

/** Nominal mass for decorative placeholders (PartDefinition requires mass_kg > 0; decor is never simulated as structure). */
export const DECORATIVE_PLACEHOLDER_MASS_KG = 0.001;
export const DECORATIVE_DEFAULT_SIZE_M = 0.05;

export function licenseInfo(license: AllowedLicense) {
  return { shareAlike: SHARE_ALIKE_LICENSES.has(license), requiresAttribution: ATTRIBUTION_LICENSES.has(license) };
}

/** Convert a validated manifest into a PartDefinition for the catalog / assemblies. */
export function toPartDefinition(input: ExternalAsset): PartDefinition {
  const asset = ExternalAsset.parse(input);
  const source = {
    kind: 'external' as const,
    license: asset.license,
    creator: asset.creator,
    url: asset.sourceUrl,
    attribution: asset.attribution,
    shareAlike: asset.shareAlike || SHARE_ALIKE_LICENSES.has(asset.license),
  };
  const eng = asset.engineering;
  if (eng && !asset.decorative) {
    return PartDefinition.parse({
      id: `ext-${asset.id}`,
      kind: 'external',
      name: asset.title,
      category: eng.category,
      description: eng.description ?? `${asset.title} (external mesh with hand-entered engineering data).`,
      params: {},
      mass_kg: eng.mass_kg,
      dimensions_m: eng.dimensions_m,
      material: eng.material,
      geometry: eng.geometry,
      connectors: eng.connectors,
      source,
      decorative: false,
      meshUrl: asset.fileUrl,
    });
  }
  const dims: Vec3 = eng?.dimensions_m ?? [DECORATIVE_DEFAULT_SIZE_M, DECORATIVE_DEFAULT_SIZE_M, DECORATIVE_DEFAULT_SIZE_M];
  return PartDefinition.parse({
    id: `ext-${asset.id}`,
    kind: 'external',
    name: asset.title,
    category: 'misc',
    description: `${asset.title} — decorative external mesh (${asset.format.toUpperCase()}, ${asset.license}). No engineering data; cannot be mounted as structure.`,
    params: {},
    mass_kg: DECORATIVE_PLACEHOLDER_MASS_KG,
    dimensions_m: dims,
    material: 'unknown',
    geometry: [{ shape: { kind: 'box', size: dims }, role: 'decor', collide: false }],
    connectors: [],
    source,
    decorative: true,
    meshUrl: asset.fileUrl,
  });
}

/** Default manifest directory: packages/parts/assets/external/ */
export const DEFAULT_EXTERNAL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../assets/external');

export interface LoadedExternal { asset: ExternalAsset; part: PartDefinition; manifestPath: string }

/** Read every `*.json` manifest in `dir`, validate it and convert to PartDefinitions. Invalid manifests throw. */
export function loadExternalAssets(dir: string = DEFAULT_EXTERNAL_DIR): LoadedExternal[] {
  if (!existsSync(dir)) return [];
  const out: LoadedExternal[] = [];
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const manifestPath = join(dir, name);
    const raw: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const parsed = ExternalAsset.safeParse(raw);
    if (!parsed.success) throw new Error(`Invalid external manifest ${manifestPath}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    out.push({ asset: parsed.data, part: toPartDefinition(parsed.data), manifestPath });
  }
  return out;
}

export function loadExternalCatalog(dir: string = DEFAULT_EXTERNAL_DIR): PartDefinition[] {
  return loadExternalAssets(dir).map((x) => x.part);
}
