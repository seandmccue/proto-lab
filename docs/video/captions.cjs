const { chromium } = require('playwright');
const OUT = process.argv[2];
const captions = {
  describe: 'Describe it in one sentence.',
  parts: 'Muse picks real parts and designs the missing ones.',
  assemble: 'Assembled part by part at real connectors.',
  walk: 'A physics simulator measures the walk.',
  crab: 'Failed test → Muse Wonder’s fix → passed.',
  dance: 'Walk 0.51 m · Dance 13° swing · both measured.',
  orbit: 'Tests passed. Explore it in 3D.',
  workbench: 'Explode it, replay every test, read the numbers.',
  gallery: 'Publish it. Remix it.',
};
const html = (text) => `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:1920px;height:1080px;background:transparent;font-family:-apple-system,"SF Pro Display","Helvetica Neue",Inter,Arial,sans-serif}
.cap{position:absolute;left:72px;bottom:64px;max-width:1500px;padding:22px 34px;border-radius:18px;background:rgba(11,10,18,0.82);color:#fff;font-size:48px;font-weight:700;letter-spacing:-0.02em;line-height:1.15;box-shadow:0 12px 40px rgba(0,0,0,.35)}
.cap b{color:#c4b5fd}
</style></head><body><div class="cap">${text}</div></body></html>`;
(async () => {
  const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  for (const [id, text] of Object.entries(captions)) { await page.setContent(html(text)); await page.waitForTimeout(80); await page.screenshot({ path: `${OUT}/${id}.png`, omitBackground: true }); }
  await browser.close(); console.log('captions:', Object.keys(captions).length);
})();
