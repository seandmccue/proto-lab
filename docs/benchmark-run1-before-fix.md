# ProtoLab agent benchmark

Model: muse-spark-1.3 · specialist: muse-wonder-1.0 after 3 failures · 20 runs · 2026-11-03T01:56:47.965Z

| Metric | Value |
| --- | --- |
| Success rate (walk + requested follow-ups passed) | 80 % |
| Errors (API/model) | 15 % |
| Median completion time | 41 s |
| Mean iterations (versions) | 3.1 |
| Runs with ≥1 meaningful revision citing a measurement | 100 % |
| Runs that failed a walk test and later passed one | 80 % |
| Runs using sweep_gait | 85 % |
| Runs creating a custom part | 20 % |
| Runs escalated to the specialist | 20 % |

| Prompt | Runs | Passed | Median time | Mean iterations | Escalations |
| --- | --- | --- | --- | --- | --- |
| muse | 4 | 3/4 | 74.5 s | 3.8 | 1 |
| hexapod | 4 | 4/4 | 31.6 s | 2.5 | 0 |
| crawler | 4 | 4/4 | 35.5 s | 2.3 | 0 |
| sprinter | 4 | 1/4 | 134.3 s | 4.8 | 3 |
| pet | 4 | 4/4 | 42 s | 2.5 | 0 |

## Runs
| Prompt | # | Status | s | Iter | Sweeps | Custom | Handoffs | Best walk | Note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| crawler | 1 | passed | 33.8 | 2 | 1 | 0 | 0 | 0.3827 m | Quadruped crawler with 160mm chassis, 60mm leg bars, MG996R servos. Walk test measured 0.38m in 6s with 5.1° max tilt, passing 0.25m/25° tar |
| hexapod | 1 | passed | 41 | 4 | 1 | 0 | 0 | 0.7251 m | Six-legged walker on chassis-hex-200 with 60mm leg bars, DS3218 hips (2.0Nm) and high-torque knees (3.5Nm), tripod gait 0.42rad at 1.2Hz. Fi |
| muse | 1 | passed | 55.7 | 3 | 2 | 0 | 0 | 0.3827 m | Quadruped Muse walker (160mm chassis, 60mm legs, MG996R servos, shell). Walk test 3 measured 0.38m in 6s with 5.1° max tilt and 0.74/0.66Nm  |
| pet | 1 | passed | 51.6 | 3 | 2 | 0 | 0 | 0.4234 m | Quadruped pet on 160mm chassis with 60mm leg bars, big 32mm foot pads, and MG996R 1.1Nm servos. Walk passed: 0.41m in 6s, tilt 5.4deg, torqu |
| hexapod | 2 | passed | 31.6 | 2 | 1 | 0 | 0 | 0.7469 m | Six-legged tripod walker on chassis-hex-200 with 60mm leg bars and DS3218 2.0Nm servos. First build with MG90S walked 0.75m but torque 1.02/ |
| crawler | 2 | passed | 35.5 | 3 | 1 | 0 | 0 | 0.3657 m | Quadruped crawler on 160mm chassis with 60mm leg bars and MG996R servos (1.1 Nm). Initial MG90S build walked 0.37m at 4.8° tilt but torque 0 |
| pet | 2 | passed | 37.4 | 2 | 0 | 0 | 0 | 0.499 m | Quadruped pet robot: 160mm chassis, 60mm leg bars, big 32mm foot pads, MG996R 1.1Nm servos, crawl gait 1.0Hz/0.38rad. Walk measured 0.50m in |
| muse | 3 | passed | 30.8 | 2 | 1 | 0 | 0 | 0.3398 m | Quadruped Muse walker: 160mm chassis, DS3218 2.0Nm servos, 60mm legs, crawl gait 0.9Hz/0.38rad. Walk measured 0.34m in 6s with 6deg tilt; da |
| sprinter | 2 | error | 106 | 4 | 3 | 0 | 3 | 0.3402 m | Meta Model API error from muse-wonder-1.0: HTTP 400 {"error":{"code":null,"message":"assistant message must have `content` or `tool_calls`", |
| hexapod | 3 | passed | 22 | 2 | 0 | 0 | 0 | 0.7469 m | Six-legged tripod walker on chassis-hex-200 with 60mm leg bars and DS3218 2.0Nm servos. First build walked 0.75m but torque (1.02/1.43Nm) ex |
| muse | 2 | error | 180.2 | 4 | 3 | 2 | 3 | 0.2512 m | Meta Model API error from muse-wonder-1.0: HTTP 400 {"error":{"code":null,"message":"assistant message must have `content` or `tool_calls`", |
| crawler | 3 | passed | 33.2 | 2 | 1 | 0 | 0 | 0.3053 m | Quadruped crawler (chassis-quad-160, 60mm leg bars, DS3218 2.0Nm servos) passed walk: 0.305m in 6s with 5.5° max tilt. Initial MG90S build f |
| sprinter | 1 | failed | 243.4 | 9 | 3 | 3 | 4 | 0.397 m | Quadruped (chassis-quad-160, 8x MG996R 1.1Nm, custom 70-72mm leg bars, 24mm foot pads, crawl 0.35rad/0.9Hz). Best measured walk_4: 0.397m in |
| sprinter | 3 | passed | 33.9 | 3 | 1 | 0 | 0 | 0.4499 m | Quadruped (160mm chassis, 60mm leg bars, MG996R 1.1Nm servos) walks 0.44m in 6s with 6.9° tilt. Initial MG90S build walked 0.45m but torque  |
| pet | 3 | passed | 42 | 3 | 1 | 0 | 0 | 0.4234 m | Quadruped pet robot: 160mm chassis, 60mm leg bars, big 32mm foot pads, 8x MG996R 1.1Nm servos, crawl gait 0.8Hz/0.38rad. Walk measured 0.365 |
| hexapod | 4 | passed | 27.2 | 2 | 0 | 0 | 0 | 0.7469 m | Six-legged tripod walker on chassis-hex-200 with 60mm leg bars and DS3218 2.0 Nm servos. First build with MG90S walked 0.75m but torque dema |
| crawler | 4 | passed | 43.8 | 2 | 1 | 0 | 0 | 0.3685 m | Quadruped crawler on 160mm chassis with 60mm legs, MG996R servos, 0.9 Hz crawl (0.38 rad stride, 0.4 rad lift, feet under hips). Walk test p |
| pet | 4 | passed | 28.5 | 2 | 1 | 0 | 0 | 0.499 m | Quadruped pet robot (160mm chassis, 60mm leg bars, big 32mm foot pads) passed walk (0.499m in 6s, 4.9° tilt) and dance (in place, 1.07° tilt |
| muse | 4 | passed | 74.5 | 6 | 1 | 1 | 0 | 0.306 m | Quadruped Muse walker: 160mm chassis, 60mm leg bars, MG996R 1.1Nm servos, crawl gait 0.9Hz/0.4rad. Walk measured 0.306m in 6s with 9.8deg ma |
| sprinter | 4 | error | 134.3 | 3 | 3 | 1 | 1 | 0.1698 m | Meta Model API error from muse-wonder-1.0: HTTP 400 {"error":{"code":null,"message":"assistant message must have `content` or `tool_calls`", |
