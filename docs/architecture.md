# ProtoLab architecture

```
apps/web          React + Vite + React Three Fiber. Homepage, workspace (3D replay, tree, BOM, activity, plan, tests), gallery, remix, publish.
apps/api          Hono on Node. SQLite metadata (node:sqlite), local object store for manifests/traces/previews, in-process job runner.
packages/schema   zod schema v2: shapes, parts, connectors, instances, joints (fixed/revolute/prismatic/spring), drives, plan/spec, tests, traces, versions.
packages/parts    geometry engine (profiles, extrusions, revolves, hulls), 35 generators, 100-part catalog, assembly-operations engine, external assets.
packages/simulator Rapier harness: identity-frame rigid groups, anchored/free bodies, motors with saturation, collision events, four test kinds.
packages/agent    Meta Model API client (Muse Spark / Wonder), validated tool runtime, ten-step planning prompt, Wonder escalation, benchmark harness.
```

## The loop
1. `write_plan` — purpose, features, motions, sub-assemblies, criteria, unverified behaviours.
2. `search_catalog` / `get_part` — library parts with connectors (position, axis, kind) and limits.
3. `create_part` (parametric) / `design_part` (primitives + extrude/revolve) — validated, mass from density.
4. `assemble` — place / mount (connector mates) / connect / pattern / remove / move; atomic batches.
5. `set_drives` — position or velocity profiles per motorised joint (constant, sine, ramp, step, gait).
6. `define_test` — motion / walk / launch / grip with measurable criteria.
7. `run_test` — deterministic Rapier run; metrics, failure reasons, notes; a version is recorded.
8. `sweep_drive` — measured exploration without versions.
9. revise (assemble / set_drives / parts) citing a measurement; after 3 failures Muse Wonder takes a turn.
10. `finalize_design` — honest summary + unverified list.

## Honesty boundaries
- Rigid bodies only. No aerodynamics, fluids, deformation, fatigue. Convex-hull colliders for extrusions/revolves (cups are compounds).
- Motor torque/force saturates at the catalog rating; demand above rating is reported.
- Model vs simulator provenance is kept on every event and version; the specialist's decisions are labelled with its model id.
- External meshes are decorative unless engineering data is added by hand (docs/third-party-parts.md).
