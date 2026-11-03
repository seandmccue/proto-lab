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
  const prefix = 'Powered by ';
  const attribution = model?.label.startsWith(prefix) ? model.label.slice(prefix.length) : null;
  return (
    <header className={`site-header ${compact ? 'site-header--compact' : ''}`}>
      <div className="site-identity">
        <Link to="/" className="site-brand">
          <img src="/protolab.svg" alt="" width="36" height="36" />
          <span>Proto<span className="site-brand-accent">Lab</span></span>
        </Link>
        {model && (
          <span className="site-attribution" data-live={model.live} title={model.detail}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M8 1l1.7 5.3L15 8l-5.3 1.7L8 15 6.3 9.7 1 8l5.3-1.7L8 1Z" />
            </svg>
            <span>{attribution ? <>Powered by <strong>{attribution}</strong></> : model.label}</span>
            <span className="site-attribution-status" aria-hidden="true" />
          </span>
        )}
      </div>
      <nav className="site-nav" aria-label="Main navigation">
        <NavLink to="/how-it-works" className="btn-ghost">How it works</NavLink>
        <NavLink to="/gallery" className="btn-ghost">Gallery</NavLink>
        <Link to="/" className="btn-secondary site-new"><span aria-hidden="true">+</span> <span className="site-new-full">New invention</span><span className="site-new-short">Build</span></Link>
      </nav>
    </header>
  );
}
