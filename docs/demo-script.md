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

The marble elevator reference makes the handoff easy to see. With the **Delivery path** on, scrub through the rise, the tip, and the roll into the blue catch bin. The loose marble rose 120 mm and stayed in the bin for the last four seconds of the test.

In the Muse-built elevator comparison, v1 dropped the marble. The final revision keeps it in the receiver for four seconds and stays within both drive ratings. Use the synchronized scrubber to watch the two outcomes diverge.

## Optional voice-over inserts

| Clip | On screen | Voice-over |
| --- | --- | --- |
| Carousel, 13 s | Start with the failed v1 trace. Scrub v8 across the shaded pause into the second step. | “The first carousel stalled. In the repair, the motor keeps turning while the wheel holds its position, then advances exactly one station. In a separate run, removing the drive pin stopped the wheel.” |
| Marble elevator, 14 s | Scrub both versions through the tip, then hold on the receiver result. | “The first elevator dropped the marble. Muse’s revised cup tips it onto a chute. The loose marble rolls into the catch cup and stays there for four seconds. With tipping disabled, the same elevator still lifts, but the marble never reaches the cup.” |

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
- Muse marble elevator · `/i/inv_437c3b45e27d4138?replay=1&compare=1`
- Marble elevator reference · `/i/inv_marble_elevator?replay=1`
- Self-leveling tray · `/i/inv_f72fb06c611342eb?replay=1`
- Gravity Clock · `/i/inv_a1f1665e649b41c2`
- Cargo Crane · `/i/inv_0868f2ea889f4bcc`

Confirm the deployment preserved these records before publishing the links.
