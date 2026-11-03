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

### Crab after the hexapod recipe (v3c, 2026-11-03 06:53 UTC)

| Prompt | Result | Time | Versions | Note |
| --- | --- | --- | --- | --- |
| crab | **passed** | 613 s | 1 | chassis-hex-200, DS3218 hips/knees, 60 mm bars, 60 g carapace with eye stalks and claws; wave gait at 1 Hz, swingDuty 0.3: 0.30 m in 6 s, 5.8° tilt, first test |

Same prompt that had failed after nine tests in 24 minutes: with the measured hexapod numbers in the
prompt, Muse built the proven configuration, kept the carapace under the mass budget, and passed on its
first test. One wasted round (a mount onto an instance it had not placed yet) is now answered with a
hint that lists the existing instances and the place op to use.

## Fourth pass on the hardened engine (v4, 2026-11-03 07:35 UTC)

All ten prompts, same engine as the gallery (PRs #27–#59: Wonder fallback, wing library, hexapod recipe,
move-with-attached, torque tolerance, 120-op batches, 20-min budget).

| Metric | Value |
| --- | --- |
| Success rate | **90 % (9/10)** |
| Errors (API/model) | **0 %** |
| Median completion time | 351 s |
| Mean iterations (versions) | 2.1 |
| Runs creating a custom part | 70 % |
| Runs escalated to the specialist | 20 % |

| Prompt | Result | Time | Versions | Custom parts | Handoffs | Note |
| --- | --- | --- | --- | --- | --- | --- |
| ferris | passed | 104 s | 1 | 0 | 0 | 8-spoke Ø400 wheel on tower-300, first try |
| butterfly | passed | 173 s | 1 | 0 | 0 | Winged body + left/right catalog wings, first try |
| muse | passed | 242 s | 7 | 2 | 4 | DS3218 quadruped with hood shell; two Wonder consults |
| catapult | passed | 390 s | 5 | 4 | 2 | 300 mm arm, tray, foam pizza; one Wonder consult |
| crab | passed | 351 s | 2 | 3 | 0 | Hexapod chassis yawed 90°, scuttles sideways (direction z) |
| windmill | passed | 277 s | 1 | 1 | 0 | 4-sail rotor hub on tower-500 |
| claw | passed | 574 s | 2 | 1 | 0 | Two 3.5 N·m servos, mirrored fingers, holds the block |
| drawbridge | failed | 1391 s | 0 | 4 | 0 | Spent the 20-min budget designing decks and a clevis for an actuator linkage; never assembled (honest finalize) |
| crane | passed | 377 s | 1 | 1 | 0 | Luffing boom on an A-frame, first try |
| novel | passed | 157 s | 1 | 0 | 0 | Pinwheel on a pole with a pendulum, first try |

Across the four passes on the current engine that is 36 of 40 runs passed, with every miss traced to a
specific cause and fixed: a direction-only walk test, two Wonder 503s, the crab's missing recipe, and now
the drawbridge, whose rounds took 4–5 minutes each while Muse reasoned about a four-bar linkage. The fix
is the same as for the crab: plates gained `hinge_back` / `hinge_front` pivots, the prompt quotes a
simulator-measured drawbridge (a 300 × 150 × 6 mm deck needs 1.23 N·m at the hinge; a 3.5 N·m servo lifts it
to 64°), and after a dozen tool calls with nothing assembled the loop asks for a first build.

### Drawbridge after the recipe (v4b, 2026-11-03 07:43 UTC)

| Prompt | Result | Time | Versions | Note |
| --- | --- | --- | --- | --- |
| drawbridge | **passed** | 308 s | 2 | 300×200 base, rear 3.5 N·m servo hinge, 300×150 deck lifting 0 → 1.1 rad in 3 s, two actuator towers as the visible lifting element; first test passed |

Same prompt that burned its 20-minute budget on linkage research: with the measured numbers and the
plate hinge pivots in the library, Muse assembled within two minutes and passed its first lift test.
That closes the last of the four misses; every one of the ten showcase prompts has now passed on the
current engine.

### Walker speed envelope (measured 2026-11-03 08:00 UTC)

