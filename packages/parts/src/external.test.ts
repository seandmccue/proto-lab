import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PartDefinition } from '@protolab/schema';
import { ExternalAsset, toPartDefinition, loadExternalCatalog, loadExternalAssets, DEFAULT_EXTERNAL_DIR } from './external/manifest.ts';

const base = {
  id: 'test-gear', title: 'Test gear', sourceUrl: 'https://commons.wikimedia.org/wiki/File:Test.stl',
  fileUrl: 'https://upload.wikimedia.org/x/Test.stl', creator: 'Someone', license: 'CC-BY-SA-4.0' as const,
  attribution: '"Test gear" by Someone, CC BY-SA 4.0, via Wikimedia Commons', shareAlike: true, format: 'stl' as const,
};

test('decorative manifest becomes a non-colliding misc part with full attribution', () => {
  const part = toPartDefinition(ExternalAsset.parse(base));
  PartDefinition.parse(part);
  assert.equal(part.id, 'ext-test-gear');
  assert.equal(part.category, 'misc');
  assert.equal(part.decorative, true);
  assert.equal(part.connectors.length, 0);
  assert.equal(part.geometry.length, 1);
  assert.equal(part.geometry[0].collide, false);
  assert.deepEqual(part.dimensions_m, [0.05, 0.05, 0.05]);
  assert.equal(part.source.kind, 'external');
  assert.equal(part.source.license, 'CC-BY-SA-4.0');
  assert.equal(part.source.shareAlike, true);
  assert.equal(part.source.attribution, base.attribution);
  assert.equal(part.meshUrl, base.fileUrl);
});

test('engineering data promotes the asset to a real component', () => {
  const part = toPartDefinition({
    ...base, license: 'CC0-1.0', shareAlike: false, decorative: false,
    engineering: {
      mass_kg: 0.02, dimensions_m: [0.04, 0.04, 0.006], category: 'gears', material: 'steel',
      geometry: [{ shape: { kind: 'cylinder', radius: 0.02, height: 0.006, axis: 'z' }, offset: { position: [0, 0, 0], rotation: [0, 0, 0, 1] }, role: 'structure', collide: true }],
      connectors: [{ id: 'bore', position: [0, 0, 0], axis: [0, 0, 1], kind: 'revolute' }],
    },
  });
  assert.equal(part.decorative, false);
  assert.equal(part.category, 'gears');
  assert.equal(part.mass_kg, 0.02);
  assert.equal(part.connectors.length, 1);
  assert.equal(part.geometry[0].collide, true);
});

test('unknown licenses are rejected by the manifest schema', () => {
  assert.throws(() => ExternalAsset.parse({ ...base, license: 'All rights reserved' }));
  assert.throws(() => ExternalAsset.parse({ ...base, id: 'Not A Slug' }));
});

test('loadExternalCatalog reads manifests from a directory and validates them', () => {
  const dir = mkdtempSync(join(tmpdir(), 'protolab-ext-'));
  writeFileSync(join(dir, 'a.json'), JSON.stringify(base));
  assert.equal(loadExternalCatalog(dir).length, 1);
  writeFileSync(join(dir, 'bad.json'), JSON.stringify({ ...base, license: 'proprietary' }));
  assert.throws(() => loadExternalCatalog(dir), /Invalid external manifest/);
});

test('shipped manifests in assets/external are valid and decorative', () => {
  for (const { asset, part } of loadExternalAssets(DEFAULT_EXTERNAL_DIR)) {
    PartDefinition.parse(part);
    assert.ok(asset.attribution.includes('Wikimedia Commons'), asset.id);
    assert.equal(part.decorative, true, `${asset.id} has no engineering data and must stay decorative`);
  }
});
