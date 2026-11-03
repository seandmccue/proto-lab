# Third-party parts library

ProtoLab's catalog is parametric: every built-in part is generated from numbers (length, radius,
teeth…) and carries mass, dimensions, connectors and limits the simulator can use. Real inventions
also want *found* geometry — a scanned gear, a bracket from an open hardware project, a propeller
somebody published. This pipeline brings such meshes in **with their provenance attached** and
keeps them from being mistaken for engineered components.

## Pieces

| Where | What |
| --- | --- |
| `packages/parts/src/external/manifest.ts` | `ExternalAsset` zod schema, `toPartDefinition(asset)`, `loadExternalCatalog(dir)` |
| `packages/parts/assets/external/<id>.json` | One manifest per asset (committed) |
| `packages/parts/assets/external/<id>.stl\|glb\|obj` | The mesh itself (committed when small; keep under a few MB) |
| `scripts/import-wikimedia.ts` | CLI that fetches a file from Wikimedia Commons, checks its license and writes the two files above |
| `packages/parts/src/external.test.ts` | Tests for the schema, conversion, loader and the shipped manifests |

### Manifest (`ExternalAsset`)

```jsonc
{
  "id": "apollo11-hatch-spur-gear-41t",        // slug; file stem of the mesh and manifest
  "title": "N=41, P=28 - Spur Gear v11 (…)",
  "sourceUrl": "https://commons.wikimedia.org/wiki/File:…",   // page to link in credits
  "fileUrl": "https://upload.wikimedia.org/…/….stl",           // direct download (also the part's meshUrl)
  "creator": "Transferred from the NASA-Johnson Space Center Smithsonian Institution",
  "license": "CC0-1.0",                       // one of CC0-1.0 CC-BY-4.0 CC-BY-SA-4.0 CC-BY-3.0 CC-BY-SA-3.0 PD
  "attribution": "\"…\" by …, CC0 1.0, via Wikimedia Commons",  // ready-to-display line
  "shareAlike": false,
  "format": "stl",                            // glb | gltf | stl | obj
  "decorative": true,                         // default; see "Decorative is not engineered"
  "localPath": "packages/parts/assets/external/apollo11-hatch-spur-gear-41t.stl",
  "licenseUrl": "http://creativecommons.org/publicdomain/zero/1.0/deed.en",
  "importedAt": "2026-11-03T02:46:21.236Z"
  // "engineering": { mass_kg, dimensions_m, connectors, geometry, category?, material? }  ← optional
}
```

`toPartDefinition` turns a manifest into a `PartDefinition` (`packages/schema`):

* **Decorative** (no `engineering`, or `decorative: true`): `id: ext-<id>`, `kind: external`,
  `category: misc`, a single `box` piece sized from `engineering.dimensions_m` if given, otherwise
  a 5 cm cube, with `collide: false` and `role: decor`; **no connectors**; a nominal 1 g mass
  (the schema requires a positive mass; the value is a placeholder, never a measurement);
  `decorative: true`; `meshUrl` = `fileUrl`; `source` = `{ kind: 'external', license, creator,
  url: sourceUrl, attribution, shareAlike }`.
* **Engineered** (`engineering` present and `decorative: false`): the manifest's mass, dimensions,
  connectors, collision proxies, category and material are used verbatim and the part behaves like
  any catalog part. The mesh is still only the visual; the simulator sees the proxies.

`loadExternalCatalog(dir = packages/parts/assets/external)` reads every `*.json` in the directory,
validates each one (an invalid manifest throws rather than being skipped, so a bad license cannot
slip in silently) and returns the PartDefinitions. It is not merged into `catalog()` yet; the
agent's `search_catalog` tool only sees parametric parts until the UI can render `meshUrl`.

### Importer

```bash
node scripts/import-wikimedia.ts "File:Lock Bracket v4 (Hatch, Crew, Apollo 11 by NASA and Smithsonian Institution).stl" \
     --id apollo11-hatch-lock-bracket        # optional slug; default is derived from the title
     [--dry-run] [--max-mb 10]
```

1. Queries `https://commons.wikimedia.org/w/api.php?action=query&prop=imageinfo&iiprop=url|extmetadata|mime|size`
   with a descriptive `User-Agent` (Commons rejects anonymous clients).