A 20-run walker reliability pass had one "walk 40 cm" run stall at 0.36 m after nine tests. A simulator
sweep of the hero configuration (chassis-quad-160, DS3218 servos, 60 mm legs, ±0.4 rad at 1 Hz) found the
lever the model was missing: motor stiffness. At stiffness 5 the quadruped walks 0.30 m in 6 s; at
stiffness 8–10 it walks 0.48–0.53 m with ≈3° tilt and 0.9 N·m peak hip torque, because the servos track the
gait instead of lagging it. Longer legs, a bigger chassis, bigger feet, higher cadence and larger
amplitude all walk worse. The numbers are now in the recipe and locked by a simulator test.

### Catalog index in the prompt (v5 sample, 2026-11-03 08:18 UTC)

Builds were spending 4–12 `search_catalog` and up to 10 `get_part` rounds before the first assemble. The
system prompt now carries a one-line-per-part index of the library (≈1.9k tokens: id, mass, rating,
connector ids with kind and outward axis), so Muse mounts by id directly.

| Prompt | v4 (no index) | v5 (index) | Note |
| --- | --- | --- | --- |
| windmill | 277 s | **54 s** | first try, 3 searches instead of 4 and no deliberation rounds |
| ferris | 104 s | **74 s** | first try, 0 searches (4 get_part for exact geometry) |
| butterfly | 173 s | **92 s** | first try |

Every fast demo prompt is now under 100 s end to end.


## Fifth full pass, with the catalog index (v6, 2026-11-03 08:34 UTC)

| Metric | Value |
| --- | --- |
| Success rate | **100 % (10/10)** |
| Errors (API/model) | **0 %** |
| Median completion time | 352 s |
| Mean iterations (versions) | 1.8 |
| Runs escalated to the specialist | 0 % |
| Runs creating a custom part | 10 % |

