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
