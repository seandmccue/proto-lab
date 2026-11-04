import { useEffect, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
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

const savedPageCounts = new Map<string, number>();
const maxRestoredPages = 5;

function rememberPageCount(entry: string, count: number) {
  // Keep only page counts, never invention data or session identifiers.
  savedPageCounts.delete(entry);
  savedPageCounts.set(entry, Math.min(count, maxRestoredPages));
  if (savedPageCounts.size > 24) savedPageCounts.delete(savedPageCounts.keys().next().value!);
}

function GalleryResults({ view, entry }: { view: GalleryView; entry: string }) {
  const [items, setItems] = useState<InventionPublic[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [request, setRequest] = useState({ cursor: 0 });
  const [failedCursor, setFailedCursor] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const loadedPages = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let cursor = request.cursor;
    const pagesToFetch = cursor === 0 ? savedPageCounts.get(entry) ?? 1 : 1;
    if (cursor === 0) loadedPages.current = 0;

    async function load() {
      for (let index = 0; index < pagesToFetch; index++) {
        const result = await (view === 'mine' ? api.mine(cursor) : api.gallery(view, 24, cursor));
        if (cancelled) return;
        const replace = cursor === 0;
        setItems((previous) => {
          if (replace) return result.items;
          const seen = new Set(previous.map((item) => item.id));
          return [...previous, ...result.items.filter((item) => !seen.has(item.id))];
        });
        loadedPages.current++;
        const next = result.nextCursor === cursor ? null : result.nextCursor ?? null;
        setNextCursor(next);
        if (next === null) break;
        cursor = next;
      }
      rememberPageCount(entry, loadedPages.current);
      setStatus('ready');
    }

    void load().catch(() => {
      if (cancelled) return;
      setFailedCursor(cursor);
      setStatus('error');
    });
    return () => { cancelled = true; };
  }, [entry, request, view]);

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
          <button className="btn-secondary" type="button" onClick={() => loadPage(failedCursor)}>Try again</button>
        </div>
      )}
      {status === 'ready' && nextCursor !== null && (
        <button className="btn-secondary mt-4" type="button" onClick={() => loadPage(nextCursor)}>Load more inventions</button>
      )}
    </div>
  );
}

export default function Gallery() {
  const { key } = useLocation();
  const [params, setParams] = useSearchParams();
  const view = filters.find(({ id }) => id === params.get('view'))?.id ?? 'recent';
  const entry = `${key}:${view}`;
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
              <button key={id} type="button" onClick={() => { if (view !== id) setParams(id === 'recent' ? {} : { view: id }); }} aria-pressed={view === id}>{label}</button>
            ))}
          </div>
          {view === 'mine' && <p className="mb-4 text-sm text-muted">Inventions saved in this browser. Private builds appear here and on your homepage.</p>}
          <GalleryResults key={entry} view={view} entry={entry} />
        </section>
      </main>
    </div>
  );
}