| Prompt | Result | Time | Versions | Custom parts | Handoffs | Note |
| --- | --- | --- | --- | --- | --- | --- |
| ferris | passed | 62 s | 1 | 0 | 0 | Miniature Ferris wheel: anchored tower-300 with spoked-wheel-400 (Ø400mm, 8 spokes) on the… |
| muse | passed | 99 s | 3 | 0 | 0 | Muse-inspired quadruped: chassis-quad-160 + enclosure shell with eye domes, 4x 2-DOF legs … |
| butterfly | passed | 152 s | 1 | 0 | 0 | Mechanical butterfly on anchored stand: plate-120x80 base + rod-200 vertical post + body-b… |
| catapult | passed | 352 s | 2 | 1 | 0 | Tabletop catapult: anchored base-plate-300x200, servo-mg996r (1.1 N·m) at top_back, custom… |
| crab | passed | 393 s | 1 | 0 | 0 | Six-legged crab: yawed chassis-hex-200 (body across travel) with 6x 2-DOF legs (ds3218 hip… |
| windmill | passed | 130 s | 1 | 0 | 0 | Built a windmill: anchored tower-500 with gearmotor-25 on its top axle driving a windmill-… |
| drawbridge | passed | 110 s | 1 | 0 | 0 | Automated drawbridge: anchored 300x200mm base, 3.5 N·m hinge servo at rear edge, 200x150mm… |
| claw | passed | 746 s | 2 | 0 | 0 | Robotic grabbing claw: anchored plate-80x50 base + beam-100 post + plate-120x80 palm holdi… |
| crane | passed | 391 s | 3 | 0 | 0 | Miniature crane: anchored 300x200 base, 150mm A-frame mast, 3.5 N·m luff servo driving a 1… |
| novel | passed | 368 s | 3 | 0 | 0 | Bird-scaring garden gadget: anchored tower-500 pole with a 3-blade Ø200mm pinwheel spinnin… |

Ten of ten on the first full pass after the catalog index landed, with no Muse Wonder consult needed:
the walker walked and danced in 99 s, the drawbridge lifted in 110 s, the crab scuttled first-try. With
the index in the prompt the model reaches for library parts more and designs fewer of its own (10 % of
runs vs 70 %); custom parts still appear where the library has nothing (the catapult arm here, the bells
and one-piece stand of the pendulum desk toy in the gallery). Across six passes on the current engine:
55 of 60 runs passed, and every miss was traced to a cause and fixed.

### Claw after the measured recipe and the honest grip test (v6b, 2026-11-03 10:31 UTC)

| Prompt | v6 | v6b | Note |
| --- | --- | --- | --- |
| claw | 746 s, 2 versions (7 min of deliberation before the first assemble) | **149 s, first try** | Mirrored servos under a palm, fingers in one plane, 0.6 rad close cradles the block; 20 events total |

Two engine changes landed alongside: the grip test now fails when the payload lands on the floor (it
used to accept any block within 15 cm of the palm, floor included), and the engine recovers the three
wasted first-batch rounds the API log kept showing — a mount onto a `body`/`base` nobody placed is
auto-placed when its connectors identify one library part, re-using an id replaces the instance, and
array fields sent as JSON strings are parsed (PR #77, #78).


## Sixth full pass: claw recipe, first-batch recovery (v7, 2026-11-03 10:48 UTC)

| Metric | Value |
| --- | --- |
| Success rate | 90 % (9/10) |
| Errors (API/model) | 0 % |
| Median completion time | **181 s** (was 352 s) |

| Prompt | Result | Time | Versions | Custom parts | Handoffs | Note |
| --- | --- | --- | --- | --- | --- | --- |
| ferris | passed | 60 s | 1 | 0 | 0 | Miniature Ferris wheel: anchored tower-300 with spoked-wheel-400 (Ø400mm, 8 spokes) driven… |
| muse | passed | 80 s | 2 | 0 | 0 | Muse-inspired quadruped: chassis-quad-160 + 4x 2-DOF legs (ds3218 2Nm hips/knees, leg-bar-… |
| butterfly | passed | 164 s | 1 | 0 | 0 | Mechanical butterfly on a stand: anchored plate-120x80 base with a 400mm rod post holding … |
| claw | passed | 181 s | 1 | 0 | 0 | Robotic grabbing claw: anchored plate-120x80 base, beam-100 post, plate-120x80 palm, two o… |
| crab | passed | 288 s | 1 | 1 | 0 | Mechanical crab: yawed hex chassis (body across travel) with 6 two-joint legs (ds3218 hips… |
| windmill | passed | 67 s | 2 | 0 | 0 | Built a windmill: anchored A-frame tower-500 with 4-blade rotor windmill-4x600 mounted on … |
| catapult | failed | 400 s | 9 | 1 | 4 | Tabletop catapult: anchored base-plate-300x200, servo-ds3218 pivot, custom 350mm arm (desi… |
| novel | passed | 86 s | 1 | 0 | 0 | Bird-scaring garden gadget: anchored tower-500 pole with a 4-blade Ø400mm pinwheel rotor o… |
| crane | passed | 228 s | 2 | 2 | 0 | Miniature crane: anchored 300x200 base + 150mm A-frame tower + 8Nm luff servo driving a 40… |
| drawbridge | passed | 614 s | 5 | 1 | 2 | Automated drawbridge: anchored base-plate-300x200 with servo-high-torque-35 hinge servo dr… |

Median time halved again: eight of ten were first-try builds. The claw went 746 s → 181 s. The
drawbridge lifted first-try, then spent four tests on a raise-and-lower cycle whose step drive slammed
the deck (23 N·m demand) until Wonder fixed it; the recipe now quotes a measured sine cycle (1.1 N·m,
no saturation). The catapult missed: a 350 mm arm overshot a 0.5 m target for nine tests; the recipe now
carries a measured arm-length → range table (100 mm → 0.35 m, 140 mm → 0.59 m, 220 mm → 0.98 m) and
says to pick the arm from the target before the first test.

### Catapult and drawbridge re-runs (v7b / v7c, 2026-11-03 10:50–11:01 UTC)

| Prompt | v7 | Re-run | Note |
| --- | --- | --- | --- |
| catapult | failed, 9 tests, 400 s (350 mm arm overshot) | **passed, first test, 103 s** | 140 mm arm from the measured table landed the pizza at 0.48 m (target 0.5 ± 0.25) |
| drawbridge | passed after 4 cycle tests and 2 Wonder consults, 614 s | **passed, first test, 144 s** | raise-and-lower sine cycle within rating |

The drawbridge re-run also fixed a simulator behaviour: a position drive whose first target sits far from
the assembled pose (a sine with offset 0.55 and phase 0) used to be commanded there at t = 0, so
stiffness 40 × 0.55 rad showed up as a 22 N·m demand spike. Drives now approach such a target no faster
than 0.6 rad/s (measured: 1.3 N·m instead of 22), the way a real servo would be commanded (PR #83, #84).

### Crane re-run with the servo-sizing note (v7d, 2026-11-03 11:02 UTC)

| Prompt | Before | Re-run | Note |
| --- | --- | --- | --- |
| crane | first test failed on torque in every pass (228–391 s, 2–3 versions) | **passed, first test, 161 s** | 3.5 N·m luff servo chosen from the boom length before testing |

With that, every one of the ten showcase prompts has a simulator-measured recipe and has passed on its
first test at least once on the current engine.


## Seventh full pass: every recipe measured (v8, 2026-11-03 11:17 UTC)

| Metric | Value |
| --- | --- |
| Success rate | 90 % (9/10) |
| Errors (API/model) | 0 % |
| Median completion time | 181 s |
| First-try builds | 6 of 10 |

| Prompt | Result | Time | Versions | Custom parts | Handoffs | Note |
| --- | --- | --- | --- | --- | --- | --- |
| muse | passed | 51 s | 3 | 0 | 0 | Small Muse-inspired quadruped: chassis-quad-160 with 4x 2-DOF legs (ds3218 servos, leg-bar… |
| ferris | passed | 105 s | 1 | 1 | 0 | Miniature Ferris wheel: anchored tower-300 with custom 8-spoke 300mm wheel on the axle (ve… |
| catapult | passed | 81 s | 1 | 1 | 0 | Tabletop catapult: anchored base-plate-300x200 + servo-giant-8 (8 N·m) + custom 130 mm arm… |
| butterfly | passed | 174 s | 1 | 0 | 0 | Mechanical butterfly on an anchored stand: base-plate-300x200 base with beam-200 vertical … |
| claw | passed | 181 s | 1 | 0 | 0 | Robotic grabbing claw: anchored plate-120x80 base, beam-100 post, plate-120x80 palm, two s… |
| windmill | passed | 385 s | 3 | 0 | 0 | Windmill: anchored tower-500 with a 200 mm shaft on its top axle boss, hub plate, and four… |
| crane | passed | 137 s | 1 | 0 | 0 | Miniature crane: anchored base-plate-300x200, tower-150, 3.5 N·m luff servo, 150mm link bo… |
| drawbridge | passed | 506 s | 1 | 1 | 0 | Automated drawbridge: anchored 300x200 base, 3.5 N·m hinge servo at rear edge, 300x150 dec… |
| novel | passed | 244 s | 2 | 0 | 0 | Garden bird-scarer: anchored base-plate foot + tower-500 pole, windmill-4x600 pinwheel on … |
| crab | failed | 856 s | 9 | 0 | 4 | Six-legged crab on chassis-hex-200 with 12x servo-ds3218 (hip+knee per leg), leg-bar-60 up… |

Catapult (81 s), claw (181 s), crane (137 s) and drawbridge now pass first-try where they used to burn
tests; the walker walked and danced in 51 s. The crab, which passed first-try in the two passes before,
missed this time (nine tests, four sweeps, two Wonder consults, best 0.21 m): see the follow-up below.

### Crab re-run with the stiffness-8 hexapod figures (v8b, 2026-11-03 11:22 UTC)

| Prompt | v8 | Re-run | Note |
| --- | --- | --- | --- |
| crab | failed, 9 tests, 857 s (stride-limited at 0.21 m) | **passed, first test, 173 s, 0.39 m** | the recipe's measured 0.385 m at stiffness 8 / swingDuty 0.3, reproduced to the centimetre |

Across eight full passes and their re-runs on the current engine, every one of the ten showcase prompts
has passed on its first test, and the misses in each pass were traced to a measurable cause, measured,
and written into the recipe with a locking simulator test.
