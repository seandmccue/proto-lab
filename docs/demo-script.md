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
3. Show the Gravity Clock and Cargo Crane to demonstrate two different mechanisms. In a second tab, start a fresh crane with a constraint the judge chooses. One rehearsal brief asked it to lift a block at least 8 cm, hold it, then lower it to within 2 cm of its start.
4. Return to the live job when it reaches a milestone. Call the recorded crab comparison a saved run and the crane job a live build. Both use simulated motion.

## Saved run routes

- Walker · `/i/inv_bb9d5f8a170d4d95`
- Dragonfly · `/i/inv_fd8fcc242ed8497f`
- Crab comparison · `/i/inv_633b4887ad7f4cdc?replay=1&compare=1`
- Gravity Clock · `/i/inv_a1f1665e649b41c2`
- Cargo Crane · `/i/inv_0868f2ea889f4bcc`

Confirm the deployment preserved these records before publishing the links.
