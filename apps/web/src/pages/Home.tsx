import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Header, { useModelInfo } from '../components/Header.tsx';
import { recordedTestSpec } from '../components/BuildProgress.tsx';
import GalleryCard from '../components/GalleryCard.tsx';
import PartInventory from '../components/PartInventory.tsx';
import Viewer from '../components/Viewer.tsx';
import { api, fmt, type Example, type InventionDetail, type InventionPublic, type TestSummary } from '../api.ts';
import type { TestSpec, VersionRecord } from '@protolab/schema';
import { largeShowcases } from '../../../large-showcases.mts';

const steps = [
  { title: 'Describe your idea', detail: 'Tell Muse what you want to build and what it should do. Give it a target, like a crab that scuttles at least 25 cm.' },
  { title: 'Watch Muse assemble it', detail: 'Muse selects parts, connects them in 3D, and sets up the motors and joints that make the prototype move.' },
  { title: 'Run a physics test', detail: 'ProtoLab simulates the motion and measures the result against your goal. Replay the test to see where it passed or failed.' },
  { title: 'See what changes', detail: 'Muse can revise the assembly or motor settings and test again. Compare saved versions to see what improved.' },
];
const crabId = 'inv_633b4887ad7f4cdc';
const drawingReferenceId = 'inv_drawing_automaton';
const drawingReferenceVersionId = 'ver_drawing_automaton_1';
const drawingRemixId = 'inv_76b7fae5bdf941c9';
const gimbalRepairId = 'inv_d3f76fcc393b49d6';
const lotusId = 'inv_ba7b3c7716564397';
const genevaRepairId = 'inv_b99f505fab294915';
const marbleRepairId = 'inv_437c3b45e27d4138';
const referenceIds = [drawingReferenceId, 'inv_triplex_pump', 'inv_twin_drawbridge', 'inv_scissor_lift', 'inv_cam_semaphore', 'inv_two_axis_gimbal', 'inv_geneva_indexer', 'inv_marble_elevator'];

function penPathSize(test: TestSummary | null | undefined) {
  const width = test?.metrics['pen_tip.travel_x_m'];
  const height = test?.metrics['pen_tip.travel_y_m'];
  return width !== undefined && height !== undefined && Number.isFinite(width) && Number.isFinite(height)
    ? `${(width * 1000).toFixed(1)} × ${(height * 1000).toFixed(1)} mm`
    : null;
}

