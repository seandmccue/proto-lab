import { useEffect, useState } from 'react';
import Header from '../components/Header.tsx';
import GalleryCard from '../components/GalleryCard.tsx';
import { api, type InventionPublic } from '../api.ts';

export default function Gallery() {
  const [sort, setSort] = useState<'recent' | 'featured' | 'remixes'>('recent');
  const [items, setItems] = useState<InventionPublic[]>([]);
  useEffect(() => { api.gallery(sort, 24).then((r) => setItems(r.items)).catch(() => setItems([])); }, [sort]);
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
            {(['recent', 'featured', 'remixes'] as const).map((s) => (
              <button key={s} type="button" onClick={() => setSort(s)} aria-pressed={sort === s}>{s}</button>
            ))}
          </div>
          {items.length === 0 ? (
            <p className="invention-gallery__empty">{sort === 'remixes' ? 'Open any invention and select Remix to create the first one.' : 'No inventions here yet.'}</p>
          ) : (
            <div className="invention-grid">{items.map((i) => <GalleryCard key={i.id} item={i} />)}</div>
          )}
        </section>
      </main>
    </div>
  );
}
