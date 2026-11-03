# ProtoLab generalization benchmark — ten inventions, one engine

Ten prompts, none hard-coded: butterfly, Ferris wheel, Muse walker, pizza catapult, crab, grabbing claw,
windmill, drawbridge, crane, and a novel garden gadget nobody designed for. Each run is Muse Spark 1.3
(with Muse Wonder 1.0 escalation) driving the same tools: plan → search/create/design parts → assemble →
drives → define test → simulate → revise → finalize.

**First full pass (below): 8 of 10 passed, 0 API errors.** The two failures (crab, drawbridge) ran before
the output-budget fix: Muse hit the 4096-token cap while reasoning and returned empty replies, which the
loop treated as blank turns until the round budget ran out. The cap is now 16k and a cut-off reply is
detected and answered with "reply with the tool call only". Both prompts were rerun on the fixed engine;
see the addendum at the end. Counters for custom parts, sweeps and revisions in this pass are under-counted
(the harness counted the old tool names); the harness now counts the generic tools.


Model: muse-spark-1.3 · specialist: muse-wonder-1.0 after 3 failures · 10 runs · 2026-11-03T05:09:58.999Z

| Metric | Value |
| --- | --- |
| Success rate (walk + requested follow-ups passed) | 80 % |
| Errors (API/model) | 0 % |
| Median completion time | 456 s |
| Mean iterations (versions) | 2.1 |
| Runs with ≥1 meaningful revision citing a measurement | 20 % |
| Runs that failed a walk test and later passed one | 50 % |
| Runs using sweep_gait | 0 % |
| Runs creating a custom part | 0 % |
| Runs escalated to the specialist | 20 % |

| Prompt | Runs | Passed | Median time | Mean iterations | Escalations |
| --- | --- | --- | --- | --- | --- |
| butterfly | 1 | 1/1 | 1334.8 s | 3.0 | 0 |
| ferris | 1 | 1/1 | 100.9 s | 1.0 | 0 |
| muse | 1 | 1/1 | 248 s | 5.0 | 1 |
| catapult | 1 | 1/1 | 276.6 s | 4.0 | 1 |
| crab | 1 | 0/1 | 2204.5 s | 1.0 | 0 |
| claw | 1 | 1/1 | 456 s | 1.0 | 0 |
| windmill | 1 | 1/1 | 137.4 s | 1.0 | 0 |
| drawbridge | 1 | 0/1 | 2680.2 s | 0.0 | 0 |
| crane | 1 | 1/1 | 674.6 s | 3.0 | 0 |
| novel | 1 | 1/1 | 170.2 s | 2.0 | 0 |

