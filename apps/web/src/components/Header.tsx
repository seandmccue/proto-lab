import { Link, NavLink } from 'react-router-dom';
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
    <header className={`site-header ${compact ? 'site-header--compact' : ''}`}>
      <Link to="/" className="site-brand">
        <img src="/protolab.svg" alt="" width="36" height="36" />
        <span>Proto<span className="site-brand-accent">Lab</span></span>
      </Link>
      <nav className="site-nav" aria-label="Main navigation">
        <NavLink to="/how-it-works" className="btn-ghost">How it works</NavLink>
        <NavLink to="/gallery" className="btn-ghost">Gallery</NavLink>
        <Link to="/" className="btn-secondary site-new"><span aria-hidden="true">+</span> <span className="site-new-full">New invention</span><span className="site-new-short">Build</span></Link>
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
