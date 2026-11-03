# ProtoLab submission draft

**Track and theme** · Indie Developer · Push the Frontier

## One-liner

Describe a machine. Meta Muse assembles a prototype, tests its motion, and revises it using measured results you can replay in 3D.

## Short description

A student robotics club should be able to find out why a mechanism jams before cutting its first part. ProtoLab turns a plain-English brief into an interactive mechanical prototype. Muse Spark selects or designs parts, assembles them at connectors, specifies a test, and uses Rapier’s measurements to revise the design. In a saved butterfly-to-dragonfly remix, the first test found two wings touching. Muse moved the rear hinges back, then the same test ran at 2 Hz with zero detected wing contacts. Open the saved tests, inspect the parts, and remix the prototype in your browser.

## What to show

- **One request, two measured outcomes.** “Give it four wings like a dragonfly.” The first test detected contact between the right forewing and hind wing. Muse Spark cited the contact, remounted the rear wings farther back, and reran the test. The revised rig flapped at 2 Hz with zero detected wing contacts and peak motor demand of 0.126 N·m against a 0.2 N·m rating.
- **A robot that learns a longer walk.** The saved walker’s first passing walk covered 30.75 cm. A follow-up asked for at least 45 cm in six seconds. It measured 42.97 cm on the first attempt and 47.15 cm after revision. The separate saved dance test passed at 2.4° maximum tilt.
- **A real model handoff.** After three failed tests on the saved crab, Muse Wonder cited problems with foot placement and the previous gait, then restored a uniform leg pose and wave gait. The crab went from 0.27 cm and 14.28° tilt to 31.73 cm and 4.72° on the next test. The activity record identifies the model behind each version.

## How it works

Muse Spark 1.3 proposes the plan, issues structured assembly and controller operations, defines tests, and revises from the results. ProtoLab validates those operations and applies generic assembly rules. Rapier runs the rigid-body simulation and records the measurements and motion trace. Muse Wonder 1.0 can diagnose a run after repeated failures, with the handoff visible in the saved history. The application records actual versions and tool actions. The featured gallery contains saved runs that can be inspected and replayed.

The v10 general mechanism benchmark recorded ten passes across ten briefs and no API errors in that run. Earlier runs and their failures are included in the benchmark notes. These are measured runs on the documented engine snapshot. The simulator checks defined motion criteria. Flight, deformation, and physical fabrication are outside the demonstrated scope.

## Submission links and checks

- Live app · https://protolab.sean-abc.workers.dev
- Robot repair replay · https://protolab.sean-abc.workers.dev/i/inv_bb9d5f8a170d4d95?replay=1
- Dragonfly replay · https://protolab.sean-abc.workers.dev/i/inv_fd8fcc242ed8497f?replay=1
- Judge video · https://protolab.sean-abc.workers.dev/judge-demo.mp4
- Public source repository · https://github.com/seandmccue/proto-lab
- Deployed release branch · https://github.com/seandmccue/proto-lab/tree/codex/protolab-hackathon
- Evidence · [benchmark](benchmark-general.md) and [demo walkthrough](demo-script.md).

The signed-in Cerebral Valley form shows Indie Developer, Push the Frontier, Public GitHub
Repository, and a three-minute demo-video field with a YouTube example. The demo is 73 seconds.
If the form requires a YouTube URL, upload the MP4 as unlisted and check it in a signed-out session.
The participant should supply the required survey answers and decide whether to grant the
portal's publication and promotion permission. Save the receipt after submitting.
