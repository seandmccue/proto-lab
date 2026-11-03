import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
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
    api.gallery('featured', 3).then((r) => setFeatured(r.items)).catch(() => {});
    api.gallery('recent', 6).then((r) => setRecent(r.items.filter((i) => !i.featured))).catch(() => {});
    api.gallery('remixes', 3).then((r) => setRemixes(r.items)).catch(() => {});
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
      <main className="mx-auto max-w-6xl px-6">
        <section className="pt-16 pb-10 text-center">
          <p className="text-sm font-medium text-accent">AI-powered invention studio</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">What will you invent?</h1>
          <p className="mx-auto mt-4 max-w-2xl text-slate-600">Describe a mechanism. An engineering agent picks real parts, assembles them, tests them in a physics simulator, revises from the measurements, and hands you an interactive 3D prototype to remix and share.</p>
          <form onSubmit={submit} className="mx-auto mt-8 flex max-w-2xl items-center gap-2 rounded-full border border-slate-200 bg-white p-1.5 shadow-sm focus-within:border-accent">
            <input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Build a small walking robot that…" aria-label="Describe your invention" className="min-w-0 flex-1 bg-transparent px-4 py-2.5 text-base outline-none" maxLength={600} />
            <button type="submit" className="btn-primary" disabled={busy || prompt.trim().length < 3}>{busy ? 'Starting…' : 'Build this'}</button>
          </form>
          {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            {examples.map((ex) => (
              <button key={ex.id} onClick={() => start({ exampleId: ex.id })} disabled={busy} className={`chip ${ex.id === 'muse' ? 'border-accent text-accent' : ''}`} title={ex.prompt}>
                {ex.id === 'muse' ? '✦ ' : ''}{ex.title}
              </button>
            ))}
          </div>
          <p className="mt-6 text-xs text-slate-400">
            {model ? model.label : '…'} · No account needed · Simulation results are measured, not scripted · 3D Print — Coming Soon
          </p>
          <p className="mx-auto mt-2 max-w-xl text-[11px] text-slate-400">Today ProtoLab builds one mechanism family (legged walkers with 4 or 6 legs). Other prompts are interpreted into that family.</p>
        </section>

        {mine.length > 0 && <Section title="Your inventions" items={mine.slice(0, 3)} />}
        <Section title="Featured" items={featured} blurb="Built live by the agent when this server first started. Every card opens the actual assembly and simulation trace." />
        <Section title="Recent" items={recent} empty="Nothing published yet. Build something and publish it." />
        <Section title="Remixes" items={remixes} empty="Open any invention and click Remix to create the first one." />
        <footer className="py-12 text-center text-xs text-slate-400">ProtoLab · Rigid-body simulation is not engineering certification. No claim of physical buildability or safety is made.</footer>
      </main>
    </div>
  );
}

function Section({ title, items, blurb, empty }: { title: string; items: InventionPublic[]; blurb?: string; empty?: string }) {
  return (
    <section className="py-8">
      <div className="mb-4 flex items-end justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          {blurb && <p className="text-sm text-slate-500">{blurb}</p>}
        </div>
      </div>
      {items.length === 0 ? <p className="text-sm text-slate-400">{empty ?? 'Loading…'}</p> : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{items.map((i) => <GalleryCard key={i.id} item={i} />)}</div>
      )}
    </section>
  );
}
