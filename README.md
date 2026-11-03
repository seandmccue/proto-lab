# ProtoLab

AI-powered invention studio. Describe an invention, watch an AI engineer assemble it from real
catalog parts, simulate it with a rigid-body physics engine, revise it from measured results,
explore it in 3D, publish it, and remix it.

Hero demo: **Bring My Muse to Life** — a small walking robot built from mechanical components,
tested for balance and walking, then asked to dance.

## Layout

```
apps/web          React + Vite + React Three Fiber front end
apps/api          Hono API on Node: inventions, versions, jobs, gallery (SQLite + local object store)
packages/schema   Versioned assembly / spec / test JSON schema (zod)
packages/parts    Curated parametric parts catalog with connectors and physical properties
packages/simulator Deterministic Rapier (WASM) test harness
packages/agent    LLM planner with validated tool calls + revision loop
```

## Run

```bash
npm install
cp .env.example .env   # add LLM_API_KEY to use a real model
npm run dev            # api on :8787, web on :5173
```

Without an API key the agent runs a deterministic planner and the UI says so. With a key it
uses the configured model via an OpenAI-compatible endpoint and labels the model honestly.

## Honesty rules

- Simulation results are measured by the physics engine, never fabricated.
- The UI distinguishes model decisions from simulator results.
- 3D Print is disabled and marked Coming Soon.
- No claim of physical buildability or safety is made.
