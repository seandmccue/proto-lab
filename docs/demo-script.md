# ProtoLab — judge demo script (≈ 6 minutes)

Everything below is live. Nothing is pre-rendered; gallery items were built by Muse on this server.

## 0. Before the demo (2 minutes)
- `npm run dev` with `MODEL_API_KEY` set. The header badge must read **Powered by Meta Muse Spark 1.3** with a green dot (the API ran a live tool-call smoke test).
- Open the homepage once so the featured cards have loaded.

## 1. Homepage (20 s)
"What will you invent?" Point at the four featured cards: walking Muse robot, mechanical butterfly, Ferris wheel, pizza catapult. Hover a card: the preview animates the *actual* simulation trace. Say: *same component library, same assembly operations, no template per invention.*

## 2. Start a build live (measured Muse timings, so pick deliberately)
Live Meta Model API rounds take 5–60 s each. Measured end-to-end: Ferris wheel ≈ 100 s, windmill ≈ 140 s, novel garden gadget ≈ 170 s, walker ≈ 4–6 min, catapult ≈ 5 min, claw ≈ 8 min, crane ≈ 11 min, crab ≈ 13 min, butterfly 11–22 min. For a live slot, start a **Ferris wheel** or **windmill** (or let a judge type one) and, while it runs, open a featured build in a second tab to show the finished experience. While the live run works, narrate the activity log:
- First line names the model. *Every decision below is the model's; results are the simulator's.*
- **Engineering plan** card: purpose, recognisable features, motions, sub-assemblies, success criteria, and *what the physics cannot verify* (e.g. aerodynamic lift).
- `search_catalog` / `create_part` / `design_part`: Muse picks real parts and designs missing ones (a thorax, a shaped wing). Custom parts get a **designed by Muse** badge in the BOM.
- `assemble`: structured, validated operations. Point out a rejected op if one appears: *validation, not vibes.*
- `define_test` → `run_test`: measured metrics with units. Failures show the exact reason.
- Revision: the model changes one thing and cites the measurement (**Based on:** in the Tests tab).
- If three tests fail in a row: **Model handoff** card, Muse Wonder diagnoses in one sentence, fixes, hands back.

## 3. Explore the result (60 s)
Play / scrub the trace. **Explode** to show the mechanism. **Blueprint** for true dimensions. Click a part: mass, material, connectors, source. BOM with provenance badges. Version chips v1…vn: replay the failed attempts; the fall is real.

## 4. Change it (60 s)
"Request change": *make the wings bigger* / *walk 30 % further* / *give it six legs*. Same loop, new versions, numbering continues.

## 5. Publish and remix (30 s)
Publish (opt-in). Open the gallery card. Remix: a forked design with provenance to the original, built from the parent's recorded operations.

## What to say when asked "is it real?"
- Decisions: Muse's, via validated tool calls (schema-checked JSON; no generated code is executed).
- Physics: Rapier rigid-body simulation, deterministic, fixed 1/240 s step; motors saturate at their catalog rating.
- Not verified: anything the physics cannot measure (flight, fluids, deformation). The plan says so, the summary says so, and 3D Print stays **Coming Soon**.
- Benchmarks: see docs/benchmark.md and docs/benchmark-general.md for honest success rates and timings.
