# ProtoLab

AI-powered invention studio. Describe an invention, watch an engineering agent assemble it from
real catalog parts, test it in a rigid-body physics simulator, revise it from the measured results,
explore it in 3D, publish it, and remix it.

Featured examples: a walking Muse robot, a mechanical butterfly, a miniature Ferris wheel, a pizza
catapult and a sideways-scuttling crab (three failed tests, a Muse Wonder diagnosis, then 0.32 m at 4.7°
tilt), all built live by Muse from the same component library and assembly operations.

Live: **https://protolab.sean-abc.workers.dev** (Meta Muse via the Meta Model API, builds run on the
server; `npm run preflight -- --api <url> --web <url>` checks it the way a judge would).

One-page pitch for judges: [docs/pitch.md](docs/pitch.md). Demo walkthrough: [docs/demo-script.md](docs/demo-script.md). Submission text: [docs/submission.md](docs/submission.md).

## Quick start

```bash
npm install
cp .env.example .env     # add MODEL_API_KEY from dev.meta.ai to use Meta Muse
npm run dev              # API on http://localhost:8787, web on http://localhost:5173
```

On first boot the API seeds four featured gallery items (Muse walker, butterfly, Ferris wheel, pizza
catapult) by running the real agent through the Meta Model API; each takes a few minutes, and the
workbench shows the assembly taking shape while it runs. Nothing in the gallery is canned: every card
opens the actual assembly and simulation trace.

## What is real

- **Components** come from a 100-part library built by 36 parametric generators (frames, plates,
  beams, rods, brackets, enclosures, curved panels, gears with real teeth, shafts, bearings, wheels,
  spoked wheels, pulleys, flywheels, hinges, sliders, linkages, cranks, pistons, servos, gearmotors,
  springs, actuators, shaped left/right wings, winged bodies with built-in flap hinges, propellers,
  gripper fingers, gondolas, tracks, payloads, trays),
  plus two CC0 scanned parts from Wikimedia Commons with attribution. Each has mass, dimensions,
  material, connectors (position, axis, kind) and limits.
- **Autonomous part generation:** the model can create parametric parts with custom parameters, or
  design a part from primitives, 2D profiles extruded along an axis, and revolved profiles. The
  geometry engine validates ranges, computes mass from material density, and builds convex-hull
  colliders. The model never emits code, only validated JSON. See [docs/geometry-engine.md](docs/geometry-engine.md)
  for the CadQuery investigation.
- **Assembly** is a versioned JSON manifest built by generic operations: place, mount at a connector
  (the child is posed so connectors coincide), connect, mirror/polar/linear patterns, remove, move.
  There is no builder per invention. The walking robot is built from the same operations.
- **Simulation** is Rapier (WASM) at a fixed 1/240 s step with anchored bases, free projectiles and
  payloads, revolute/prismatic/spring joints, position and velocity drives, motor saturation at the
  catalog rating, and collision events for clearance and ground contact. Tests: motion (amplitude,
  rate, revolutions, tilt, drift, clearance, upright parts, payload lift and retention), walk, launch,
  grip. Runs are deterministic.
- **The agent's procedure** is the ten-step plan: understand → features and motions → sub-assemblies
  (write_plan) → search the library → design missing parts → assemble and set drives → define
  measurable tests → simulate → analyse failures and revise → finalize with the behaviours the
  physics cannot verify listed as "unverified". Every version records which model made each decision.
- **Watching a build** is part of the product: before the first assembly the workbench shows the
  stage stepper (plan → parts → assemble → test → revise), the current step with a reasoning timer,
  and a parts bin where every part Muse finds or designs slides in as a thumbnail; the first assembly
  drops in one part at a time; after that a build strip, pass/fail toasts for each test and an
  iteration ribbon (v1 ✗ 0.12 m → v2 ✓ 0.47 m) keep the one-to-three-minute wait legible.
- **Comparing revisions:** request a change from a saved version. Owners can continue the original
  invention, and gallery visitors can start their own remix. The workbench keeps the baseline and
  pairs comparable measurements with the changed parts and the recorded revision.
- **Not simulated:** aerodynamics, fluids, deformation, fatigue, manufacturability. A butterfly's
  wings flap with measured stroke and rate; nobody claims it flies.

`npm run preflight` checks the running stack the way a judge would see it: model live, featured builds
passed, gallery and web serving.

Production: `npm run build` then `npm start` serves the built web app and the API from one process on
port 8787 (the Dockerfile does the same; `WEB_DIST` overrides the bundle path).

## Model configuration (Meta Model API)

