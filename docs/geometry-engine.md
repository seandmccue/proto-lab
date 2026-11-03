# Geometry engine: built-in TypeScript vs a CadQuery sidecar

*Investigation for "autonomous part generation" — can the agent make parts that are not in the
catalog, and what should produce their geometry?* Written 2026-11-02 on branch
`feat/universal-engine`.

## TL;DR

* Keep the **TypeScript engine** (`packages/parts/src/geometry.ts`) as the live path. It runs
  everywhere we run (Node API, browser, Workers), is instant, and already covers the shapes the
  agent needs for simulation: profiles → extrusions and revolves, capsules, ellipsoids, convex
  colliders, volumes for mass.
* Add a **CadQuery/OpenCascade sidecar later**, as a separate container service, for the things a
  primitive engine cannot do: boolean cuts (real holes and pockets), fillets/chamfers on 3D edges,
  and manufacturable **STEP** export. The model never writes code for it; it emits a validated JSON
  part spec and the sidecar turns that into geometry.
* `python3 -c "import cadquery"` **fails on this machine** (Homebrew Python 3.14.6 and Apple
  Python 3.9.6, no cadquery / cadquery-ocp / build123d installed; nothing was pip-installed).
  Everything below about CadQuery is from its documentation and prior use, not measured here.

## What CadQuery offers

CadQuery is a Python API over OpenCascade (OCCT), the open-source B-rep kernel behind FreeCAD.

* **B-rep solids**, not meshes: exact faces, edges and vertices; dimensions are exact until export.
* **Sketch → extrude / revolve / sweep / loft** on workplanes; chained selectors
  (`.faces(">Z").workplane()`) to build on existing faces.
* **Booleans**: union, cut, intersect — the operation a mesh engine lacks. Holes are cuts:
  `.hole(d)`, `.cboreHole()`, `.cskHole()`, with `.rect(...)`/`.polarArray(...)` for patterns.
* **Fillets and chamfers** on selected 3D edges (`.edges("|Z").fillet(r)`), shells, drafts.
* **Mass properties** from the kernel (volume, centroid, inertia tensor via `GProp`), so mass and
  inertia come from the real solid rather than a primitive approximation.
* **Export**: STEP (manufacturers, FreeCAD, Fusion, Onshape), STL/3MF/AMF (printing), glTF via the
  Assembly API (viewer), SVG/DXF (drawings). Import of STEP too, which matters for third-party
  CAD parts (see `docs/third-party-parts.md`).
* Deterministic: the same script gives the same solid, which fits our versioned-assembly story.

## Runtime requirements (why it is a sidecar, not a dependency)

* Python 3 plus the `cadquery` wheel, which pulls `cadquery-ocp` (OCCT compiled with pybind11)
  and VTK. The download is on the order of 100–200 MB and the installed footprint several hundred
  MB; OCCT itself is a large native C++ library. Wheels track specific Python versions, and new
  Python releases (3.14 today) typically lag.
* **Cannot run in a browser or a Cloudflare Worker.** It is native code with no WASM build;
  Workers have a ~10 MB bundle limit and no Python/native runtime. The only in-browser OCCT is
  `opencascade.js` (used by *replicad*), a ~30 MB WASM blob with multi-second startup — workable for
  a desktop CAD tab, not for our Worker API or a phone.
* So: a **container** (FastAPI or similar, `python:3.12-slim` + `pip install cadquery`, ~1 GB
  image) on Fly.io / Cloud Run / a VM, called by the Hono API over HTTP. It must be sandboxed
  (no network egress, CPU/memory limits, request timeout) because OCCT can hang or blow memory on
  degenerate input.

### Latency expectations (not measured here; typical from the docs and experience)

