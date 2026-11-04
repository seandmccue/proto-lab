# ProtoLab judge demo

## Earlier 73-second recording

The 3D shots replay saved simulator traces in the application. The opening shows the prompt interaction. It does not start a live build in the recording.

| Time | Picture | Proof |
| --- | --- | --- |
| 0–8 s | Homepage and the prompt “Build a small robot that walks and dances.” | A one-sentence invention brief is enough to start. |
| 8–19 s | Saved walker v4, with the replay and test panel visible | It traveled 6.1 cm and tilted 44.4°, missing the walk test. |
| 19–29 s | Saved walker v11 | After a follow-up asked for 45 cm in six seconds, the revised walk passed at 47.2 cm. |
| 29–38 s | Public gallery | The same engine generated visibly different mechanisms. Each featured card opens a saved assembly with replay. |
| 38–50 s | Dragonfly remix v1 | The user asked for four wings. The first test detected contact between the right forewing and hind wing. |
| 50–63 s | Dragonfly remix v2 | Muse moved both rear hinges back and reran the same test. It recorded 2 Hz and no detected wing contacts. |
| 63–73 s | Saved walker v12 dance | A distinct motion test passed with 2.4° maximum tilt. |

## Live version

1. In a signed-out browser, open the homepage and click **Watch Muse fix the crab**. Play the comparison and point out the shared 25 cm distance target and 10° tilt limit.
2. Pause near the tilt spike. Spark’s v3 traveled 0.27 cm at 14.28° peak tilt. Wonder revised the stance and gait. V4 passed at 31.73 cm and 4.72°. Open the controlled comparison if the judge asks which change mattered.
3. Open the triplex pump comparison. Scrub both versions together and point to the three piston traces. Muse adjusted one crank disc. The gaps between peaks tightened from 102.2°–137.6° to 119.4°–120.3°, and each piston still moved more than 40 mm. Both versions passed the original stroke test. The phase readout comes from the saved motion.
4. In a second tab, start a fresh crane with a constraint the judge chooses. One rehearsal brief asked it to lift a block at least 8 cm, hold it, then lower it to within 2 cm of its start. While it runs, show the Gravity Clock or the orrery. The orrery’s first joint test passed, but the Moon barely moved around Earth in the arm’s frame. Scrub the revised orbit, which completed 5.49 turns in 12 seconds. Return to the crane when it reaches a milestone.

For a short demonstration of passive motion, open the self-leveling tray and scrub to the cradle’s steepest angle. The cradle reached 31.0° while the tray stayed within 3.14° of level. Locking only the inner pivot in a separate simulation raised peak tray tilt to 29.84°. The two-axis comparison shows Spark’s first tray reaching 144.22° and Wonder’s centered tray staying within 1.31°, with both powered sweeps still meeting the target.

The mechanical lotus shows one actuator opening six passive petals. The first test barely moved. In the final revision, Muse refitted all six connecting rods and measured at least 70.1 mm of vertical travel per tip. The difference between the most and least displaced tips stayed within 0.02 mm at any instant in the test. Scrub the replay to watch the opening change from about 269 mm to 171 mm.

The Geneva reference shows intermittent motion. Scrub across a flat section of the output trace while the input trace keeps rising, then advance to the next quarter turn. This is the catalog reference.

The separate Muse-built jewel carousel shows how an actual build improved. Compare v1 against v8, then scrub across the roughly 2.8-second pause between the two 90° steps. The motor kept turning throughout. In a separate control run, disabling the single drive pin stopped the carousel while the motor still completed more than two revolutions.

## Saved run routes

- Walker · `/i/inv_bb9d5f8a170d4d95`
- Dragonfly · `/i/inv_fd8fcc242ed8497f`
- Crab comparison · `/i/inv_633b4887ad7f4cdc?replay=1&compare=1`
- Triplex pump comparison · `/i/inv_c618332e234d447d?replay=1&compare=1`
- Drawing remix comparison · `/i/inv_76b7fae5bdf941c9?replay=1&compare=1`
- Orrery comparison · `/i/inv_adc081059ea44ab9?replay=1&compare=1`
- Two-axis gimbal repair · `/i/inv_d3f76fcc393b49d6?replay=1&compare=1`
- Mechanical lotus · `/i/inv_ba7b3c7716564397?replay=1&compare=1`
- Muse jewel carousel · `/i/inv_b99f505fab294915?replay=1&compare=1`
- Geneva indexer reference · `/i/inv_geneva_indexer?replay=1`
- Self-leveling tray · `/i/inv_f72fb06c611342eb?replay=1`
- Gravity Clock · `/i/inv_a1f1665e649b41c2`
- Cargo Crane · `/i/inv_0868f2ea889f4bcc`

Confirm the deployment preserved these records before publishing the links.
