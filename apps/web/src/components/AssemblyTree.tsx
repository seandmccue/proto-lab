import { useMemo } from 'react';
import type { Assembly } from '@protolab/schema';
import { billOfMaterials, totalMass } from '@protolab/schema';
import { fmt } from '../api.ts';

export default function AssemblyTree({ assembly, selectedId, onSelect, changedIds }: { assembly: Assembly; selectedId: string | null; onSelect: (id: string | null) => void; changedIds?: Set<string> }) {
  const groups = useMemo(() => {
    const m = new Map<string, Assembly['instances']>();
    for (const i of assembly.instances) { const g = i.group ?? 'other'; if (!m.has(g)) m.set(g, []); m.get(g)!.push(i); }
    return [...m.entries()].sort(([a], [b]) => (a === 'body' ? -1 : b === 'body' ? 1 : a.localeCompare(b)));
  }, [assembly]);
  const partById = useMemo(() => new Map(assembly.parts.map((p) => [p.id, p])), [assembly]);
  const bom = useMemo(() => billOfMaterials(assembly), [assembly]);
  const sel = selectedId ? assembly.instances.find((i) => i.id === selectedId) : null;
  const selPart = sel ? partById.get(sel.partId) : null;
  const label = (g: string) => g === 'body' ? 'Body' : g.startsWith('leg_') ? `Leg ${g.slice(4).replace('L', 'left ').replace('R', 'right ')}` : g;

  return (
    <div className="flex h-full flex-col text-sm">
      <div className="px-3 pt-3 pb-2 panel-title">Assembly tree</div>
      <div className="min-h-0 flex-1 overflow-auto px-2">
        {groups.map(([g, items]) => (
          <div key={g} className="mb-2">
            <div className="px-1 text-xs font-medium text-slate-500">{label(g)}</div>
            <ul>
              {items.map((i) => (
                <li key={i.id}>
                  <button onClick={() => onSelect(i.id === selectedId ? null : i.id)} className={`flex w-full items-center justify-between rounded-md px-2 py-1 text-left hover:bg-slate-100 ${selectedId === i.id ? 'bg-accent-soft text-accent-dark' : ''}`}>
                    <span className="truncate">{i.label}</span>
                    {changedIds?.has(i.id) && <span className="ml-2 h-1.5 w-1.5 shrink-0 rounded-full bg-warn" title="Changed in this iteration" />}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {sel && selPart && (
        <div className="border-t border-slate-100 p-3 text-xs">
          <div className="font-medium text-slate-900">{selPart.name}</div>
          <div className="text-slate-500">{selPart.description}</div>
          <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-0.5 mono text-slate-700">
            <dt className="text-slate-500">Mass</dt><dd>{fmt.kg(selPart.mass_kg)}</dd>
            <dt className="text-slate-500">Size</dt><dd>{selPart.dimensions_m.map((d) => (d * 1000).toFixed(0)).join('×')} mm</dd>
            <dt className="text-slate-500">Material</dt><dd>{selPart.material}</dd>
            {selPart.limits.maxTorque_Nm && <><dt className="text-slate-500">Torque</dt><dd>{fmt.nm(selPart.limits.maxTorque_Nm)}</dd></>}
            <dt className="text-slate-500">Source</dt><dd>{selPart.source.license}</dd>
            <dt className="text-slate-500">Position</dt><dd>{sel.transform.position.map((v) => (v * 1000).toFixed(0)).join(', ')} mm</dd>
          </dl>
        </div>
      )}
      <div className="border-t border-slate-100 p-3">
        <div className="panel-title mb-1">Bill of materials · {fmt.kg(totalMass(assembly))}</div>
        <ul className="text-xs mono">
          {bom.map((l) => (
            <li key={l.partId} className="flex justify-between gap-2 py-0.5"><span className="truncate text-slate-700">{l.qty}× {l.name}</span><span className="text-slate-500">{fmt.kg(l.mass_kg)}</span></li>
          ))}
        </ul>
      </div>
    </div>
  );
}