export default function Home() {
  const nav = useNavigate();
  const model = useModelInfo();
  const [prompt, setPrompt] = useState('');
  const [examples, setExamples] = useState<Example[]>([]);
  const [featured, setFeatured] = useState<InventionPublic[]>([]);
  const [recent, setRecent] = useState<InventionPublic[]>([]);
  const [remixes, setRemixes] = useState<InventionPublic[]>([]);
  const [mine, setMine] = useState<InventionPublic[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [crab, setCrab] = useState<InventionDetail | null>(null);
  const [heroVersion, setHeroVersion] = useState<VersionRecord | null>(null);
  const [before, setBefore] = useState<{ version: VersionRecord; test: TestSummary } | null>(null);
  const [earlierHeroDefinition, setEarlierHeroDefinition] = useState<TestSpec>();
  const [showBefore, setShowBefore] = useState(false);
  const [heroPlaying, setHeroPlaying] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [orrery, setOrrery] = useState<InventionPublic | null>(null);
  const [drawingRemix, setDrawingRemix] = useState<InventionPublic | null>(null);
  const [drawingBaseline, setDrawingBaseline] = useState<VersionRecord | null>(null);
  const savedCrab = crab?.invention;
  const hero = savedCrab?.visibility === 'public' && savedCrab.status === 'passed' && savedCrab.latestWalk?.passed ? savedCrab : undefined;
  const heroHistory = crab?.versions;
  const heroId = hero?.id;
  const heroVersionId = hero?.currentVersionId;
  const heroTestId = hero?.latestWalk?.testId;
  const references = referenceIds.flatMap((id) => featured.filter((item) => item.id === id));
  const drawingReference = references.find((item) => item.id === drawingReferenceId);
  const hasFeaturedDrawingBaseline = drawingReference?.currentVersionId === drawingReferenceVersionId;
  const originalPath = penPathSize(hasFeaturedDrawingBaseline
    ? drawingReference?.latestTest
    : drawingBaseline?.tests.at(-1));
  const remixPath = penPathSize(drawingRemix?.latestTest);
  const spotlightId = drawingRemix && originalPath && remixPath ? drawingRemix.id : null;
  const gimbalRepair = featured.find((item) => item.id === gimbalRepairId && item.latestTest?.passed);
  const gimbalTilt = gimbalRepair?.latestTest?.metrics['tray.maxTilt_deg'];
  const lotus = featured.find((item) => item.id === lotusId && item.latestTest?.passed);
  const lotusStroke = lotus?.latestTest?.metrics.synchronizedMinTravel_m ?? NaN;
  const lotusSpread = lotus?.latestTest?.metrics.synchronizedMaxSpread_m ?? NaN;
  const showLotus = lotus && Number.isFinite(lotusStroke) && Number.isFinite(lotusSpread);
  const genevaRepair = featured.find((item) => item.id === genevaRepairId && item.status === 'passed'
    && item.tests.some((test) => test.passed && test.metrics.indexedConsecutiveSteps >= 2));
  const marbleRepair = featured.find((item) => item.id === marbleRepairId && item.status === 'passed'
    && item.tests.some((test) => test.passed && test.metrics.endInHold_s >= 0.75));
  const largeBuilds = largeShowcases.flatMap((showcase) => {
    const item = featured.find((item) => item.id === showcase.inventionId && item.currentVersionId === showcase.versionId &&
      item.visibility === 'public' && item.featured && item.status === 'passed' && item.modelId?.startsWith('muse-') &&
      item.tests.every((test) => test.passed) && showcase.testIds.every((id) => item.tests.some((test) => test.testId === id)));
    return item ? [{ item, showcase }] : [];
  });
  const featuredPrototypes = featured.filter((item) => !referenceIds.includes(item.id) && item.id !== spotlightId &&
    item.id !== gimbalRepair?.id && item.id !== (showLotus ? lotus.id : undefined) && !largeBuilds.some((build) => build.item.id === item.id));
  const recentPrototypes = recent.filter((item) => item.id !== spotlightId);
  const otherRemixes = remixes.filter((item) => item.id !== spotlightId).slice(0, 4);

  useEffect(() => {
    api.examples().then((r) => setExamples(r.examples)).catch(() => {});
    api.gallery('featured', 24).then((r) => setFeatured(r.items)).catch(() => {});
    api.gallery('recent', 24).then((r) => setRecent(r.items.filter((i) => !i.featured))).catch(() => {});
    api.gallery('remixes', 5).then((r) => setRemixes(r.items)).catch(() => {});
    api.mine().then((r) => setMine(r.items)).catch(() => {});
    api.invention(crabId).then(setCrab).catch(() => {});
    api.invention('inv_adc081059ea44ab9').then(({ invention }) => {
      if (invention.visibility === 'public' && invention.status === 'passed') setOrrery(invention);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    api.invention(drawingRemixId).then(({ invention }) => {
      if (!cancelled && invention.visibility === 'public' && invention.sourceInventionId === drawingReferenceId &&
        invention.parentVersionId === drawingReferenceVersionId && invention.modelId?.startsWith('muse-') &&
        invention.latestTest?.passed && penPathSize(invention.latestTest)) setDrawingRemix(invention);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!drawingRemix || hasFeaturedDrawingBaseline) return;
    let cancelled = false;
    api.version(drawingReferenceId, drawingReferenceVersionId, false)
      .then(({ version }) => { if (!cancelled) setDrawingBaseline(version); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [drawingRemix, hasFeaturedDrawingBaseline]);

  useEffect(() => {
    if (!heroId || !heroVersionId) return;
    let cancelled = false;
    api.version(heroId, heroVersionId).then(({ version }) => { if (!cancelled) setHeroVersion(version); }).catch(() => {});
    return () => { cancelled = true; };
  }, [heroId, heroVersionId]);
  useEffect(() => {
    if (!heroId || !heroTestId || !heroHistory) return;
    let cancelled = false;
    const testName = (id: string) => id.replace(/#\d+$/, '');
    void (async () => {
      const latestIndex = heroHistory.findIndex((version) => version.id === heroVersionId);
      let foundBefore = false;
      let definition: TestSpec | undefined;
      for (const version of heroHistory.slice(0, Math.max(latestIndex, 0)).reverse()) {
        const test = !foundBefore && version.tests.find((result) => !result.passed && testName(result.testId) === testName(heroTestId));
        if (!test && definition) continue;
        const detail = await api.version(heroId, version.id, Boolean(test));
        if (cancelled) return;
        if (test) {
          setBefore({ version: detail.version, test });
          foundBefore = true;
        }
        definition ??= recordedTestSpec(heroTestId, [detail.version]);
        if (definition) setEarlierHeroDefinition(definition);
        if (foundBefore && definition) break;
      }
    })().catch(() => {});
    return () => { cancelled = true; };
  }, [heroHistory, heroId, heroTestId, heroVersionId]);

  const heroTest = heroVersion?.tests.find((test) => test.testId === heroTestId);
  const heroDefinition = heroTestId ? recordedTestSpec(heroTestId, [heroVersion]) ?? earlierHeroDefinition : undefined;
  const activeVersion = showBefore && before ? before.version : heroVersion;
  const activeTest = showBefore && before ? before.version.tests.find((test) => test.testId === before.test.testId) : heroTest;
  const beforeDistance = before?.test.metrics.distance_m;
  const afterDistance = heroTest?.metrics.distance_m ?? hero?.latestWalk?.metrics.distance_m;
  const replayUrl = hero ? `/i/${hero.id}?replay=1&compare=1` : '/gallery';

  const start = async (body: { prompt?: string; exampleId?: string }) => {
    setBusy(true); setError(null);
    try { const r = await api.create(body); nav(`/i/${r.inventionId}?job=${r.jobId}`); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  };
  const submit = (e: FormEvent) => { e.preventDefault(); if (prompt.trim().length >= 3) void start({ prompt: prompt.trim() }); };

  return (
    <div className="home-page min-h-full">
      <Header />
      <main className="home-shell">
        <section className="lab-hero" aria-labelledby="hero-title">
          <div className="lab-hero-copy">
            <p className="lab-label lab-kicker"><span aria-hidden="true">✦</span> AI prototyping studio</p>
            <h1 id="hero-title">Turn an idea into a <em>3D prototype.</em></h1>
            <p className="lab-intro">Describe a mechanism. Meta Muse assembles it from parts, tests how it moves, and revises it from the results.</p>
            <form onSubmit={submit} className="lab-form">
              <label htmlFor="invention-prompt" className="lab-label">Describe your prototype</label>
              <div className="lab-input">
                <input id="invention-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Build a mechanical crab that scuttles sideways…" maxLength={600} aria-describedby="invention-scope" />
                <button type="submit" className="btn-primary" disabled={busy || prompt.trim().length < 3}>
                  {busy ? 'Starting…' : 'Build live'} <span aria-hidden="true">↗</span>
                </button>
              </div>
              <p id="invention-scope">Tell Muse what to build and how it should move.</p>
            </form>
            {error && <p className="mt-2 text-sm text-rose-700" role="alert">{error}</p>}
            <div className="lab-hero-links">
              <Link to={replayUrl} className="lab-hero-proof">{hero ? 'Watch Muse fix the crab' : 'Explore AI-built prototypes'} <span aria-hidden="true">{hero ? '▶' : '↗'}</span></Link>
              <a href="#how-it-works">See how it works <span aria-hidden="true">↓</span></a>
            </div>
          </div>
          <figure className="lab-art">
            <div className="lab-art-heading">
              <div><span className="lab-label">Recorded physics test</span><h2>Mechanical crab</h2></div>
              {activeTest && <button type="button" className="lab-art-toggle" onClick={() => setHeroPlaying(!heroPlaying)}>{heroPlaying ? 'Pause' : 'Play'} preview</button>}
            </div>
            {heroDefinition?.kind === 'walk' && (
              <p className="lab-art-target">Test goal <strong>≥ {fmt.cm(heroDefinition.minDistance_m)} in {heroDefinition.duration_s} s · ≤ {fmt.deg(heroDefinition.maxTilt_deg)} tilt</strong></p>
            )}
            <div className="lab-art-results" role="group" aria-label="Compare saved crab tests">
              {beforeDistance !== undefined && <button type="button" aria-pressed={showBefore} onClick={() => setShowBefore(true)}><span>v{before?.version.iteration} · Failed</span><strong>{fmt.cm(beforeDistance)}</strong>{before?.test.metrics.maxTilt_deg !== undefined && <span>{fmt.deg(before.test.metrics.maxTilt_deg)} peak tilt</span>}</button>}
              {afterDistance !== undefined && <button type="button" aria-pressed={!showBefore} onClick={() => setShowBefore(false)}><span>{heroVersion ? `v${heroVersion.iteration}` : 'After'} · Passed</span><strong>{fmt.cm(afterDistance)}</strong>{hero?.latestWalk?.metrics.maxTilt_deg !== undefined && <span>{fmt.deg(hero.latestWalk.metrics.maxTilt_deg)} peak tilt</span>}</button>}
            </div>
            <div className="lab-art-stage">
              {activeVersion ? (
                <div className="lab-art-machine" aria-hidden="true">
                  <Viewer assembly={activeVersion.assembly} test={activeTest} playing={heroPlaying} explode={0} blueprint={false} selectedId={null} mini />
                </div>
              ) : hero?.previewUrl ? (
                <img src={hero.previewUrl} alt="Mechanical crab assembly" width="500" height="414" />
              ) : <span className="lab-art-placeholder">Preparing the recorded prototype</span>}
            </div>
            <figcaption>
              {hero && <p>Muse moved the feet under the hips and retimed the gait.</p>}
              <Link to={replayUrl} className="lab-art-link">{hero ? 'Compare both runs in 3D' : 'Explore working prototypes'} <span aria-hidden="true">↗</span></Link>
            </figcaption>
          </figure>
        </section>
        {examples.length > 0 && <div className="lab-examples">
          <span className="lab-label">Try a brief</span>
          <div className="lab-chips">
            {examples.map((ex) => (
              <button key={ex.id} onClick={() => { setPrompt(ex.prompt); document.getElementById('invention-prompt')?.focus(); }} disabled={busy} className={`chip ${ex.id === 'muse' ? 'lab-chip-muse' : ''}`} title={ex.prompt}>
                {ex.id === 'muse' && <span aria-hidden="true">✦</span>}{ex.title}
              </button>
            ))}
          </div>
        </div>}
        {largeBuilds.length > 0 && (
          <section className="lab-section" aria-labelledby="large-builds-title">
            <div className="lab-section-heading">
              <div>
                <span className="lab-label">New · Built by Muse</span>
                <h2 id="large-builds-title">Bigger ideas. More moving parts.</h2>
                <p>Replay the physics tests for Muse’s larger assemblies.</p>
              </div>
            </div>
            <div className="invention-grid invention-grid--showcase">
              {largeBuilds.map(({ item, showcase }) => <GalleryCard key={item.id} item={item} replay showcase={showcase} />)}
            </div>
          </section>
        )}
        {(references.length > 0 || spotlightId || orrery || gimbalRepair || showLotus || genevaRepair || marbleRepair) && (
          <section className="lab-section" aria-labelledby="motion-gallery-title">
            <div className="lab-section-heading">
              <div>
                <span className="lab-label">Mechanism lab</span>
                <h2 id="motion-gallery-title">See mechanisms in motion</h2>
                <p>Replay reference builds to see how motors and passive joints move together. Open a test to inspect the measurements.</p>
              </div>
              {(orrery || genevaRepair || marbleRepair) && <div className="flex flex-wrap gap-2">
                {orrery && <Link to={`/i/${orrery.id}?replay=1&compare=1`} className="btn-secondary">See Muse fix the Moon’s orbit <span aria-hidden="true">↗</span></Link>}
                {genevaRepair && <Link to={`/i/${genevaRepair.id}?replay=1&compare=1`} className="btn-secondary">See Muse fix the jewel carousel <span aria-hidden="true">↗</span></Link>}
                {marbleRepair && <Link to={`/i/${marbleRepair.id}?replay=1&compare=1`} className="btn-secondary">See Muse fix the marble elevator <span aria-hidden="true">↗</span></Link>}
              </div>}
            </div>
            {spotlightId && (
              <article className="lab-test-example mb-4">
                <div>
                  <span className="lab-label">Muse remix</span>
                  <h3>One drawing mechanism, two pen paths</h3>
                  <p>Compare the original linkage with Muse’s remix. The saved simulations measure the width and height of each pen path.</p>
                </div>
                <dl aria-label="Measured pen path width by height">
                  <div><dt>Original reference</dt><dd>{originalPath}</dd></div>
                  <div><dt>Muse remix</dt><dd>{remixPath}</dd></div>
                </dl>
                <Link to={`/i/${spotlightId}?replay=1&compare=1`} className="btn-secondary">Compare pen paths <span aria-hidden="true">↗</span></Link>
              </article>
            )}
            {gimbalRepair && Number.isFinite(gimbalTilt) && (
              <article className="lab-test-example mb-4">
                <div>
                  <span className="lab-label">Muse repair</span>
                  <h3>Two motors move. The camera stays level.</h3>
                  <p>Watch the first tray tip, then see how Muse’s revision holds it level through both powered sweeps.</p>
                </div>
                <dl aria-label="Measured peak tray tilt">
                  <div><dt>Passing revision</dt><dd>{gimbalTilt?.toFixed(2)}°</dd></div>
                  <div><dt>Maximum allowed</dt><dd>10°</dd></div>
                </dl>
                <Link to={`/i/${gimbalRepair.id}?replay=1&compare=1`} className="btn-secondary">Compare gimbal simulations <span aria-hidden="true">↗</span></Link>
              </article>
            )}
            {showLotus && (
              <article className="lab-test-example mb-4">
                <div>
                  <span className="lab-label">One actuator</span>
                  <h3>Six petals bloom together</h3>
                  <p>One sliding collar pulls six passive linkages. Scrub the saved runs to see the flower open and track how closely the tips move together.</p>
                </div>
                <dl aria-label="Measured lotus motion">
                  <div><dt>Shortest tip stroke</dt><dd>{(lotusStroke * 1000).toFixed(1)} mm</dd></div>
                  <div><dt>Peak tip motion spread</dt><dd>{(lotusSpread * 1000).toFixed(2)} mm</dd></div>
                </dl>
                <Link to={`/i/${lotus.id}?replay=1&compare=1`} className="btn-secondary">Compare lotus simulations <span aria-hidden="true">↗</span></Link>
              </article>
            )}
            {references.length > 0 && <div className="invention-grid">{references.map((item) => <GalleryCard key={item.id} item={item} replay />)}</div>}
          </section>
        )}
        {mine.length > 0 && <Section title="Your inventions" items={mine} previewCount={3} blurb="Your private and published builds saved in this browser." browse={{ to: '/gallery?view=mine', label: 'All your inventions' }} />}
        <Section title="Prototype gallery" items={featuredPrototypes} previewCount={6} blurb="Explore featured builds, inspect their parts, and replay their physics tests." browse={{ to: '/gallery?view=featured', label: 'All featured inventions' }} />
        <Section title="Recent" items={recentPrototypes} previewCount={6} empty="Nothing published yet. Build something and publish it." browse={{ to: '/gallery', label: 'All published inventions' }} />
        {(!spotlightId || otherRemixes.length > 0) && <Section title="Remixes" items={otherRemixes} empty="Open any invention and click Remix to create the first one." browse={{ to: '/gallery?view=remixes', label: 'All remixes' }} />}
        <section id="how-it-works" className="lab-section lab-how" aria-labelledby="lab-how-title">
          <div className="lab-section-heading">
            <div>
              <span className="lab-label">From idea to prototype</span>
              <h2 id="lab-how-title">How ProtoLab works</h2>
              <p>A prompt becomes a 3D assembly you can inspect, simulate, and improve.</p>
            </div>
            <a href="#parts" className="btn-secondary">Explore the parts <span aria-hidden="true">↓</span></a>
          </div>
          <ol className="lab-how-steps">
            {steps.map((step, index) => (
              <li key={step.title}>
                <span className="lab-label lab-how-number">0{index + 1}</span>
                <h3>{step.title}</h3>
                <p>{step.detail}</p>
              </li>
            ))}
          </ol>
          {beforeDistance !== undefined && afterDistance !== undefined && (
            <div className="lab-test-example">
              <div>
                <span className="lab-label">Inside a saved simulation</span>
                <h3>How a test changed the crab</h3>
                <p>The v{before?.version.iteration} test recorded {fmt.cm(beforeDistance)} of sideways travel. Muse revised the leg stance and gait, then ran the same test again.</p>
              </div>
              <dl aria-label="Sideways distance">
                <div><dt>Before revision</dt><dd>{fmt.cm(beforeDistance)}</dd></div>
                <div><dt>After revision</dt><dd>{fmt.cm(afterDistance)}</dd></div>
              </dl>
              <Link to={replayUrl} className="btn-secondary">Replay the test <span aria-hidden="true">↗</span></Link>
            </div>
          )}
        </section>
        <PartInventory />
        <footer className="lab-footer">
          <span className="lab-label">ProtoLab{model && ` · ${model.label}`}</span>
          <p>Rigid-body simulation is not engineering certification. No claim of physical buildability or safety is made.</p>
        </footer>
      </main>
    </div>
  );
}

function Section({ title, items, previewCount, blurb, empty, browse }: { title: string; items: InventionPublic[]; previewCount?: number; blurb?: string; empty?: string; browse?: { to: string; label: string } }) {
  const [expanded, setExpanded] = useState(false);
  const hiddenCount = Math.max(0, items.length - (previewCount ?? items.length));
  const visibleItems = expanded || !hiddenCount ? items : items.slice(0, previewCount);
  return (
    <section className="lab-section">
      <div className="lab-section-heading">
        <div>
          <h2>{title}</h2>
          {blurb && <p>{blurb}</p>}
        </div>
        {browse && <Link to={browse.to} className="btn-secondary">{browse.label} <span aria-hidden="true">↗</span></Link>}
      </div>
      {items.length === 0 ? <p className="lab-empty">{empty ?? 'Loading…'}</p> : (
        <div className="invention-grid">{visibleItems.map((i) => <GalleryCard key={i.id} item={i} />)}</div>
      )}
      {hiddenCount > 0 && (
        <button className="btn-secondary mt-4" type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show fewer' : `Show ${hiddenCount} more`} <span className="sr-only">in {title}</span>
        </button>
      )}
    </section>
  );
}
