import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Header, { useModelInfo } from '../components/Header.tsx';
import GalleryCard from '../components/GalleryCard.tsx';
import PartInventory from '../components/PartInventory.tsx';
import Viewer from '../components/Viewer.tsx';
import { api, fmt, type Example, type InventionPublic, type TestSummary } from '../api.ts';
import type { VersionRecord } from '@protolab/schema';

const steps = [
  { title: 'Describe your idea', detail: 'Tell Muse what you want to build and what it should do. Give it a target, like a crab that scuttles at least 25 cm.' },
  { title: 'Watch Muse assemble it', detail: 'Muse selects parts, connects them in 3D, and sets up the motors and joints that make the prototype move.' },
  { title: 'Run a physics test', detail: 'ProtoLab simulates the motion and measures the result against your goal. Replay the test to see where it passed or failed.' },
  { title: 'See what changes', detail: 'Muse can revise the assembly or motor settings and test again. Compare saved versions to see what improved.' },
];
const referenceIds = ['inv_drawing_automaton', 'inv_triplex_pump', 'inv_twin_drawbridge', 'inv_scissor_lift'];

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
  const [heroVersion, setHeroVersion] = useState<VersionRecord | null>(null);
  const [before, setBefore] = useState<{ version: VersionRecord; test: TestSummary } | null>(null);
  const [showBefore, setShowBefore] = useState(false);
  const [heroPlaying, setHeroPlaying] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const hero = featured.find((item) => /^mechanical crab$/i.test(item.title) && item.status === 'passed' && item.latestWalk?.passed);
  const heroId = hero?.id;
  const heroVersionId = hero?.currentVersionId;
  const heroTestId = hero?.latestWalk?.testId;
  const references = referenceIds.flatMap((id) => featured.filter((item) => item.id === id));
  const featuredPrototypes = featured.filter((item) => !referenceIds.includes(item.id)).slice(0, 6);

  useEffect(() => {
    api.examples().then((r) => setExamples(r.examples)).catch(() => {});
    api.gallery('featured', 12).then((r) => setFeatured(r.items)).catch(() => {});
    api.gallery('recent', 24).then((r) => setRecent(r.items.filter((i) => !i.featured).slice(0, 6))).catch(() => {});
    api.gallery('remixes', 4).then((r) => setRemixes(r.items)).catch(() => {});
    api.mine().then((r) => setMine(r.items)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!heroId || !heroVersionId) return;
    let cancelled = false;
    api.version(heroId, heroVersionId).then(({ version }) => { if (!cancelled) setHeroVersion(version); }).catch(() => {});
    return () => { cancelled = true; };
  }, [heroId, heroVersionId]);
  useEffect(() => {
    if (!heroId || !heroTestId) return;
    let cancelled = false;
    const testName = (id: string) => id.replace(/#\d+$/, '');
    void (async () => {
      const { versions } = await api.invention(heroId);
      const latestIndex = versions.findIndex((version) => version.id === heroVersionId);
      for (const version of versions.slice(0, latestIndex).reverse()) {
        const test = version.tests.find((result) => !result.passed && testName(result.testId) === testName(heroTestId));
        if (!test) continue;
        const detail = await api.version(heroId, version.id);
        if (!cancelled) setBefore({ version: detail.version, test });
        break;
      }
    })().catch(() => {});
    return () => { cancelled = true; };
  }, [heroId, heroTestId, heroVersionId]);

  const heroTest = heroVersion?.tests.find((test) => test.testId === heroTestId);
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
    <div className="min-h-full">
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
            <div className="lab-art-results" role="group" aria-label="Compare saved crab tests">
              {beforeDistance !== undefined && <button type="button" aria-pressed={showBefore} onClick={() => setShowBefore(true)}><span>Before · Failed</span><strong>{fmt.cm(beforeDistance)}</strong></button>}
              {afterDistance !== undefined && <button type="button" aria-pressed={!showBefore} onClick={() => setShowBefore(false)}><span>After · Passed</span><strong>{fmt.cm(afterDistance)}</strong></button>}
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
              {hero && <p>Muse revised the leg stance and gait. The cards show sideways distance from the saved tests.</p>}
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
        {references.length > 0 && (
          <section className="lab-section" aria-labelledby="motion-gallery-title">
            <div className="lab-section-heading">
              <div>
                <span className="lab-label">Mechanism lab</span>
                <h2 id="motion-gallery-title">See mechanisms in motion</h2>
                <p>Replay reference builds to see how one drive moves several linked parts. Open the test to inspect the measured results.</p>
              </div>
            </div>
            <div className="invention-grid">{references.map((item) => <GalleryCard key={item.id} item={item} replay />)}</div>
          </section>
        )}
        {mine.length > 0 && <Section title="Your inventions" items={mine.slice(0, 3)} browse={{ to: '/gallery?view=mine', label: 'All your inventions' }} />}
        <Section title="Prototype gallery" items={featuredPrototypes} blurb="Explore featured builds, inspect their parts, and replay their physics tests." browse={{ to: '/gallery', label: 'View gallery' }} />
        <Section title="Recent" items={recent} empty="Nothing published yet. Build something and publish it." browse={{ to: '/gallery', label: 'All published inventions' }} />
        <Section title="Remixes" items={remixes} empty="Open any invention and click Remix to create the first one." browse={{ to: '/gallery?view=remixes', label: 'All remixes' }} />
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
                <p>The first version barely moved sideways. Muse revised the leg stance and gait, then ran the same test again.</p>
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

function Section({ title, items, blurb, empty, browse }: { title: string; items: InventionPublic[]; blurb?: string; empty?: string; browse?: { to: string; label: string } }) {
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
        <div className="invention-grid">{items.map((i) => <GalleryCard key={i.id} item={i} />)}</div>
      )}
    </section>
  );
}
