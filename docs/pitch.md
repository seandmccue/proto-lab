# ProtoLab in one page

**What it is.** An AI invention studio. You describe a mechanism in a sentence; Meta Muse plans it,
picks or designs real parts, assembles them with validated operations, proves the design in a rigid-body
physics simulator, revises from the measurements, and hands you an interactive 3D prototype you can
publish and remix. Nothing in the gallery is canned: every card is a real build with its real trace.

**Why it is interesting.**
- *The model is the engineer.* Muse Spark 1.3 makes every design decision through tools (plan, search a
  116-part library, create or design parts, assemble, set drives, define tests, run tests, finalize).
  After three failed tests Muse Wonder 1.0 steps in with a diagnosis and hands back; the activity log
  shows the handoff, and if Wonder is overloaded the log says so and Spark continues.
- *Physics decides, not vibes.* Rapier simulates the assembly; tests measure what matters for that
  invention (distance and tilt for a walker, stroke and rate for wings, landing distance for a catapult,
  payload held off the floor for a claw) and check motor demand against each part's rating.
- *Universal, not templated.* The same library and operations produce a quadruped, a butterfly, a Ferris
  wheel, a catapult, a crab, a claw, a windmill, a drawbridge, a crane, a garden gadget, a pendulum desk
  toy, a see-saw with a rocking bird. Recipes in the prompt are simulator-measured numbers, not templates.
- *Honest about limits.* Every version lists what the physics cannot verify (lift, airflow, fatigue).

**Numbers (current engine, Meta Model API).** Latest full ten-prompt pass: 10 of 10, median 96 s, 0 API
errors, no specialist escalation (windmill 16 s, butterfly 38 s, Ferris wheel 48 s, walker 81 s). Ten
passes in all: 92 of 100 runs, every miss traced to a measurable cause and written into a recipe or an
engine rule with a locking simulator test. 20-run walker reliability set on
the same engine: 20 of 20, median 81 s.

**What to try in two minutes.** Open the homepage, pick "Mechanical butterfly" or type "Build a windmill
with four sails on a tower whose rotor turns", and watch the 3D view fill in as parts are mounted; the
first simulation lands within a minute or two. Then open the featured crab: three failed scuttles, a
Muse Wonder handoff, then 0.32 m at 4.7° tilt. Remix it with "give it four wings like a dragonfly".

**Stack.** React + Vite + React Three Fiber; Hono on Node with node:sqlite and a worker-thread job
runner (three builds in parallel, 20-minute budget each); zod schemas; a parametric parts library and
assembly-operations engine; Rapier physics. Model calls go through the Meta Model API
(`https://api.meta.ai/v1`) with the key server-side only. `npm run preflight` is the demo go / no-go.
