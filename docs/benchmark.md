# ProtoLab agent benchmark

Model: muse-spark-1.3 · specialist: muse-wonder-1.0 after 3 failures · 20 runs · 2026-11-03T02:06:38.989Z

| Metric | Value |
| --- | --- |
| Success rate (walk + requested follow-ups passed) | 95 % |
| Errors (API/model) | 0 % |
| Median completion time | 36.4 s |
| Mean iterations (versions) | 3.0 |
| Runs with ≥1 meaningful revision citing a measurement | 100 % |
| Runs that failed a walk test and later passed one | 95 % |
| Runs using sweep_gait | 80 % |
| Runs creating a custom part | 15 % |
| Runs escalated to the specialist | 25 % |

| Prompt | Runs | Passed | Median time | Mean iterations | Escalations |
| --- | --- | --- | --- | --- | --- |
| muse | 4 | 4/4 | 41.5 s | 2.8 | 1 |
| hexapod | 4 | 4/4 | 30 s | 2.3 | 0 |
| crawler | 4 | 4/4 | 45 s | 2.8 | 1 |
| sprinter | 4 | 4/4 | 149.6 s | 3.8 | 2 |
| pet | 4 | 3/4 | 36.4 s | 3.8 | 1 |

## Runs
| Prompt | # | Status | s | Iter | Sweeps | Custom | Handoffs | Best walk | Note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| crawler | 1 | passed | 36.1 | 2 | 1 | 0 | 0 | 0.387 m | Quadruped crawler on 160mm chassis with 60mm leg bars and MG996R servos. Initial MG90S build walked only 0.15m and exceeded torque ratings;  |
| muse | 1 | passed | 38 | 2 | 1 | 0 | 0 | 0.3685 m | Built 4-legged Muse walker: 160mm chassis, MG996R 1.1Nm servos, 60mm leg bars, 24mm foot pads with shell. First walk test failed at 0.15m vs |
| hexapod | 1 | passed | 44.8 | 3 | 1 | 0 | 0 | 0.6958 m | Six-legged walker (chassis-hex-200, 12x DS3218 2.0 Nm servos, 60 mm leg bars, tripod gait at 1.1 Hz / 0.42 rad). Walk test measured 0.70 m i |
| pet | 1 | passed | 32.6 | 2 | 1 | 0 | 0 | 0.499 m | Quadruped pet on 160mm chassis with 60mm legs and big 32mm feet. Walk test: 0.499m in 6s, 4.9deg tilt, torques within 1.1Nm servo ratings. F |
| hexapod | 2 | passed | 28.3 | 2 | 0 | 0 | 0 | 0.7469 m | Six-legged walker on chassis-hex-200 with 60mm leg bars and foot-pad-12 feet, tripod gait at 1.0Hz with 0.4rad hip swing. First test with MG |
| muse | 2 | passed | 41.5 | 3 | 1 | 0 | 0 | 0.3053 m | Muse-inspired quadruped: chassis-quad-160 with shell/eyes, 8x DS3218 2.0Nm servos, 60mm leg bars, 24mm foot pads. Walk passed 0.305m in 6s ( |
| sprinter | 2 | passed | 17.7 | 2 | 0 | 0 | 0 | 0.4465 m | Quadruped with 160mm chassis, MG996R 1.1Nm servos, 60mm leg bars. First walk test covered 0.45m but torque (0.53/0.81Nm) exceeded MG90S 0.22 |
| crawler | 2 | passed | 22.9 | 2 | 0 | 0 | 0 | 0.3366 m | Quadruped crawler on 160mm chassis with 60mm leg bars and MG996R 1.1Nm servos. Walk test measured 0.34m in 6s with 4.0° max tilt. First buil |
| hexapod | 3 | passed | 24 | 2 | 0 | 0 | 0 | 0.7404 m | Six-legged tripod walker on chassis-hex-200 with 60mm leg bars and DS3218 2.0Nm servos. Walk test measured 0.61m in 6s with 10.1° max tilt,  |
| muse | 3 | passed | 31.9 | 2 | 1 | 0 | 0 | 0.4465 m | Built a 4-legged Muse-bot (chassis-quad-160, 8x MG996R servos, 60mm leg bars, 24mm foot pads, eye-dome shell, 0.59kg). Walk test passed: 0.4 |
| sprinter | 1 | passed | 149.6 | 5 | 3 | 1 | 4 | 0.4554 m | Four-legged crawler with custom 190x120mm low chassis, 80mm leg bars, MG996R 1.1Nm servos, crawl gait 0.9Hz 0.35rad amplitude 0.5 knee lift. |
| sprinter | 3 | passed | 32.1 | 3 | 1 | 0 | 0 | 0.4499 m | Quadruped (160mm chassis, 60mm leg bars, MG996R servos) walked 0.44m in 6s with 6.9° tilt. Initial MG90S build was fast but over torque; hea |
| pet | 3 | passed | 27.6 | 2 | 1 | 0 | 0 | 0.499 m | Quadruped pet robot: chassis-quad-160, MG996R 1.1Nm hip/knee servos, 60mm leg bars, big 32mm foot pads. Crawl gait 1.0Hz, 0.38rad swing, kne |
| crawler | 3 | passed | 87.4 | 4 | 2 | 0 | 2 | 0.3025 m | Calm 4-leg crawler: 120mm chassis, 80mm upper/lower legs, DS3218 hips + MG996R knees, crawl 0.7Hz/0.30rad/0.3 knee lift. Final walk_4: 0.303 |
| hexapod | 4 | passed | 30 | 2 | 1 | 0 | 0 | 0.7469 m | Six-legged walker on chassis-hex-200 with 60mm leg bars, foot-pad-12, and DS3218 2.0Nm servos. Tripod gait at 1.0Hz, 0.40rad hip swing. Walk |
| crawler | 4 | passed | 45 | 3 | 2 | 0 | 0 | 0.3657 m | Quadruped crawler with 160mm chassis, 60mm leg bars, MG996R 1.1Nm servos. Initial MG90S build walked far but torque 0.61Nm exceeded 0.22Nm r |
| muse | 4 | passed | 107.8 | 4 | 2 | 0 | 2 | 0.3064 m | Quadruped Muse walker: 220x100mm chassis, 80mm upper/lower legs, 2.0Nm servos, crawl 0.28rad/0.8Hz. Walk measured 0.306m in 6s with 4.1deg t |
| pet | 4 | passed | 36.4 | 2 | 1 | 0 | 0 | 0.499 m | Quadruped pet robot with 160mm chassis, 60mm leg bars, big 32mm foot pads and shell. Walk test: 0.499m in 6s, 4.9° tilt, torques 0.52/0.83 N |
| pet | 2 | failed | 268.1 | 9 | 3 | 3 | 4 | 0.4234 m | Quadruped pet robot with big 32mm feet: chassis-quad-120, 40mm leg bars, MG996R 1.1Nm servos, crawl gait 0.9Hz/0.42rad/knee 0.45, stiffness  |
| sprinter | 4 | passed | 357.8 | 5 | 3 | 2 | 4 | 0.4861 m | Quadruped (chassis-quad-160, custom 70mm leg bars, custom 2.5 N·m servos, foot-pad-12) walks 0.486m in 6s with 7.4° max tilt. Iterations: MG |
