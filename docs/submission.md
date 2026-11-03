# Hackathon submission text (draft)

Copy-ready blocks for the submission form. Numbers are from docs/benchmark-general.md and docs/benchmark.md.

## One-liner (≤ 140 chars)

ProtoLab: describe an invention, Meta Muse engineers it from real parts, proves it in physics, and hands you a 3D prototype to remix.

## Short description (≈ 100 words)

ProtoLab is an AI invention studio built on Meta Muse. You type a sentence ("a mechanical crab that
scuttles sideways"); Muse Spark plans the mechanism, picks or designs parts from a 116-part library,
assembles them with validated operations, runs measurable tests in a rigid-body physics simulator, and
revises from the numbers. After three failed tests Muse Wonder steps in with a diagnosis and hands back.
You watch the assembly take shape, replay the simulation in 3D, publish it, and remix it with a new
brief. Every gallery item is a real build with its real trace; every version lists what the physics
cannot verify.

## Long description

**The problem.** Mechanical design is a loop of guess, build, measure, fix. Generative tools stop at a
picture or a mesh; nothing checks whether the thing moves.

**What ProtoLab does.** The model is the engineer and the simulator is the judge. Muse works through a
ten-step procedure with tools: write a plan with recognisable features, motions and success criteria;
search the component library (frames, gears, servos, wings, grippers, rotors, hinges, plates with real
connectors and ratings) or create and design missing parts; assemble with mount/connect/pattern/move
operations that are validated before they run; set drives; define tests with units; run them in Rapier;
read the failure reasons and metrics; revise; finalize with an honest list of unverified behaviours.

**Why Muse.** Muse Spark 1.3 makes every design decision; Muse Wonder 1.0 is the engineering specialist
consulted after three consecutive failures, visibly, with a one-sentence diagnosis. If Wonder is
unavailable the log says so and Spark continues; nothing is substituted silently.

**Universal, not templated.** The same library and operations produced a Muse walker that walks and
dances, a butterfly, a Ferris wheel, a pizza catapult, a crab, a claw, a windmill, a drawbridge, a crane,
a garden pinwheel, a pendulum desk toy, a see-saw with a rocking bird and a dragonfly remix. Recipes in
the prompt are simulator-measured numbers (which servo carries which load, which gait slips), not
templates.

**Measured.** Latest full ten-prompt pass through the Meta Model API: 10 of 10, median 96 s, 0 API
errors, no specialist escalation; ten passes in all, 92 of 100 runs. Every miss was traced to a
measurable cause and fixed with a locking simulator test.

**What you can do in the demo.** Start a build and watch parts mount in 3D before the first simulation.
Open a featured build, scrub the trace, explode the assembly, read the bill of materials with
"designed by Muse" badges, step through versions including the failures. Ask for a change ("walk 50 %
further"), publish, remix.

## Tech stack

React, Vite, React Three Fiber; Hono on Node with node:sqlite and a worker-thread job runner; zod
schemas; a parametric parts library and assembly-operations engine; Rapier physics; Meta Model API
(muse-spark-1.3, muse-wonder-1.0) with the key server-side only.

## Links

- Repository: https://github.com/seandmccue/proto-lab
- One-page pitch: docs/pitch.md · Demo script: docs/demo-script.md · Benchmarks: docs/benchmark-general.md