ProtoLab's engineering agent runs on Meta's Muse models through the
[Meta Model API](https://dev.meta.ai/docs/overview): OpenAI-compatible chat completions with
tool calling at `https://api.meta.ai/v1`. Set in `.env` (server-side only; the key never reaches
the browser):

```
MODEL_API_BASE=https://api.meta.ai/v1
MODEL_ID=muse-spark-1.3          # or muse-spark-1.1, muse-wonder-1.0, ...
MODEL_API_KEY=<key from dev.meta.ai>
```

At startup the API runs a live tool-call smoke test and logs the result. The header badge and
every version record show the exact model id, and the activity log opens with a line naming the
model. If the model returns an error, the job reports it verbatim; ProtoLab never substitutes
another model silently. Only when no key is configured does the deterministic planner run, and
the UI labels it as such. Note: the Meta Model API accepts only `tool_choice: "auto"`.

## Two Muse models collaborating

Muse Spark 1.3 is the inventor. If three walk tests in a row fail, ProtoLab says "This design
needs a little more engineering. Bringing in Muse Wonder to help." Muse Wonder 1.0 reads the same
transcript, diagnoses the mechanical problem, applies one targeted change and runs a test, then
Spark resumes. The handoff is shown in the activity log and every version records which model made
its decision. Configure with `MODEL_SPECIALIST_ID` (empty disables) and `MODEL_SPECIALIST_AFTER`.
The build deadline (`AGENT_TIME_BUDGET_S`, default 20 min) cancels pending model calls and retry delays.
Completed simulation traces remain available when a build stops before Muse finishes its review.
New builds run up to `JOB_CONCURRENCY` at a time and accept up to `JOB_MAX_QUEUED` waiting builds.

## Generalization benchmark

`node packages/agent/src/bench.ts --general` runs ten inventions through the same engine: butterfly,
Ferris wheel, Muse walker, pizza catapult, crab, grabbing claw, windmill, drawbridge, crane and a novel
garden gadget. Latest full pass on the current engine: **10 of 10, median 96 s, 0 API errors, no
specialist escalation, nine of ten first-try** (windmill 16 s, butterfly 38 s, Ferris wheel 48 s, walker
81 s at 0.51 m, crane 87 s, catapult 96 s, crab 115 s at 0.39 m, drawbridge 122 s, garden gadget 128 s,
claw 183 s). A second full pass (v11) went 10 of 10 at median 102 s, and a third on the integration branch that carries the deployed UI (v12) went 10 of 10 at median 61 s with no specialist consults. Across twelve passes that is 112 of 120 runs, every miss traced to a measurable cause and
written into a recipe or an engine rule with a locking test (a direction-only
walk test, two Wonder 503s now handled by a visible fallback, a missing hexapod recipe, a drawbridge that
researched a linkage until its time budget ran out); details and per-run tables in
[docs/benchmark-general.md](docs/benchmark-general.md).
With the component index in the prompt the fast prompts finish in under 100 s (windmill 54 s, Ferris
wheel 74 s, butterfly 92 s); the rest run 3–10 min, dominated by Meta Model API round-trips.

## Reliability benchmark

`node packages/agent/src/bench.ts --repeats 4 --concurrency 4` runs five prompts four times each
through the real models and writes `bench-results/summary.md`. Latest run on the universal engine (see
[docs/benchmark.md](docs/benchmark.md)): 20 runs, **20 of 20 passed**, 0 API errors, median 81 s,
40 % of runs made a revision citing a measured result, 40 % failed a walk test and later passed one,
15 % escalated to Muse Wonder (the pass before: 18 of 20 at 167 s, both misses traced and fixed with
a measured speed note and a never-re-run-a-passed-test rule). The run before the empty-assistant-message fix is kept in
[docs/benchmark-run1-before-fix.md](docs/benchmark-run1-before-fix.md) for honesty.

## Layout

```
apps/web            React + Vite + React Three Fiber + Tailwind
apps/api            Hono on Node, node:sqlite metadata, local object store (R2 stand-in), job runner
packages/schema     zod schemas: parts, connectors, instances, joints, controllers, specs, tests, versions
packages/parts      parametric generators, curated catalog, legged-walker family builder
packages/simulator  deterministic Rapier harness: walk + dance tests, metrics, 30 Hz trace
packages/agent      model tool-call loop, validated tool runtime, deterministic planner, revision loop
```

## Scripts

```bash
npm run dev          # both servers
npm run typecheck    # all workspaces
npm test             # schema/parts/simulator/agent tests (node --test)
node packages/agent/src/cli.ts "Build a six-legged walking robot and make it dance."
```

## API

`POST /api/inventions` · `GET /api/jobs/:id` · `GET /api/inventions/:id` ·
`GET /api/inventions/:id/versions/:vid[?trace=0]` · `POST /api/inventions/:id/remix` ·
`POST /api/inventions/:id/follow-up` · `POST /api/inventions/:id/publish` ·
`POST /api/inventions/:id/preview` · `GET /api/gallery?sort=recent|featured|remixes` ·
`GET /api/parts` · `POST /api/reports` · `GET /api/model`

Ownership is an anonymous session id (`x-session-id`); publishing and follow-ups require it.
Remix and follow-up accept an optional `versionId` for the saved starting point. New job
responses include timing from request to plan, assembly and first test, plus cumulative model
time and API-reported token totals when available.
Rate limits, idempotency keys, input sanitisation and size limits are in place for the POC.

## Deploying to Cloudflare

ProtoLab runs as a single Cloudflare Container behind a Worker. Node runs the existing SQLite,
object store, Rapier, and worker-thread jobs. A private R2 bucket holds a compressed SQLite and
object-store checkpoint. Every successful mutation and recorded build version is checkpointed.
The container restores that archive and checks SQLite integrity before serving. The R2 import copy
is kept separately for recovery. See the [deployment and restore instructions](deploy/cloudflare/README.md).
