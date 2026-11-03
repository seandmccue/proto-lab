const { chromium } = require('playwright');
const fs = require('fs');
const OUT = process.argv[2];
const slides = [
  { id: '01-images', lines: ['Generative AI', 'makes images and video.'], sub: '', theme: 'dark' },
  { id: '02-screens', lines: ['Until now,', 'it lived on screens.'], sub: '', theme: 'dark' },
  { id: '03-intro', lines: ['Introducing ProtoLab'], sub: 'Generative AI for physical, real-world products', theme: 'violet' },
  { id: '04-muse', lines: ['Powered by', 'Meta Muse Spark & Muse Wonder'], sub: 'Spark designs. Wonder fixes what fails.', theme: 'dark' },
  { id: '05-describe', lines: ['1 · Describe it.'], sub: 'One sentence is the whole brief.', theme: 'light' },
  { id: '06-parts', lines: ['2 · Pick and design the parts.'], sub: 'A real component library. Missing parts are designed on the spot.', theme: 'light' },
  { id: '07-assemble', lines: ['3 · Assemble the prototype.'], sub: 'Mounted at real connectors, part by part.', theme: 'light' },
  { id: '08-simulate', lines: ['4 · Simulate. Fail. Iterate.'], sub: 'Rigid-body physics measures it. Muse revises from the numbers.', theme: 'light' },
  { id: '09-pass', lines: ['5 · Until it passes.'], sub: 'Every claim is a measured test.', theme: 'light' },
  { id: '10-print', lines: ['6 · 3D-print the parts.'], sub: 'Coming soon', theme: 'violet' },
  { id: '11-close', lines: ['Think SolidWorks,', 'powered by AI.'], sub: 'Anyone can build physical products.  ·  protolab.sean-abc.workers.dev', theme: 'dark' },
];
const html = (s) => {
  const bg = s.theme === 'dark' ? '#0b0a12' : s.theme === 'violet' ? '#4c1d95' : '#f7f6fb';
  const fg = s.theme === 'light' ? '#0b0a12' : '#ffffff';
  const accent = s.theme === 'light' ? '#6d28d9' : s.theme === 'violet' ? '#e9d5ff' : '#a78bfa';
  const size = s.lines.join(' ').length > 30 ? 104 : 136;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:1920px;height:1080px;background:${bg};color:${fg};font-family:-apple-system,"SF Pro Display","Helvetica Neue",Inter,Arial,sans-serif;-webkit-font-smoothing:antialiased}
  .wrap{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;align-items:flex-start;padding:0 160px;gap:28px}
  h1{margin:0;font-size:${size}px;line-height:1.02;font-weight:800;letter-spacing:-0.035em;max-width:1600px}
  h1 em{font-style:normal;color:${accent}}
  p{margin:0;font-size:44px;font-weight:500;color:${s.theme === 'light' ? '#4b4766' : 'rgba(255,255,255,0.78)'};letter-spacing:-0.01em;max-width:1500px}
  .brand{position:absolute;left:160px;bottom:72px;font-size:30px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:${accent};opacity:.9}
  .bar{position:absolute;left:160px;top:120px;width:140px;height:12px;border-radius:6px;background:${accent}}
  </style></head><body><div class="bar"></div><div class="wrap"><h1>${s.lines.map((l, i) => i === s.lines.length - 1 && s.lines.length > 1 ? `<em>${l}</em>` : l).join('<br>')}</h1>${s.sub ? `<p>${s.sub}</p>` : ''}</div><div class="brand">ProtoLab · Meta Muse Hackathon</div></body></html>`;
};
(async () => {
  const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  for (const s of slides) { await page.setContent(html(s)); await page.waitForTimeout(150); await page.screenshot({ path: `${OUT}/${s.id}.png` }); }
  await browser.close(); console.log('slides:', fs.readdirSync(OUT).filter((f) => f.endsWith('.png')).length);
})();
