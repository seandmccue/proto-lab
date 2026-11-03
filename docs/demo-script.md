# ProtoLab — judge demo script (≈ 6 minutes)

Everything below is live. Nothing is pre-rendered; gallery items were built by Muse on this server.

## 0. Before the demo (2 minutes)
- `npm run dev` with `MODEL_API_KEY` set. The header badge must read **Powered by Meta Muse Spark 1.3** with a green dot (the API ran a live tool-call smoke test).
- `npm run preflight` prints a go / no-go: model live, four featured builds passed, a public remix present, web serving.
- Open the homepage once so the featured cards have loaded.

## 1. Homepage (20 s)
"What will you invent?" Point at the five featured cards: walking Muse robot (v9 walked 0.31 m after discovering why it fell; a follow-up "walk 50 % further, then dance" added v10–v12 at 0.47 m), mechanical butterfly, Ferris wheel, pizza catapult, mechanical crab (open the crab's version chips: three failed scuttles, a Muse Wonder handoff, then a pass). Hover a card: the preview animates the *actual* simulation trace. Say: *same component library, same assembly operations, no template per invention.*

## 2. Start a build live (measured Muse timings, so pick deliberately)
Live Meta Model API rounds take 5–60 s each. Measured end-to-end (with the catalog index in the prompt): windmill ≈ 55 s, Ferris wheel ≈ 75 s, butterfly ≈ 90 s, novel garden gadget ≈ 160 s, walker ≈ 2–5 min (2 min with the measured notes), catapult ≈ 3–5 min, claw ≈ 2.5 min, crane ≈ 6 min, crab ≈ 6 min, drawbridge ≈ 2 min. For a live slot, start a **Ferris wheel**, **windmill** or **butterfly** (or let a judge type one) and, while it runs, open a featured build in a second tab to show the finished experience. There is always something to watch: before the first assembly the 3D pane shows the **build progress** view (stage stepper Plan → Parts → Assemble → Test → Revise → Done, the current step, elapsed time, and "Muse is reasoning, N s" when a round runs long) and the **parts bin**, where every part Muse finds or designs slides in as a thumbnail card ("designed by Muse" badge on custom parts). At the first `assemble` the parts **drop in one at a time** (badge: *assembling · n of N components placed · not yet simulated*), the newest one glowing. From then on a compact **build strip** stays over the 3D view with the stepper and timer, each test result lands as a pass/fail toast with its key number, and the **iteration ribbon** in the pane heading grows a chip per version (v1 ✗ 0.12 m → v2 ✓ 0.47 m; click a chip to view that version). The simulated version replaces the live assembly after the first test. While the live run works, narrate the activity log:
- First line names the model. *Every decision below is the model's; results are the simulator's.*
- **Engineering plan** card: purpose, recognisable features, motions, sub-assemblies, success criteria, and *what the physics cannot verify* (e.g. aerodynamic lift).
- `search_catalog` / `create_part` / `design_part`: Muse picks real parts and designs missing ones (a thorax, a shaped wing). Custom parts get a **designed by Muse** badge in the BOM.
- `assemble`: structured, validated operations. Point out a rejected op if one appears: *validation, not vibes.*
- `define_test` → `run_test`: measured metrics with units. Failures show the exact reason.
- Revision: the model changes one thing and cites the measurement (**Based on:** in the Tests tab).
- If three tests fail in a row: **Model handoff** card, Muse Wonder diagnoses in one sentence, fixes, hands back. If Wonder is overloaded (it returned 503s during one benchmark pass), the card says so and Spark continues; nothing is substituted silently.

## 3. Explore the result (60 s)
Play / scrub the trace. **Explode** to show the mechanism. **Blueprint** for true dimensions. Click a part: mass, material, connectors, source. BOM with provenance badges. Version chips v1…vn: replay the failed attempts; the fall is real.

## 4. Change it (60 s)
"Request change": *make the wings bigger* / *walk 30 % further* / *give it six legs*. Same loop, new versions, numbering continues.

## 5. Publish and remix (30 s)
Publish (opt-in). Open the gallery card. Remix: a forked design with provenance to the original, built from the parent's recorded operations. Already in the gallery from real sessions: **Dragonfly (remix of the butterfly)** — four wings, hind pair out of phase, Muse fixed a wing-clearance failure itself on iteration 2; **Six-sail windmill** — a follow-up request ("spin twice as fast and add two more sails") recorded as v2 with a 6-parts-changed badge; **Desk toy: pendulum that rings two bells** — a brief nobody had tested before, with a bell part and a one-piece stand Muse designed itself (4 versions); **See-saw with a rocking bird on one end** — another untested brief, passed first-try in 5.5 min (beam rocking on a tower axle, a winged bird bobbing on a micro servo).

## What to say when asked "is it real?"
- Decisions: Muse's, via validated tool calls (schema-checked JSON; no generated code is executed).
- Physics: Rapier rigid-body simulation, deterministic, fixed 1/240 s step; motors saturate at their catalog rating.
- Not verified: anything the physics cannot measure (flight, fluids, deformation). The plan says so, the summary says so, and 3D Print stays **Coming Soon**.
- Benchmarks: see docs/benchmark.md and docs/benchmark-general.md for honest success rates and timings.
