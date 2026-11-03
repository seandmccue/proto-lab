import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Header from '../components/Header.tsx';
import GalleryCard from '../components/GalleryCard.tsx';
import { api, type InventionPublic } from '../api.ts';

const filters = [
  { id: 'recent', label: 'Recent' },
  { id: 'featured', label: 'Featured' },
  { id: 'remixes', label: 'Remixes' },
  { id: 'mine', label: 'Your inventions' },
] as const;
type GalleryView = typeof filters[number]['id'];

function GalleryResults({ view }: { view: GalleryView }) {
  const [items, setItems] = useState<InventionPublic[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [request, setRequest] = useState({ cursor: 0 });
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    const { cursor } = request;
    const page = view === 'mine' ? api.mine(cursor) : api.gallery(view, 24, cursor);
    page.then((result) => {
      if (cancelled) return;
      setItems((previous) => {
        if (cursor === 0) return result.items;
        const seen = new Set(previous.map((item) => item.id));
        return [...previous, ...result.items.filter((item) => !seen.has(item.id))];
      });
      setNextCursor(result.nextCursor ?? null);
      setStatus('ready');
    }).catch(() => {
      if (!cancelled) setStatus('error');
    });
    return () => { cancelled = true; };
  }, [request, view]);

  const loadPage = (cursor: number) => {
    setStatus('loading');
    setRequest({ cursor });
  };

  return (
    <div aria-busy={status === 'loading'}>
      {items.length > 0 && (
        <div className="invention-grid">{items.map((item) => <GalleryCard key={item.id} item={item} />)}</div>
      )}
      {status === 'loading' && <p className="invention-gallery__empty" role="status">Loading inventions…</p>}
      {status === 'ready' && items.length === 0 && (
        <p className="invention-gallery__empty">{view === 'mine'
          ? 'No inventions saved in this browser yet.'
          : view === 'remixes' ? 'Open any invention and select Remix to create the first one.' : 'No published inventions here yet.'}</p>
      )}
      {status === 'error' && (
        <div className="mt-4">
          <p className="invention-gallery__empty" role="alert">Could not load inventions.</p>
          <button className="btn-secondary" type="button" onClick={() => loadPage(request.cursor)}>Try again</button>
        </div>
      )}
      {status === 'ready' && nextCursor !== null && (
        <button className="btn-secondary mt-4" type="button" onClick={() => loadPage(nextCursor)}>Load more inventions</button>
      )}
    </div>
  );
}

export default function Gallery() {
  const [params, setParams] = useSearchParams();
  const view = filters.find(({ id }) => id === params.get('view'))?.id ?? 'recent';
  return (
    <div className="min-h-full">
      <Header />
      <main className="invention-gallery">
        <header className="invention-gallery__header">
          <p className="invention-gallery__eyebrow">The prototype archive</p>
          <h1>Gallery<span aria-hidden="true">.</span></h1>
          <p>See what the lab has built. Open a prototype to inspect the parts, replay its tests, or make a remix of your own.</p>
        </header>
        <section aria-label="Gallery inventions">
          <div className="invention-gallery__filters" role="group" aria-label="Filter inventions">
            {filters.map(({ id, label }) => (
              <button key={id} type="button" onClick={() => setParams(id === 'recent' ? {} : { view: id })} aria-pressed={view === id}>{label}</button>
            ))}
          </div>
          <GalleryResults key={view} view={view} />
        </section>
      </main>
    </div>
  );
}
