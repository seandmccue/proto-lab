import { Link, NavLink } from 'react-router-dom';
import { useEffect, useId, useRef, useState } from 'react';
import { api, type ModelInfo } from '../api.ts';

let cached: ModelInfo | null = null;
export function useModelInfo() {
  const [info, setInfo] = useState<ModelInfo | null>(cached);
  useEffect(() => { if (!cached) api.model().then((m) => { cached = m; setInfo(m); }).catch(() => {}); }, []);
  return info;
}

export default function Header({ compact = false }: { compact?: boolean }) {
  const model = useModelInfo();
  const [menuOpen, setMenuOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const navId = useId();
  useEffect(() => {
    if (!menuOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (!headerRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [menuOpen]);
  const prefix = 'Powered by ';
  const attribution = model?.label.startsWith(prefix) ? model.label.slice(prefix.length) : null;
  return (
    <header ref={headerRef} className={`site-header ${compact ? 'site-header--compact' : ''}`} onKeyDown={(event) => {
      if (event.key === 'Escape' && menuOpen) { setMenuOpen(false); menuRef.current?.focus(); }
    }}>
      <div className="site-identity">
        <Link to="/" className="site-brand">
          <img src="/protolab.png" alt="" width="40" height="40" />
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
      <div className="site-mobile-actions">
        <Link to="/" className="btn-secondary" onClick={() => setMenuOpen(false)}>Build</Link>
        <button ref={menuRef} type="button" className="btn-ghost site-menu-toggle" aria-expanded={menuOpen} aria-controls={navId} onClick={() => setMenuOpen((open) => !open)}>
          Menu <span aria-hidden="true">{menuOpen ? '−' : '☰'}</span>
        </button>
      </div>
      <nav id={navId} className="site-nav" data-open={menuOpen} aria-label="Main navigation" onClick={() => setMenuOpen(false)}>
        <Link to="/#how-it-works" className="btn-ghost">How it works</Link>
        <NavLink to="/gallery" className="btn-ghost">Gallery</NavLink>
      </nav>
    </header>
  );
}
