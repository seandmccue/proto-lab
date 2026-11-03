import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { VersionRecord } from '@protolab/schema';
import { api, fmt, type InventionPublic } from '../api.ts';
import IsoPreview from './IsoPreview.tsx';

export default function GalleryCard({ item }: { item: InventionPublic }) {
  const [hover, setHover] = useState(false);
  const [version, setVersion] = useState<VersionRecord | null>(null);
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [traced, setTraced] = useState(false);
  useEffect(() => {
    if (!item.currentVersionId) return;
    if (!version) api.version(item.id, item.currentVersionId, false).then((r) => setVersion(r.version)).catch(() => {});
  }, [version, item]);
  useEffect(() => {
    if (!hover || traced || !item.currentVersionId || reduced) return;
    api.version(item.id, item.currentVersionId, true).then((r) => { setVersion(r.version); setTraced(true); }).catch(() => {});
  }, [hover, traced, item, reduced]);
  const walk = item.tests.find((t) => t.kind === 'walk');
  const test = version?.tests.find((t) => t.kind === 'walk') ?? version?.tests[0] ?? null;
  return (
    <Link to={`/i/${item.id}`} className="card group block overflow-hidden transition hover:shadow-lg hover:-translate-y-0.5" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onFocus={() => setHover(true)} aria-label={`${item.title}: ${item.description || item.prompt}. Explore in 3D.`}>
      <div className="relative aspect-[4/3] bg-slate-100">
        {version ? (
          <IsoPreview assembly={version.assembly} trace={traced ? test?.trace : null} playing={hover && traced && !reduced} className="h-full w-full" />
        ) : item.previewUrl ? (
          <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-slate-300"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" /><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" /></svg></div>
        )}
        <div className="absolute left-2 top-2 flex gap-1">
          {item.featured && <span className="rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-medium text-accent">Featured</span>}
          {item.sourceInventionId && <span className="rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-medium text-slate-600">Remix</span>}
        </div>
        <span className={`absolute right-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-medium ${walk?.passed ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{walk?.passed ? 'Walk test passed' : 'Did not pass'}</span>
      </div>
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-medium text-slate-900">{item.title}</h3>
          {walk && <span className="mono text-xs text-slate-500 whitespace-nowrap">{fmt.m2(walk.metrics.distance_m)}</span>}
        </div>
        <p className="mt-1 line-clamp-2 text-sm text-slate-600">{item.description || item.prompt}</p>
        <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
          <span>{item.ownerLabel} · {item.modelId === 'deterministic-planner' ? 'planner' : item.modelId}</span>
          <span className="text-accent group-hover:underline">Explore in 3D →</span>
        </div>
      </div>
    </Link>
  );
}
