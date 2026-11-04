import { memo, useEffect, useRef, useState } from 'react';
import type { Assembly } from '@protolab/schema';
import { api, type CatalogPart } from '../api.ts';
import IsoPreview from './IsoPreview.tsx';
import './PartInventory.css';

function categoryLabel(category: string) {
  return category.charAt(0).toUpperCase() + category.slice(1).replace(/_/g, ' ');
}

function PartDrawing({ part }: { part: CatalogPart }) {
  // This assembly supplies only the geometry and pose needed for the preview.
  const assembly: Assembly = {
    schemaVersion: 2,
    parts: [{ ...part, connectors: [], decorative: false }],
    instances: [{
      id: 'part', partId: part.id, label: part.name,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
      anchored: false, free: false,
    }],
    joints: [],
    controller: { drives: [] },
    family: 'custom',
    familyParams: {},
    familyConfig: {},
  };
  return <IsoPreview assembly={assembly} blueprint />;
}

const InventoryCard = memo(function InventoryCard({ part }: { part: CatalogPart }) {
  const illustration = useRef<HTMLDivElement>(null);
  const [showDrawing, setShowDrawing] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (showDrawing || !illustration.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setShowDrawing(true);
      observer.disconnect();
    });
    observer.observe(illustration.current);
    return () => observer.disconnect();
  }, [showDrawing]);

  return (
    <li className="part-inventory-card">
      <div className="part-inventory-illustration" ref={illustration}>
        <span className="lab-label">{categoryLabel(part.category)}</span>
        {showDrawing && <PartDrawing part={part} />}
      </div>
      <div className="part-inventory-detail">
        <h3>{part.name}</h3>
        <p>{part.description}</p>
      </div>
    </li>
  );
});

export default function PartInventory() {
  const [parts, setParts] = useState<CatalogPart[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const results = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    api.parts().then(({ parts: catalog }) => {
      if (!active) return;
      setParts(catalog);
      setStatus('ready');
    }).catch(() => {
      if (active) setStatus('error');
    });
    return () => { active = false; };
  }, [attempt]);

  useEffect(() => {
    if (results.current) results.current.scrollTop = 0;
  }, [query, category]);

  const categories = Array.from(new Set(parts.map((part) => part.category))).sort();
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const matches = parts.filter((part) => {
    if (category && part.category !== category) return false;
    const description = `${part.name} ${part.id} ${part.kind} ${part.category} ${part.description} ${part.material}`.toLowerCase();
    return terms.every((term) => description.includes(term));
  });

  return (
    <section id="parts" className="lab-section part-inventory" aria-labelledby="part-inventory-title">
      <div className="lab-section-heading">
        <div>
          <span className="lab-label part-inventory-kicker">Inside the parts library</span>
          <h2 id="part-inventory-title">Part inventory</h2>
          <p>Browse the catalog Muse uses to prototype. It picks parts with compatible mounts and can design custom components when a build needs a new shape.</p>
        </div>
      </div>
      <div className="part-inventory-panel">
        <div className="part-inventory-controls">
          <label>
            <span className="lab-label">Search parts</span>
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Try a motor, hinge, or wing" />
          </label>
          <label>
            <span className="lab-label">Category</span>
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">All categories</option>
              {categories.map((value) => <option key={value} value={value}>{categoryLabel(value)}</option>)}
            </select>
          </label>
          <p className="part-inventory-count" role="status">
            {status === 'loading' ? 'Loading the catalog…' : status === 'error' ? 'Catalog unavailable.' : `${matches.length} of ${parts.length} parts`}
          </p>
        </div>
        <div className="part-inventory-results" ref={results} tabIndex={0} role="region" aria-label="Catalog results">
          {matches.length > 0 && (
            <ul className="part-inventory-grid" role="list">
              {matches.map((part) => <InventoryCard key={part.id} part={part} />)}
            </ul>
          )}
          {status === 'ready' && matches.length === 0 && <p className="part-inventory-message">No matching parts. Try another search or category.</p>}
          {status === 'error' && (
            <button className="btn-secondary part-inventory-retry" type="button" onClick={() => { setStatus('loading'); setAttempt((previous) => previous + 1); }}>
              Retry loading catalog
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
