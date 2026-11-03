# ProtoLab

AI-powered invention studio. Describe an invention, watch an engineering agent assemble it from
real catalog parts, test it in a rigid-body physics simulator, revise it from the measured results,
explore it in 3D, publish it, and remix it.

Hero demo: **Bring My Muse to Life** — a small walking robot built from servos, leg bars and foot
pads, tested for balance and walking, then asked to dance.

## Quick start

```bash
npm install
cp .env.example .env     # add MODEL_API_KEY from dev.meta.ai to use Meta Muse
npm run dev              # API on http://localhost:8787, web on http://localhost:5173
```

On first boot the API seeds three featured gallery items by running the real agent (a few seconds
each). Nothing in the gallery is canned: every card opens the actual assembly and simulation trace.

## What is real and what is bounded

- **Parts** come from a curated parametric catalog (42 presets, 17 generators: chassis, servos,
  leg bars, foot pads, beams, plates, gears, shafts, bearings, wheels, springs, brackets, shells…).
  Each has mass, dimensions, connectors, limits, material and a CC0 source record.
- **Assembly** is a versioned JSON manifest (parts, instances, joints with motors, controller),
  not just a mesh. The bill of materials, blueprint dimensions and the 3D view all derive from it.
- **Simulation** is Rapier (WASM) with a fixed 1/240 s step. Metrics (distance, tilt, drift, falls,
  torque demand vs servo rating, energy proxy) are measured; runs are deterministic. Rigid-body
  simulation is not engineering certification and the UI says so.
- **Agent decisions** are the model's (or the deterministic planner's) and are labelled as such.
  Every revision records which test metric it was based on and what parameters changed.
- **Bounded family:** today the agent designs one mechanism family — legged walkers with 4 or 6
  legs — with a parametric chassis, two servos per leg and a crawl/tripod gait. Other prompts are
  interpreted into that family and the homepage says so.
- **3D Print** is disabled and marked Coming Soon. No claim of physical buildability is made.

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
Rate limits, idempotency keys, input sanitisation and size limits are in place for the POC.

## Deploying to Cloudflare

The API is written against two small adapters (SQLite metadata, object store). Swapping them for
D1 and R2 and moving the job runner to a Durable Object or container is the intended next step;
the simulation (Rapier WASM) runs in a few hundred milliseconds per test.
