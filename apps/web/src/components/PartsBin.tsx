import { useEffect, useMemo, useState } from 'react';
import type { Assembly, PartDefinition } from '@protolab/schema';
import IsoPreview from './IsoPreview.tsx';
import { api, type JobEvent } from '../api.ts';

/** A part Muse found, created or designed, as reported on a tool event. Custom parts carry their geometry; catalog parts are fetched for the thumbnail. */
export interface PickedPart { id: string; name: string; category: string; mass_kg: number; custom: boolean; via: 'found' | 'inspected' | 'created' | 'designed'; part?: PartDefinition; t: string }

export function pickedParts(events: JobEvent[]): PickedPart[] {
  const seen = new Map<string, PickedPart>();
  for (const e of events) {
    if (e.type !== 'tool' || !e.ok || !Array.isArray(e.parts)) continue;
    const via: PickedPart['via'] = e.tool === 'create_part' ? 'created' : e.tool === 'design_part' ? 'designed' : e.tool === 'get_part' ? 'inspected' : 'found';
    for (const p of e.parts as Array<Omit<PickedPart, 'via' | 't'>>) {
      const prev = seen.get(p.id);
      const rank = { found: 0, inspected: 1, created: 2, designed: 2 };
      if (!prev || rank[via] >= rank[prev.via]) seen.set(p.id, { ...prev, ...p, via, t: String(e.t) });
    }
  }
  return [...seen.values()];
}

function single(part: PartDefinition): Assembly {
  return { parts: [part], instances: [{ id: 'p', partId: part.id, label: part.name, group: 'p', transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1] }, anchored: false, free: false }], joints: [], controller: { drives: [] } } as unknown as Assembly;
}

function Thumb({ p }: { p: PickedPart }) {
  const [def, setDef] = useState<PartDefinition | undefined>(p.part);
  useEffect(() => { if (def || p.custom) return; let stop = false; api.part(p.id).then((r) => { if (!stop) setDef(r.part); }).catch(() => {}); return () => { stop = true; }; }, [p.id, p.custom, def]);
  const asm = useMemo(() => (def ? single(def) : null), [def]);
  return asm ? <IsoPreview assembly={asm} className="h-14 w-full" /> : <div className="h-14 w-full animate-pulse rounded bg-slate-100" />;
}

/** The parts Muse has gathered so far, newest first, each sliding in as it arrives. */
export default function PartsBin({ events, max = 12 }: { events: JobEvent[]; max?: number }) {
  const parts = useMemo(() => pickedParts(events).sort((a, b) => (a.t < b.t ? 1 : -1)).slice(0, max), [events, max]);
  if (!parts.length) return null;
  const designed = parts.filter((p) => p.custom).length;
  return (
    <div className="parts-bin" aria-label="Parts gathered so far">
      <div className="parts-bin-head"><span className="panel-title">Parts bin</span><span className="mono text-[10px] text-slate-500">{parts.length} picked{designed ? ` · ${designed} designed by Muse` : ''}</span></div>
      <ul className="parts-bin-grid">
        {parts.map((p) => (
          <li key={p.id} className="parts-bin-card" title={`${p.name} · ${p.category} · ${Math.round(p.mass_kg * 1000)} g`}>
            <Thumb p={p} />
            <div className="truncate text-[11px] font-medium text-slate-700">{p.name}</div>
            <div className="flex items-center justify-between text-[10px] text-slate-500"><span>{Math.round(p.mass_kg * 1000)} g</span>{p.custom ? <span className="rounded bg-violet-100 px-1 text-violet-700">designed by Muse</span> : <span>{p.via}</span>}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
