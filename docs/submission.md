# ProtoLab submission draft

**Track and theme** · Indie Developer · Push the Frontier

## One-liner

Describe a machine. Meta Muse assembles a prototype, tests its motion, and revises it using measured results you can replay in 3D.

## Short description

A student robotics club should be able to find out why a mechanism tips or jams before cutting its first part. ProtoLab turns a plain-English brief into an interactive mechanical prototype. Muse selects or designs parts, assembles them at connectors, and revises the mechanism using measurements from a physics simulation. Watch two versions of the same mechanical crab run side by side. The first barely moves and tilts beyond the limit. Muse Wonder repositions all six legs and adjusts the gait. The next version travels 31.7 cm and stays within the tilt limit. Open the saved tests, inspect the parts, and remix the prototype in your browser.

## What to show

- **One request, two measured outcomes.** “Give it four wings like a dragonfly.” The first test detected contact between the right forewing and hind wing. Muse Spark cited the contact, remounted the rear wings farther back, and reran the test. The revised rig flapped at 2 Hz with zero detected wing contacts and peak motor demand of 0.126 N·m against a 0.2 N·m rating.
- **A robot that learns a longer walk.** The saved walker’s first passing walk covered 30.75 cm. A follow-up asked for at least 45 cm in six seconds. It measured 42.97 cm on the first attempt and 47.15 cm after revision. The separate saved dance test passed at 2.4° maximum tilt.
- **A real model handoff.** After three failed tests on the saved crab, Muse Wonder cited problems with foot placement and the previous gait, then restored a uniform leg pose and wave gait. The crab went from 0.27 cm and 14.28° tilt to 31.73 cm and 4.72° on the next test. The activity record identifies the model behind each version.

## How it works

Muse Spark 1.3 proposes the plan, issues structured assembly and controller operations, defines tests, and revises from the results. ProtoLab validates those operations and applies generic assembly rules. Rapier runs the rigid-body simulation and records the measurements and motion trace. Muse Wonder 1.0 can diagnose a run after repeated failures, with the handoff visible in the saved history. The application records actual versions and tool actions. The featured gallery contains saved runs that can be inspected and replayed.

The general mechanism benchmark (ten briefs: butterfly, Ferris wheel, walker, catapult, crab, claw, windmill, drawbridge, crane, a novel garden gadget) has recorded four consecutive clean passes, 10 of 10 each with no API errors and no specialist escalation, at medians of 96 s, 102 s, 61 s and 56 s; 122 of 130 runs across thirteen passes in all, and the 20-run walker reliability set is 20 of 20 at median 81 s. Earlier runs and their failures are included in the benchmark notes. These are measured runs on the documented engine snapshot. The simulator checks defined motion criteria. Flight, deformation, and physical fabrication are outside the demonstrated scope.

## Submission links and checks

- Live app · https://protolab.sean-abc.workers.dev
- Crab side-by-side replay · https://protolab.sean-abc.workers.dev/i/inv_633b4887ad7f4cdc?replay=1&compare=1
- Gravity Clock · https://protolab.sean-abc.workers.dev/i/inv_a1f1665e649b41c2
- Cargo Crane · https://protolab.sean-abc.workers.dev/i/inv_0868f2ea889f4bcc
- Robot repair replay · https://protolab.sean-abc.workers.dev/i/inv_bb9d5f8a170d4d95?replay=1
- Dragonfly replay · https://protolab.sean-abc.workers.dev/i/inv_fd8fcc242ed8497f?replay=1
- Earlier narrated demo · https://protolab.sean-abc.workers.dev/judge-demo.mp4
- Public source repository · https://github.com/seandmccue/proto-lab
- Deployed release branch · https://github.com/seandmccue/proto-lab/tree/codex/simulation-explanations
- Evidence · [benchmark](benchmark-general.md) and [demo walkthrough](demo-script.md).

The signed-in Cerebral Valley form shows Indie Developer, Push the Frontier, Public GitHub
Repository, and a three-minute demo-video field with a YouTube example.
Record the voice-over for the new crab cut. If the form requires a YouTube URL, upload the
finished MP4 as unlisted and check it in a signed-out session.
The participant should supply the required survey answers and decide whether to grant the
portal's publication and promotion permission. Save the receipt after submitting.
