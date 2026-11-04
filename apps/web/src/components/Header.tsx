import { Link, NavLink } from 'react-router-dom';
import { useEffect, useId, useRef, useState } from 'react';
import { api, type ModelInfo } from '../api.ts';
import { setTheme, useTheme } from '../theme.ts';

let cached: ModelInfo | null = null;
export function useModelInfo() {
  const [info, setInfo] = useState<ModelInfo | null>(cached);
  useEffect(() => { if (!cached) api.model().then((m) => { cached = m; setInfo(m); }).catch(() => {}); }, []);
  return info;
}

function ThemeToggle() {
  const theme = useTheme();
  return (
    <button type="button" className="theme-toggle" onClick={(event) => { event.stopPropagation(); setTheme(theme === 'dark' ? 'light' : 'dark'); }} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} title={theme === 'dark' ? 'Light theme' : 'Dark theme'}>
      {theme === 'dark'
        ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
        : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" /></svg>}
    </button>
  );
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
      <div className="site-mobile-actions">
        <ThemeToggle />
        <Link to="/" className="btn-secondary" onClick={() => setMenuOpen(false)}>Build</Link>
        <button ref={menuRef} type="button" className="btn-ghost site-menu-toggle" aria-expanded={menuOpen} aria-controls={navId} onClick={() => setMenuOpen((open) => !open)}>
          Menu <span aria-hidden="true">{menuOpen ? '−' : '☰'}</span>
        </button>
      </div>
      <nav id={navId} className="site-nav" data-open={menuOpen} aria-label="Main navigation" onClick={() => setMenuOpen(false)}>
        <NavLink to="/how-it-works" className="btn-ghost">How it works</NavLink>
        <NavLink to="/gallery" className="btn-ghost">Gallery</NavLink>
        <ThemeToggle />
        <Link to="/" className="btn-secondary site-new"><span aria-hidden="true">+</span> <span className="site-new-full">New invention</span><span className="site-new-short">Build</span></Link>
      </nav>
    </header>
  );
}
