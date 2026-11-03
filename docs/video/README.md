# Judge video (generated)

A ~90 s MP4 for judges: high-contrast title slides, real screen recordings of the public app
(a live walk-and-dance build, the crab's failed-then-fixed replay, the workbench, the gallery) and
a system-voice narration. Everything is generated; nothing is staged.

```bash
cd docs/video
npm i playwright            # once; uses the cached Chromium
node record.cjs ./clips     # records four clips from https://protolab.sean-abc.workers.dev (≈3 min, one live build)
node slides.cjs ./slides    # renders the title slides at 1920×1080
mkdir -p captions && node captions.cjs ./captions   # transparent caption overlays for the footage (readable muted)
mkdir -p audio && while IFS='|' read -r id text; do say -v Samantha -r 178 -o "audio/seg$id.aiff" "$text"; ffmpeg -y -loglevel error -i "audio/seg$id.aiff" -ar 48000 -ac 2 "audio/seg$id.wav"; done < narration.txt
node assemble.cjs           # cuts, time-lapses the waits, mixes narration → protolab-judge-demo.mp4
```

`assemble.cjs` carries the cut points as seconds into each recording; after a fresh recording, check
the contact sheet (`ffmpeg -i clips/build.webm -vf "fps=1/3,scale=480:-1,tile=4x6" -frames:v 1 sheet.png`)
and adjust them. Requires ffmpeg and macOS `say`.
