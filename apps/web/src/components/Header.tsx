import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { api, type ModelInfo } from '../api.ts';

let cached: ModelInfo | null = null;
export function useModelInfo() {
  const [info, setInfo] = useState<ModelInfo | null>(cached);
  useEffect(() => { if (!cached) api.model().then((m) => { cached = m; setInfo(m); }).catch(() => {}); }, []);
  return info;
}

export default function Header({ compact = false }: { compact?: boolean }) {
  const model = useModelInfo();
  return (
    <header className={`flex items-center justify-between ${compact ? 'px-4 py-2' : 'px-6 py-4'} border-b border-slate-100 bg-white/90 backdrop-blur sticky top-0 z-20`}>
      <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight text-slate-900">
        <span className="inline-block h-6 w-6 rounded-md bg-accent" aria-hidden />
        ProtoLab
      </Link>
      <nav className="flex items-center gap-3 text-sm">
        <Link to="/gallery" className="btn-ghost">Gallery</Link>
        <Link to="/" className="btn-secondary">New invention</Link>
        {model && (
          <span className={`hidden sm:inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${model.live ? 'border-emerald-200 text-emerald-700 bg-emerald-50' : 'border-slate-200 text-slate-500'}`} title={model.detail}>
            <span className={`h-1.5 w-1.5 rounded-full ${model.live ? 'bg-emerald-500' : 'bg-slate-400'}`} />
            {model.label}
          </span>
        )}
      </nav>
    </header>
  );
}
