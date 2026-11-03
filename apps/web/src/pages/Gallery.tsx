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
      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Gallery</h1>
          <div className="flex gap-1 rounded-full bg-slate-100 p-1">
            {(['recent', 'featured', 'remixes'] as const).map((s) => <button key={s} onClick={() => setSort(s)} className={`rounded-full px-3 py-1 text-sm capitalize ${sort === s ? 'bg-white shadow text-slate-900' : 'text-slate-500'}`}>{s}</button>)}
          </div>
        </div>
        {items.length === 0 ? <p className="text-slate-400">Nothing here yet.</p> : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{items.map((i) => <GalleryCard key={i.id} item={i} />)}</div>}
      </main>
    </div>
  );
}
