# ProtoLab judge demo

## 73-second recording

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

1. In a signed-out browser, run preflight against the deployed URL and open the saved walker and dragonfly workbenches. Check that both versions play, their test results agree with the recording, and a judge can start a fresh build.
2. Start a fresh flapping butterfly or Ferris wheel with the judge’s choice of constraint. Leave that tab open while showing the saved dragonfly remix. Use the 3D stage, the version controls, and the Tests tab to show the failure, the rear-hinge edit, and the retest.
3. Return to the live job when it has reached a milestone. If it is still processing, show the actual current stage and finish the saved walkthrough. Keep the labels for live jobs and saved simulation distinct.
4. If asked how Meta’s models participate, open the saved crab v3 and v4. Spark’s failed v3 traveled 0.27 cm at 14.28° tilt. Wonder’s revision restored a uniform stance and wave gait and passed at 31.73 cm at 4.72° tilt.
5. Show the parts panel or exploded view if asked what was built. Explain that the saved metrics are from rigid-body simulation and that the flapping test measures joint movement and contact.

## Saved run routes

- Walker · `/i/inv_bb9d5f8a170d4d95`
- Dragonfly · `/i/inv_fd8fcc242ed8497f`
- Crab · `/i/inv_633b4887ad7f4cdc`

Confirm the deployment preserved these records before publishing the links.