| Step | Expected |
| --- | --- |
| Container cold start + `import cadquery` | 2–6 s (keep a warm instance) |
| Sketch + extrude/revolve, a few holes | 10–100 ms |
| Fillet/chamfer on dozens of edges | 50 ms – 2 s; can fail (OCCT fillets are the classic failure point) |
| Boolean cut with patterns (e.g. 20-hole grid) | 50 ms – 1 s |
| Tessellate to glTF/STL | 10–200 ms depending on tolerance |
| STEP write | 20 ms – 1 s |
| HTTP round trip API → sidecar → blob store | 50–300 ms |

Net: roughly **0.2–3 s per part** when warm. Fine for an agent loop that already spends seconds
per simulation; not fine for interactive slider dragging, which stays on the TS engine.

## The built-in TypeScript engine today

`packages/parts/src/geometry.ts` (schema in `packages/schema/src/index.ts`, `Shape`):

* Primitives: `box`, `cylinder`, `sphere`, **`capsule`**, **`ellipsoid`**, **`extrude`**
  (closed CCW 2D profile, ≤ 256 points, depth, axis) and **`revolve`** (profile in (r, h), axis,
  segments).
* Profile helpers: `rect`, `roundedRect`, `circle`, `ellipse`, `arcBand` (curved panel section),
  `gear` (spur outline with teeth), `wing` (butterfly / dragonfly / bird / blade), `claw`, `iBeam`,
  `frustum`, `rim`, `dome`; plus `polygonArea`, `profileCentroid`, `profileBounds`, `ensureCCW`.
* `shapeVolume` for every shape (Pappus for revolves) → mass = volume × density;
  `shapeHalfExtents` for bounds; `hullPoints` samples extrude / revolve / ellipsoid surfaces for a
  **convex-hull collider**; `piecesBoundingRadius` for layout checks.
* Rendering: box/cylinder/sphere are live in `apps/web/src/components/Viewer.tsx`; the intended
  mapping for the new shapes is three.js `ExtrudeGeometry` (profile → `THREE.Shape`),
  `LatheGeometry` (revolve), `CapsuleGeometry`, scaled `SphereGeometry` (ellipsoid). Colliders:
  Rapier `cuboid`/`ball`/`cylinder` are live in `packages/simulator`; the new shapes map to
  `ColliderDesc.convexHull(hullPoints(shape))` and `capsule`. That wiring is what this branch is
  completing — the engine functions exist, the viewer and simulator cases are not all switched on
  yet.

What it cannot do, and why that is acceptable for now:

* **No booleans.** A hole can be drawn into an extrude profile as a notch, and a bore can be left
  out of a revolve profile, but a through-hole in the middle of a plate needs either a second,
  non-colliding "hole" piece for visuals or a profile with an inner loop (not supported: profiles
  are simple polygons). The simulator would not care — colliders are convex hulls anyway.
* **Convex colliders only.** A gear's hull is a disc; a C-shaped bracket's hull fills the gap. Fine
  for walkers and launchers; wrong for anything that relies on a concavity (a hook catching a bar).
  Mitigation: compose concave parts from several convex pieces, as the generators already do.
* **No 3D fillets**, only rounded 2D profiles. Visual only; no simulation impact.
* **No STEP export.** We can export STL/glTF from the three.js meshes, which is enough for
  printing a prototype but not for a machinist.
* Everything is **sampled**: a revolve is a polygon of N segments, a circle is 24 points. Good
  enough at the 5 cm – 1 m scale ProtoLab works in.

## Recommended integration

```
model ──(tool call: create_part spec JSON)──▶ API validates with zod ──▶ TS engine (now)
                                                        │
                                                        └──(later, when spec uses cut/fillet/step)──▶ CadQuery sidecar
                                                                 │  returns glb + step + {volume, centroid, inertia, bbox}
                                                                 ▼
                                              PartDefinition { geometry: convex proxies, meshUrl: glb, source: designed }
```

Rules that keep it safe and honest:

1. **The model emits data, never code.** The `create_parametric_part` tool already takes numbers.
   A `create_designed_part` tool takes the JSON spec below, validated by zod before anything runs.
   No Python strings, no `eval`, no CadQuery snippets from the model — the sidecar exposes one
   endpoint that only understands the spec.