2. Reads `LicenseShortName`, `LicenseUrl`, `Artist`, `Credit` and `ObjectName` from `extmetadata`.
3. **Rejects** (exit code 3, reason printed) any file whose `LicenseShortName` does not map to the
   allowed list. Commons hosts "Copyrighted free use", GFDL-only, fair-use and attribution-only
   custom licenses; none of those are accepted. Also rejects non-mesh extensions (exit 4) and
   files over `--max-mb` (exit 5). `.gltf` is not auto-imported because it needs sidecar files.
4. Downloads the mesh to `packages/parts/assets/external/<id>.<ext>` (tracking query parameters
   stripped from the URL) and writes `<id>.json` with `decorative: true`.
5. Prints a summary with the attribution line and a reminder that the part is decorative.

Finding candidates: `action=query&list=search&srnamespace=6&srsearch=stl gear` lists files; the
importer does the license check, so it is fine to try a title and let it refuse.

### Imported so far

| id | What | License | Source |
| --- | --- | --- | --- |
| `apollo11-hatch-spur-gear-41t` | 41-tooth spur gear from the Smithsonian's Apollo 11 crew hatch scan (0.08 MB STL) | CC0-1.0 | NASA-JSC / Smithsonian Institution via Wikimedia Commons |
| `apollo11-hatch-lock-bracket` | Lock bracket from the same hatch (0.05 MB STL) | CC0-1.0 | NASA-JSC / Smithsonian Institution via Wikimedia Commons |

Both are decorative. The `creator` strings are copied from the Commons `Artist` field verbatim.

## License policy

Only these licenses may enter the library; the importer and the schema both enforce the list.

| License | Accepted | Obligations in ProtoLab |
| --- | --- | --- |
| **CC0-1.0**, **PD** (public domain) | preferred | None. We still record creator and source because it is good practice and it lets users verify the file. |
| **CC-BY-4.0**, **CC-BY-3.0** | yes | **Attribution must be shown** wherever the part appears: the BOM (`BomLine.source.attribution`), the invention's credits panel, and any export (STEP/STL/GLB bundle, share page). Keep the `attribution` string and `sourceUrl` intact. |
| **CC-BY-SA-4.0**, **CC-BY-SA-3.0** | yes, flagged | Attribution as above **plus share-alike**: a derivative of the mesh (edited geometry, a part that incorporates it) must be released under the same license. `source.shareAlike: true` is set on the part so the UI can warn before a user publishes an invention containing it under a different license. Using the mesh unmodified in an assembly is distribution of the work, not a derivative; still show the attribution and keep the license notice. |
| Anything else (NC, ND, GFDL-only, "free use", custom) | **no** | Rejected at import. Do not hand-edit a manifest to work around this. |

Attribution should be displayed, not buried: a CC BY credit in a JSON file nobody opens does not
satisfy the license. The BOM already carries `source` per line, so the first UI step is rendering
`source.attribution` (and a share-alike badge) there and in the gallery credits.

## Decorative is not engineered

A mesh is a picture of a part, not a part. It has no mass, no material, no mounting points and no
load rating, and a triangle soup cannot be used as a collider in Rapier without a convex
decomposition. So every imported asset starts as **decorative**:

* `decorative: true`, `connectors: []`, one non-colliding bounding box, placeholder mass.
* The agent may place it as decor (`role: decor`) but **cannot mount structure to it, drive it
  with a motor, or count on it in a test**. The planner's "may not be mounted as structure" rule
  on `PartDefinition.decorative` applies.

To promote an asset to a component, a human adds an `engineering` block to the manifest and sets
`decorative: false`:

```jsonc
"decorative": false,
"engineering": {
  "mass_kg": 0.018,                       // weighed or computed from volume × density
  "dimensions_m": [0.041, 0.041, 0.006],  // measured bounding box
  "category": "gears", "material": "aluminium",
  "geometry": [ { "shape": { "kind": "cylinder", "radius": 0.0205, "height": 0.006, "axis": "z" },
                  "offset": { "position": [0,0,0], "rotation": [0,0,0,1] }, "role": "structure", "collide": true } ],
  "connectors": [ { "id": "bore", "position": [0,0,0], "axis": [0,0,1], "kind": "revolute" } ]
}
```

The collision `geometry` is a set of primitives (box, cylinder, sphere, capsule, ellipsoid,
extrude, revolve) that approximate the mesh for the simulator; the mesh stays the visual.
Numbers must come from measurement of the actual file (mesh bounds, volume) or from the source
documentation, never guessed from the name. Until that is done the part stays in `misc`, and
`external.test.ts` asserts that every shipped manifest without engineering data is decorative.
