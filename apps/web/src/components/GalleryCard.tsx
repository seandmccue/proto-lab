import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import type { VersionRecord } from '@protolab/schema';
import { api, type InventionPublic } from '../api.ts';
import { keyMetric } from './BuildProgress.tsx';
import IsoPreview from './IsoPreview.tsx';
import './gallery.css';

export default function GalleryCard({ item }: { item: InventionPublic }) {
  const summaryId = useId();
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
  const lastTest = item.latestWalk ?? item.latestTest ?? item.tests[item.tests.length - 1];
  const metric = keyMetric(lastTest);
  const passed = item.status === 'passed';
  const test = version?.tests.find((t) => t.testId === lastTest?.testId) ?? version?.tests[version.tests.length - 1] ?? null;
  return (
    <Link to={`/i/${item.id}`} className="invention-card" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onFocus={() => setHover(true)} onBlur={() => setHover(false)} aria-label={`Explore ${item.title} in 3D`} aria-describedby={summaryId}>
      <div className="invention-card__preview">
        {version ? (
          <IsoPreview assembly={version.assembly} trace={traced ? test?.trace : null} playing={hover && traced && !reduced} className="h-full w-full" />
        ) : item.previewUrl ? (
          <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="invention-card__placeholder" aria-hidden="true"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" /><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" /></svg></div>
        )}
        <div className="invention-card__tags">
          {item.featured && <span>Featured</span>}
          {item.sourceInventionId && <span>Remix</span>}
        </div>
        <span className="invention-card__view-label" aria-hidden="true">ISO VIEW</span>
      </div>
      <div className="invention-card__body">
        <div className="invention-card__metrics">
          <span className={`invention-card__status ${passed ? 'is-passed' : ''}`}>{passed ? 'Tests passed' : 'Did not pass'}</span>
          {metric && <span className="invention-card__distance">{metric}</span>}
        </div>
        <h3>{item.title}</h3>
        <p className="line-clamp-2" id={summaryId}>{item.description || item.prompt}</p>
        <div className="invention-card__footer">
          <span>{item.ownerLabel} · {item.modelId === 'deterministic-planner' ? 'planner' : item.modelId}</span>
          <span className="invention-card__explore" aria-hidden="true">Explore in 3D ↗</span>
        </div>
      </div>
    </Link>
  );
}