2. The sidecar is **stateless and idempotent**: same spec → same solid → same content hash for
   the glb/step objects; cache by hash.
3. **Both engines consume the same spec.** The TS engine implements the subset it can (sketch,
   extrude, revolve, pattern of pieces) and ignores or approximates `cut`/`fillet`; the sidecar
   implements all of it. A part made by the sidecar still carries convex `geometry` proxies for
   Rapier, computed by the TS engine from the same sketch, and the kernel's mass properties
   override the volume×density estimate.
4. Failures are reported as test-style results ("fillet r=3 mm failed on edge set X"), and the
   agent revises the spec, exactly as it revises on simulation metrics today.
5. Attribution: sidecar-made parts are `source.kind = 'designed'`, creator = the model id; the
   STEP file carries the same provenance in its header.

### JSON part spec (draft)

```jsonc
{
  "name": "Motor mount plate",
  "units": "m",
  "material": "aluminium",
  "sketch": {                                   // closed 2D profile on the XY plane
    "outline": { "kind": "roundedRect", "w": 0.06, "h": 0.04, "r": 0.004 },   // or "polygon": [[x,y],…], "circle", "gear", …
    "holes": [                                  // inner loops; TS engine: visual-only notch / ignored; sidecar: real cut
      { "kind": "circle", "at": [0, 0], "d": 0.012 },
      { "kind": "pattern", "shape": "circle", "d": 0.0032, "layout": "rect", "nx": 2, "ny": 2, "dx": 0.031, "dy": 0.031 },
      { "kind": "pattern", "shape": "circle", "d": 0.003, "layout": "polar", "n": 6, "radius": 0.015 }
    ]
  },
  "body": { "kind": "extrude", "depth": 0.004, "axis": "z" },   // or { "kind": "revolve", "axis": "y", "angle_deg": 360 }
  "features": [                                 // applied in order; sidecar only (TS engine ignores with a note)
    { "kind": "fillet", "edges": "|Z", "r": 0.001 },
    { "kind": "chamfer", "edges": ">Z", "d": 0.0005 },
    { "kind": "cut", "shape": { "kind": "box", "size": [0.02, 0.01, 0.004] }, "at": [0.015, 0, 0] },
    { "kind": "holePattern", "face": ">Z", "d": 0.0032, "layout": "rect", "nx": 2, "ny": 2, "dx": 0.031, "dy": 0.031, "counterbore": { "d": 0.006, "depth": 0.002 } }
  ],
  "connectors": [                               // declared by the model, in sketch coordinates
    { "id": "shaft", "position": [0, 0, 0.004], "axis": [0, 0, 1], "kind": "revolute" },
    { "id": "mount", "position": [0, 0, 0], "axis": [0, 0, -1], "kind": "fixed" }
  ],
  "export": ["glb", "step"]
}
```

Response from the sidecar: `{ glbUrl, stepUrl, volume_m3, centroid_m, inertia_kg_m2 (given
density), bbox_m, warnings[] }`, which the API folds into a `PartDefinition` with `kind:
'designed'`, `mass_kg = volume × density`, `dimensions_m = bbox`, `geometry` = convex proxies from
the sketch (`hullPoints`) and `meshUrl = glbUrl`.

## Sequence

1. **Now (this branch):** finish wiring extrude/revolve/capsule/ellipsoid into the viewer and the
   simulator; give the agent `create_designed_part` with the `sketch` + `body` + `connectors`
   subset of the spec, backed by the TS engine. Validate `holes` and `features` in the schema but
   mark them "not applied by the live engine" in the tool result so the model is not misled.
2. **Later:** stand up the CadQuery container, route specs that use `holes`/`features`/`step`
   to it, cache by hash, show STEP download in the BOM. Measure the real latencies before
   promising anything in the UI.
3. **Maybe:** replicad / opencascade.js in the browser for a hands-on CAD tab, if users ask for
   it; not for the agent path.