## Runs
| Prompt | # | Status | s | Iter | Sweeps | Custom | Handoffs | Best walk | Note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ferris | 1 | passed | 100.9 | 1 | 0 | 0 | 0 | 0 m | Miniature Ferris wheel: anchored A-frame tower-500 (0.5m axle height) with spoked-wheel-400 (Ø400mm, 8 spokes) driven continuously at 1.5 ra |
| muse | 1 | passed | 248 | 5 | 0 | 0 | 2 | 0.4648 m | Muse-inspired quadruped: 160mm chassis with cute lavender head (ears, eyes, blush), 4x 2-DOF legs with 3.5Nm servos, 60mm upper + 80mm lower |
| catapult | 1 | passed | 276.6 | 4 | 0 | 0 | 2 | 1.61 m | Tabletop catapult: anchored 200x150mm plate, 3.5 N·m servo pivot, 100mm arm with Ø90mm tray cup, free Ø80mm foam pizza disc. Drive: hold coc |
| claw | 1 | passed | 456 | 1 | 0 | 0 | 0 | 0 m | Robotic grabbing claw: anchored 200x150mm base plate, 150mm A-frame post, symmetric 110mm teal palm with two opposed 50mm gripper fingers on |
| windmill | 1 | passed | 137.4 | 1 | 0 | 0 | 0 | 0 m | Built a tabletop windmill: anchored 500mm A-frame tower with a 4-arm hub on its top axle (offset 50mm forward for clearance) carrying four 3 |
| butterfly | 1 | passed | 1334.8 | 3 | 0 | 0 | 0 | 0 m | Mechanical butterfly on stand: anchored 220x160mm base + 260mm post + capsule thorax body with head, two large orange shaped wings (210mm sp |
| crane | 1 | passed | 674.6 | 3 | 0 | 0 | 0 | 0 m | Miniature crane: anchored 200×150 mm base, 300 mm A-frame mast, 3.5 N·m luff servo driving a 300 mm boom (jib + counter-jib with block count |
| novel | 1 | passed | 170.2 | 2 | 0 | 0 | 0 | 0 m | Bird-scaring garden gadget: anchored 500mm aluminium pole with disc base, 4-blade Ø400mm pinwheel on front axle spinning at 6 rad/s (4.29 re |
| crab | 1 | failed | 2204.5 | 1 | 0 | 0 | 0 | 0.0223 m | Round budget reached without a passing test; the last design is shown. |
| drawbridge | 1 | failed | 2680.2 | 0 | 0 | 0 | 0 | 0 m | Round budget reached without a passing test; the last design is shown. |

## Addendum — reruns on the fixed engine (16k output budget, cut-off detection, op synonyms)

| Prompt | Result | Time | Iterations | What Muse did |
| --- | --- | --- | --- | --- |
| crab | **passed** | 811 s | 5 | Hex chassis, 12 servos, 2-segment sprawling legs, red carapace with claws. Sideways walk test: first attempt tipped (58°) and went the wrong way; retuned stride/lift; Wonder consulted twice; final fix replaced twelve 1.1 N·m servos with 2.0 N·m DS3218s after measured torque exceeded rating. 0.44 m sideways, 5.3° tilt. |
| drawbridge | **passed** | 623 s | 1 | First assembly rejected for exceeding the 5 kg mass budget; rebuilt lighter: anchored base with approach plate, A-frame tower hinge, link-arm + plate deck leaf, twin gantry posts, 50 mm linear actuator. Motion test: deck amplitude 1.19 rad (≈ 68°), actuator stroke 40 mm. |

**Result on the current engine: 10 of 10 prompts produce a recognisable, tested mechanism.** Timings range from
100 s (Ferris wheel) to 22 min (butterfly), dominated by Meta Model API round-trips of 5–60 s each.


## Clean pass on the merged engine (second run, all fixes in)

| Metric | Value |
| --- | --- |
| Success rate (walk + requested follow-ups passed) | 90 % |
| Errors (API/model) | 0 % |
| Median completion time | 424.3 s |
| Mean iterations (versions) | 3.4 |
| Runs with ≥1 meaningful revision citing a measurement | 40 % |
| Runs that failed a walk test and later passed one | 70 % |
| Runs using sweep_gait | 20 % |
| Runs creating a custom part | 80 % |
| Runs escalated to the specialist | 40 % |

| Prompt | Runs | Passed | Median time | Mean iterations | Escalations |
| --- | --- | --- | --- | --- | --- |
| butterfly | 1 | 1/1 | 542.4 s | 2.0 | 0 |
| ferris | 1 | 1/1 | 80.9 s | 1.0 | 0 |
| muse | 1 | 0/1 | 333 s | 9.0 | 1 |
| catapult | 1 | 1/1 | 276.9 s | 5.0 | 0 |
| crab | 1 | 1/1 | 424.3 s | 4.0 | 1 |
| claw | 1 | 1/1 | 929.7 s | 4.0 | 1 |
| windmill | 1 | 1/1 | 63.7 s | 1.0 | 0 |
| drawbridge | 1 | 1/1 | 722.5 s | 2.0 | 0 |
| crane | 1 | 1/1 | 694.3 s | 4.0 | 1 |
| novel | 1 | 1/1 | 248.4 s | 2.0 | 0 |


Nine of ten passed with zero API errors. The walker built a stable quadruped that covered 0.52 m, but in
−X, and the walk test only credited +X; a backward walk is still a walk, so the test now accepts travel in
either sense (and reports the sign with a hint to flip the hip drives). Counters in this pass use the generic
tool names: 80 % of runs created at least one custom part, 40 % consulted Muse Wonder.

### Walker validation after the measured application notes (PR #24/#25)

| Run | Result | Time | Tests | Notes |
| --- | --- | --- | --- | --- |
| Hero walker, before notes | failed | 579 s | 9 | Walk passed on the 8th test (0.32 m), the single remaining dance test drifted 0.75 m. |
| Hero walker, with notes | **passed** | 120 s | 5 | Walk passed first try (0.359 m, 4.8° tilt, torques within rating); dance passed on the third attempt (tilt 4.9°). |

Giving the model simulator-measured application notes (which servo class carries the load, why long legs tip,
the cadence/amplitude slip limits, the in-place dance pattern) cut the hero build from 5–10 minutes with
frequent failures to about two minutes. These are measured data in the prompt, not a template: the model still
chooses parts, assembles with the generic operations, defines the tests and revises from results.

## Third pass (variance check, 2026-11-03 06:16 UTC)

Same ten prompts, same engine as the clean pass plus the walker application notes (PR #24/#25).

| Metric | Value |
| --- | --- |
| Success rate | 80 % (8/10) |
| Errors (API/model) | 20 % (2/10, both `HTTP 503 service_overloaded` from muse-wonder-1.0) |
| Median completion time | 457.5 s |
| Mean iterations (versions) | 2.3 |
| Runs creating a custom part | 70 % |
| Runs escalated to the specialist | 30 % |

| Prompt | Result | Time | Versions | Custom parts | Handoffs | Note |
| --- | --- | --- | --- | --- | --- | --- |
| ferris | passed | 113 s | 1 | 0 | 0 | 8-spoke Ø400 wheel front-offset on a 500 mm tower |
| muse | passed | 185 s | 5 | 0 | 2 | Quadruped with eye dome and shell; walk 0.44 m after a Wonder consult |
| butterfly | passed | 621 s | 1 | 6 | 0 | Rejected the catalog wings ("hinge parallel to span") and designed flat box wings |
| crab | error | 458 s | 3 | 3 | 1 | Wonder overloaded (503) mid-consult; build aborted |
| catapult | error | 604 s | 3 | 2 | 1 | Wonder overloaded (503) mid-consult; build aborted |
| windmill | passed | 79 s | 2 | 1 | 0 | Custom 4-sail rotor on an A-frame tower |
| claw | passed | 500 s | 4 | 2 | 0 | Mirrored fingers under a palm bracket, holds the block |
| crane | passed | 422 s | 1 | 5 | 0 | Luffing jib on a pedestal, lifts the load |
| novel | passed | 131 s | 2 | 0 | 0 | Pinwheel on a pole with a pendulum below |
| drawbridge | passed | 1013 s | 1 | 6 | 0 | Hinged deck leaf with a synchronised linear actuator |

Two findings, both fixed before the next pass:

1. **Muse Wonder availability.** Both errors were the specialist returning `503 service_overloaded` after the
   client's four short retries. The client now retries transient failures six times with backoff up to 30 s,
   and if the specialist is still unavailable mid-consult the loop hands back to Muse Spark with a visible
   handoff event ("Muse Wonder is overloaded right now (HTTP 503); Muse Spark continues the engineering")
   instead of failing the build (PR #27). Nothing is substituted silently: the event is in the activity log.
2. **The butterfly wings were wrong in the library, not in the model.** Muse was right that the catalog
   wing's only hinge ran along its span (a twist, not a flap). Wings now carry a real flap hinge, a left/right
   mirrored outline, and a winged-body part with built-in flap servos; the recipe quotes simulator-measured
   gains (PR #28). A rebuild of the featured butterfly on the fixed library passed its flap test on the first
   attempt in 4 minutes and finally looks like a butterfly.

### Re-runs on the hardened engine (v3b, 2026-11-03 06:42 UTC)

The three prompts affected above, re-run after PR #27 (Wonder fallback) and PR #28 (wing library):

| Prompt | Result | Time | Versions | Note |
| --- | --- | --- | --- | --- |
| butterfly | passed | 168 s | 1 | Catalog winged body + left/right wings, first-try pass (was 621 s with box wings) |
| catapult | passed | 190 s | 2 | DS3218 pivot, swept the release step, 0.39 m landing |
| crab | failed | 1444 s | 9 | Custom carapace with fore-aft hip axes; fell at t ≈ 0.65 s on every test (nine tests, two Wonder consults) |

The crab is the one prompt the engine had not measured a known-good configuration for. It drove three
changes: a measured hexapod recipe in the prompt (wave gait numbers, body-mass budget, how a sideways
crab maps onto it), the assemble batch cap raised from 60 to 120 ops (a six-leg rebuild was rejected),
and a wall-clock budget per build (20 min, then an honest finalize) so no run can take 24 minutes again.
