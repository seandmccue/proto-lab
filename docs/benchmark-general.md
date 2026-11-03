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
