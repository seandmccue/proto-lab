import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Header, { useModelInfo } from '../components/Header.tsx';
import GalleryCard from '../components/GalleryCard.tsx';
import { api, type Example, type InventionPublic } from '../api.ts';

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

  useEffect(() => {
    api.examples().then((r) => setExamples(r.examples)).catch(() => {});
    api.gallery('featured', 4).then((r) => setFeatured(r.items)).catch(() => {});
    api.gallery('recent', 6).then((r) => setRecent(r.items.filter((i) => !i.featured))).catch(() => {});
    api.gallery('remixes', 4).then((r) => setRemixes(r.items)).catch(() => {});
    api.mine().then((r) => setMine(r.items)).catch(() => {});
  }, []);

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
            <p className="lab-label lab-kicker"><span aria-hidden="true">✦</span> AI invention studio</p>
            <h1 id="hero-title">What will you <em>invent?</em></h1>
            <p className="lab-intro">Give an AI engineer an idea. Watch it pick real parts, test them in a physics simulator, and hand you a 3D prototype to explore and remix.</p>
            <form onSubmit={submit} className="lab-form">
              <label htmlFor="invention-prompt" className="lab-label">Your invention brief</label>
              <div className="lab-input">
                <input id="invention-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Build a small walking robot…" maxLength={600} aria-describedby="invention-scope" />
                <button type="submit" className="btn-primary" disabled={busy || prompt.trim().length < 3}>
                  {busy ? 'Starting…' : 'Build this'} <span aria-hidden="true">↗</span>
                </button>
              </div>
              <p id="invention-scope">Any mechanism: walkers, flapping wings, Ferris wheels, catapults, claws, drawbridges, cranes, or something nobody has named yet. Muse plans it, picks or designs real parts, and proves it in physics.</p>
            </form>
            {error && <p className="mt-2 text-sm text-rose-700" role="alert">{error}</p>}
            {examples.length > 0 && <div className="lab-examples">
              <span className="lab-label">Try a brief</span>
              <div className="lab-chips">
                {examples.map((ex) => (
                  <button key={ex.id} onClick={() => start({ exampleId: ex.id })} disabled={busy} className={`chip ${ex.id === 'muse' ? 'lab-chip-muse' : ''}`} title={ex.prompt}>
                    {ex.id === 'muse' && <span aria-hidden="true">✦</span>}{ex.title}
                  </button>
                ))}
              </div>
            </div>}
          </div>
          <figure className="lab-art">
            <img src="/lab-illustration.svg" alt="Illustration of a purple walking robot with its shell lifted above the chassis" width="500" height="414" />
            <span className="lab-art-tag lab-label" aria-hidden="true">Fig. 01 / Walker</span>
            <figcaption className="lab-label"><span aria-hidden="true">⊕</span> Assembly sketch <span className="lab-art-caption-end">Exploded view</span></figcaption>
          </figure>
        </section>
        <div className="lab-process" aria-label="How ProtoLab works">
          <span><b>01</b> Describe</span><span><b>02</b> Assemble</span><span><b>03</b> Simulate</span><span><b>04</b> Remix</span>
        </div>

        {mine.length > 0 && <Section title="Your inventions" items={mine.slice(0, 3)} />}
        <Section title="Featured" items={featured} blurb="Open a prototype to explore its assembly and replay the measured tests." />
        <Section title="Recent" items={recent} empty="Nothing published yet. Build something and publish it." />
        <Section title="Remixes" items={remixes} empty="Open any invention and click Remix to create the first one." />
        <footer className="lab-footer">
          <span className="lab-label">ProtoLab{model && ` · ${model.label}`}</span>
          <p>Rigid-body simulation is not engineering certification. No claim of physical buildability or safety is made.</p>
        </footer>
      </main>
    </div>
  );
}

function Section({ title, items, blurb, empty }: { title: string; items: InventionPublic[]; blurb?: string; empty?: string }) {
  return (
    <section className="lab-section">
      <div className="lab-section-heading">
        <div>
          <h2>{title}</h2>
          {blurb && <p>{blurb}</p>}
        </div>
        {title === 'Featured' && <Link to="/gallery" className="btn-secondary">View gallery <span aria-hidden="true">↗</span></Link>}
      </div>
      {items.length === 0 ? <p className="lab-empty">{empty ?? 'Loading…'}</p> : (
        <div className="invention-grid">{items.map((i) => <GalleryCard key={i.id} item={i} />)}</div>
      )}
    </section>
  );
}
