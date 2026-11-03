// Build the judge video: slides + clip excerpts (time-lapsed over waits) + narration, 1920x1080 @30fps.
const { execFileSync } = require('child_process'); const fs = require('fs'); const path = require('path');
const V = __dirname; const CLIPS = path.join(V, 'clips'); const SL = path.join(V, 'slides'); const AU = path.join(V, 'audio'); const SEG = path.join(V, 'segments'); fs.mkdirSync(SEG, { recursive: true });
const tl = JSON.parse(fs.readFileSync(path.join(CLIPS, 'timeline.json'), 'utf8'));
const at = (clip, label, fallback) => { const e = (tl[clip] || []).find((x) => x.label === label); return e ? e.t : fallback; };
const dur = (f) => +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim();
const ff = (args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
const VF = 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=#0b0a12,fps=30,format=yuv420p';
// --- plan ---------------------------------------------------------------------------------------------
const b = 'build', bd = dur(path.join(CLIPS, 'build.webm'));
const tHome = at(b, 'home', 2), tTyped = at(b, 'typed', 8), tSub = at(b, 'submitted', 9), tWb = at(b, 'workbench', 11);
const tAsm = at(b, 'assembling', tWb + 30), tTest = at(b, 'testing', tAsm + 20), tPass = at(b, 'passed', tTest + 10), tDone = at(b, 'done', bd - 3), tOrbit = at(b, 'orbit', bd - 1);
const plan = [
  { slide: '01-images', len: 2.8, narr: '01' },
  { slide: '02-screens', len: 2.9, narr: '02' },
  { slide: '03-intro', len: 5.2, narr: '03' },
  { slide: '04-muse', len: 5.8, narr: '04' },
  { slide: '05-describe', len: 1.8, narr: '05' },
  { clip: b, from: 6.0, to: 18.5, speed: 1.6 },          // typing the brief, Build live
  { slide: '06-parts', len: 1.8, narr: '06' },
  { clip: b, from: 26.5, to: 37.0, speed: 'fit:6' },     // blueprint desk: parts picked and planned
  { slide: '07-assemble', len: 1.8, narr: '07' },
  { clip: b, from: 37.2, to: 44.8, speed: 1 },           // first assembly appears, real time
  { slide: '08-simulate', len: 1.8, narr: '08' },
  { clip: b, from: 52.0, to: 60.0, speed: 1.3 },         // walk test running
  { clip: 'crab', from: 1.0, to: 12.5, speed: 'fit:7' }, // crab: failed revision, Wonder's fix, passed
  { slide: '09-pass', len: 1.8, narr: '09' },
  { clip: b, from: 64.0, to: 75.0, speed: 'fit:8' },     // dance test runs and passes
  { clip: b, from: 85.5, to: 91.0, speed: 1 },           // tests passed, orbit
  { slide: '09b-proof', len: 7.8, narr: '12' },
  { slide: '10-print', len: 3.4, narr: '10' },
  { clip: 'workbench', from: 6.0, to: 20.0, speed: 'fit:7', narr: '11' }, // explode, blueprint, tests
  { clip: 'gallery', from: 2.0, to: 14.0, speed: 'fit:4' },
  { slide: '11-close', len: 6.5 },
];
// --- render segments ----------------------------------------------------------------------------------
const files = []; let t = 0; const narr = [];
plan.forEach((p, i) => {
  const out = path.join(SEG, `seg${String(i).padStart(2, '0')}.mp4`); let len;
  if (p.slide) {
    len = p.len;
    ff(['-loop', '1', '-t', String(len), '-i', path.join(SL, p.slide + '.png'), '-vf', `${VF},fade=t=in:st=0:d=0.35,fade=t=out:st=${(len - 0.35).toFixed(2)}:d=0.35`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-an', out]);
  } else {
    const src = path.join(CLIPS, p.clip + '.webm'); const span = Math.max(0.5, p.to - p.from);
    const speed = typeof p.speed === 'string' ? Math.max(1, span / Number(p.speed.split(':')[1])) : p.speed; len = span / speed;
    ff(['-ss', String(p.from), '-t', String(span), '-i', src, '-vf', `setpts=PTS/${speed.toFixed(4)},${VF},fade=t=in:st=0:d=0.25,fade=t=out:st=${Math.max(0, len - 0.3).toFixed(2)}:d=0.3`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-an', out]);
    len = dur(out);
  }
  if (p.narr) narr.push({ id: p.narr, start: t });
  files.push({ out, len }); t += len;
});
fs.writeFileSync(path.join(SEG, 'list.txt'), files.map((f) => `file '${f.out}'`).join('\n'));
ff(['-f', 'concat', '-safe', '0', '-i', path.join(SEG, 'list.txt'), '-c', 'copy', path.join(SEG, 'video.mp4')]);
// --- narration track: each line starts with its slide; silence elsewhere -------------------------------
const total = t; const inputs = []; const filters = []; const mixIn = [];
narr.forEach((n, k) => { inputs.push('-i', path.join(AU, `seg${n.id}.wav`)); filters.push(`[${k}:a]adelay=${Math.round(n.start * 1000)}|${Math.round(n.start * 1000)},volume=1.0[a${k}]`); mixIn.push(`[a${k}]`); });
filters.push(`${mixIn.join('')}amix=inputs=${narr.length}:normalize=0:dropout_transition=0,apad=whole_dur=${total.toFixed(2)}[mix]`);
ff([...inputs, '-filter_complex', filters.join(';'), '-map', '[mix]', '-t', total.toFixed(2), '-ar', '48000', '-ac', '2', '-c:a', 'aac', '-b:a', '160k', path.join(SEG, 'narration.m4a')]);
ff(['-i', path.join(SEG, 'video.mp4'), '-i', path.join(SEG, 'narration.m4a'), '-c:v', 'copy', '-c:a', 'copy', '-movflags', '+faststart', '-shortest', path.join(V, 'protolab-judge-demo.mp4')]);
console.log(JSON.stringify({ total: +total.toFixed(1), segments: files.map((f) => +f.len.toFixed(1)), narr }));
