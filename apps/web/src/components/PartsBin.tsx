import { useEffect, useMemo, useRef, useState } from 'react';
import type { Assembly, PartDefinition, Spec } from '@protolab/schema';
import IsoPreview from './IsoPreview.tsx';
import { api, type JobEvent } from '../api.ts';

/** A part Muse found, created or designed, as reported on a tool event. Custom parts carry their geometry; catalog parts are fetched for the thumbnail. */
export interface PickedPart { id: string; name: string; category: string; mass_kg: number; custom: boolean; via: 'planned' | 'found' | 'inspected' | 'created' | 'designed' | 'mounted'; part?: PartDefinition; t: string }

export function pickedParts(events: JobEvent[]): PickedPart[] {
  const seen = new Map<string, PickedPart>();
  const sources: Record<string, PickedPart['via']> = { write_plan: 'planned', create_part: 'created', design_part: 'designed', get_part: 'inspected', assemble: 'mounted' };
  const rank = { planned: 0, found: 1, inspected: 2, created: 3, designed: 3, mounted: 4 };
  for (const e of events) {
    if (e.type !== 'tool' || !e.ok || !Array.isArray(e.parts)) continue;
    const via = sources[String(e.tool)] ?? 'found';
    for (const p of e.parts as Array<Omit<PickedPart, 'via' | 't'>>) {
      const prev = seen.get(p.id);
      if (!prev || rank[via] > rank[prev.via]) seen.set(p.id, { ...prev, ...p, via, t: String(e.t) });
    }
  }
  return [...seen.values()];
}

function single(part: PartDefinition): Assembly {
  return { parts: [part], instances: [{ id: 'p', partId: part.id, label: part.name, group: 'p', transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1] }, anchored: false, free: false }], joints: [], controller: { drives: [] } } as unknown as Assembly;
}

function PartDrawing({ part }: { part: PickedPart }) {
  const [catalogPart, setCatalogPart] = useState<PartDefinition>();
  useEffect(() => {
    if (part.part) return;
    let current = true;
    api.part(part.id).then(({ part: definition }) => { if (current) setCatalogPart(definition); }).catch(() => {});
    return () => { current = false; };
  }, [part.id, part.part]);
  const definition = part.part ?? catalogPart;
  const assembly = useMemo(() => definition ? single(definition) : null, [definition]);
  return assembly ? <IsoPreview assembly={assembly} blueprint /> : <span className="blueprint-target" aria-hidden="true">+</span>;
}

export default function PartsBin({ parts, plan, brief }: { parts: PickedPart[]; plan?: Spec['plan']; brief?: string }) {
  const [selectedId, setSelectedId] = useState<string>();
  const [playing, setPlaying] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [inventoryFocused, setInventoryFocused] = useState(false);
  const inventory = useRef<HTMLUListElement>(null);
  const visible = useMemo(() => [...parts].sort((a, b) => b.t.localeCompare(a.t)).slice(0, 12), [parts]);
  const activeIndex = Math.max(0, visible.findIndex((part) => part.id === selectedId));
  const active = visible[activeIndex];
  const activeId = active?.id;
  const nextId = visible.length > 1 ? visible[(activeIndex + 1) % visible.length].id : undefined;
  useEffect(() => {
    if (!playing || inventoryFocused || !nextId) return;
    const timer = window.setTimeout(() => setSelectedId(nextId), 4000);
    return () => window.clearTimeout(timer);
  }, [playing, inventoryFocused, activeId, nextId]);

  useEffect(() => {
    const list = inventory.current;
    const tile = list?.querySelector('[aria-pressed="true"]');
    if (!list || !tile) return;
    const frame = list.getBoundingClientRect();
    const item = tile.getBoundingClientRect();
    if (item.left < frame.left) list.scrollLeft += item.left - frame.left;
    else if (item.right > frame.right) list.scrollLeft += item.right - frame.right;
  }, [activeId]);
  const systems = plan?.subassemblies ?? [];

  return (
    <div className="build-blueprint">
      <div className="build-blueprint-heading">
        <span>Blueprint desk</span>
        <div className="build-blueprint-controls">
          <span>{active ? `${parts.length} part types` : systems.length ? `${systems.length} subassemblies` : 'Awaiting plan'}</span>
          {nextId && (
            <>
              <button type="button" onClick={() => setPlaying((value) => !value)}>{playing ? 'Pause slideshow' : 'Play slideshow'}</button>
              <button type="button" className="build-blueprint-next" onClick={() => { setSelectedId(nextId); setPlaying(false); }}>Next part</button>
            </>
          )}
        </div>
      </div>
      <div className="build-blueprint-stage">
        {active ? (
          <>
            <div className="build-blueprint-drawing" key={active.id}><PartDrawing part={active} /></div>
            <div className="build-blueprint-caption">
              <strong>{active.name}</strong>
              <span>{active.category} · {Math.round(active.mass_kg * 1000)} g · {active.via}</span>
            </div>
          </>
        ) : systems.length ? (
          <ol className="build-blueprint-plan" aria-label="Planned subassemblies">
            {systems.slice(0, 6).map((name, i) => <li key={`${i}-${name}`}><span>{String(i + 1).padStart(2, '0')}</span>{name}</li>)}
          </ol>
        ) : (
          <div className="build-blueprint-empty">
            <span className="blueprint-target" aria-hidden="true">+</span>
            {brief && <strong>Design brief</strong>}
            <p>{brief || 'The engineering plan will appear here as Muse drafts it.'}</p>
          </div>
        )}
      </div>
      {active && (
        <ul ref={inventory} className="build-blueprint-inventory" aria-label="Build inventory"
          onFocus={() => setInventoryFocused(true)}
          onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setInventoryFocused(false); }}>
          {visible.map((part) => (
            <li key={part.id}>
              <button type="button" aria-pressed={part.id === active.id} onClick={() => { setSelectedId(part.id); setPlaying(false); }}>
                <span>{part.custom ? 'Custom' : part.category}</span>
                <strong>{part.name}</strong>
                <small>{part.via}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
