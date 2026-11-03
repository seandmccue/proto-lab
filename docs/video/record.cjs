const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const OUT = process.argv[2]; const BASE = 'https://protolab.sean-abc.workers.dev';
const timeline = {};
const mark = (clip, label, t0) => { (timeline[clip] ??= []).push({ t: +((Date.now() - t0) / 1000).toFixed(1), label }); };
async function clip(name, fn) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, recordVideo: { dir: OUT, size: { width: 1600, height: 900 } } });
  const page = await ctx.newPage(); const t0 = Date.now();
  try { await fn(page, (l) => mark(name, l, t0)); } catch (e) { mark(name, 'ERROR ' + e.message.slice(0, 120), t0); }
  const video = page.video(); await ctx.close(); await browser.close();
  const p = await video.path(); fs.renameSync(p, path.join(OUT, name + '.webm'));
  fs.writeFileSync(path.join(OUT, 'timeline.json'), JSON.stringify(timeline, null, 2));
}
(async () => {
  // 1. Full live build: walker that walks and dances (hero)
  await clip('build', async (page, m) => {
    await page.goto(BASE + '/', { waitUntil: 'networkidle' }); await page.waitForTimeout(2500); m('home');
    const box = page.getByRole('textbox').first(); await box.click(); await page.waitForTimeout(600);
    const prompt = 'Build a small four-legged robot that walks forward on a tabletop, then dances.';
    for (const ch of prompt) { await box.type(ch, { delay: 0 }); await page.waitForTimeout(28); }
    await page.waitForTimeout(900); m('typed');
    await page.getByRole('button', { name: /build live|build this/i }).first().click(); m('submitted');
    await page.waitForURL(/\/i\//, { timeout: 30000 }); m('workbench');
    const seen = new Set();
    for (let i = 0; i < 150; i++) { // up to 5 min
      await page.waitForTimeout(2000);
      const txt = (await page.textContent('body')) || '';
      for (const [k, re] of Object.entries({ parts: /parts? picked|Parts bin|parts bin/i, assembling: /assembling|Live assembly|components placed|parts placed/i, testing: /Testing:|Simulation|simulat/i, passed: /tests passed|Test passed|Simulation passed/i, dance: /dance/i })) { if (!seen.has(k) && re.test(txt)) { seen.add(k); m(k); } }
      if (/tests passed/i.test(txt) && /dance/i.test(txt) && seen.has('passed')) { await page.waitForTimeout(6000); m('done'); break; }
      if (/did not pass|The build stopped/i.test(txt) && i > 20) { m('failed'); break; }
    }
    // orbit the finished model a little
    const c = await page.locator('canvas').first().boundingBox().catch(() => null);
    if (c) { const cx = c.x + c.width / 2, cy = c.y + c.height / 2; await page.mouse.move(cx, cy); await page.mouse.down(); for (let k = 1; k <= 40; k++) { await page.mouse.move(cx + k * 6, cy + Math.sin(k / 6) * 20); await page.waitForTimeout(30); } await page.mouse.up(); m('orbit'); }
    await page.waitForTimeout(2500);
  });
  // 2. Crab repair replay: before / after
  await clip('crab', async (page, m) => {
    await page.goto(BASE + '/i/inv_633b4887ad7f4cdc?replay=1', { waitUntil: 'networkidle' }); await page.waitForTimeout(3000); m('replay');
    const before = page.getByText(/Before revision|Before/i).first(); if (await before.count()) { await before.click().catch(() => {}); await page.waitForTimeout(5000); m('before'); }
    const after = page.getByText(/After revision|After/i).first(); if (await after.count()) { await after.click().catch(() => {}); await page.waitForTimeout(6000); m('after'); }
    const cmp = page.getByText(/Compare/i).first(); if (await cmp.count()) { await cmp.click().catch(() => {}); await page.waitForTimeout(7000); m('compare'); }
  });
  // 3. Gallery
  await clip('gallery', async (page, m) => {
    await page.goto(BASE + '/gallery', { waitUntil: 'networkidle' }); await page.waitForTimeout(2500); m('gallery');
    for (let k = 0; k < 12; k++) { await page.mouse.wheel(0, 60); await page.waitForTimeout(120); }
    await page.waitForTimeout(1500); const card = page.locator('a[href^="/i/"]').first(); const b = await card.boundingBox().catch(() => null); if (b) { await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(3500); m('hover'); }
  });
  // 4. Workbench interactions on the featured walker: explode, blueprint, parts
  await clip('workbench', async (page, m) => {
    await page.goto(BASE + '/i/inv_bb9d5f8a170d4d95', { waitUntil: 'networkidle' }); await page.waitForTimeout(3500); m('open');
    const c = await page.locator('canvas').first().boundingBox().catch(() => null);
    if (c) { const cx = c.x + c.width / 2, cy = c.y + c.height / 2; await page.mouse.move(cx, cy); await page.mouse.down(); for (let k = 1; k <= 50; k++) { await page.mouse.move(cx + k * 5, cy - k); await page.waitForTimeout(30); } await page.mouse.up(); m('orbit'); await page.waitForTimeout(1500); }
    const explode = page.locator('input[aria-label="Explode view"]').first(); if (await explode.count()) { for (const val of ['0.3', '0.6', '0.9', '1']) { await explode.fill(val).catch(() => {}); await page.waitForTimeout(500); } m('exploded'); await page.waitForTimeout(2500); await explode.fill('0').catch(() => {}); await page.waitForTimeout(1200); }
    const bp = page.getByRole('button', { name: /blueprint/i }).first(); if (await bp.count()) { await bp.click().catch(() => {}); m('blueprint'); await page.waitForTimeout(3000); await bp.click().catch(() => {}); }
    const tests = page.getByRole('button', { name: /^tests$/i }).first(); if (await tests.count()) { await tests.click().catch(() => {}); m('tests'); await page.waitForTimeout(3500); }
  });
  console.log(JSON.stringify(timeline));
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
