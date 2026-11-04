import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { VersionRecord } from '@protolab/schema';
import type { LargeShowcase } from '../../../large-showcases.mts';
import { api, sessionId, type InventionPublic } from '../api.ts';
import { keyMetric } from './BuildProgress.tsx';
import IsoPreview from './IsoPreview.tsx';
import './gallery.css';

const buildDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export default function GalleryCard({ item, replay = false, showcase }: { item: InventionPublic; replay?: boolean; showcase?: LargeShowcase }) {
  const summaryId = useId();
  const [hover, setHover] = useState(false);
  const [inView, setInView] = useState(false);
  const cardRef = useRef<HTMLAnchorElement>(null);
  // Every card on screen replays its recorded test; off-screen cards stay still so a long gallery stays cheap.
  useEffect(() => {
    const node = cardRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') { setInView(true); return; }
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { rootMargin: '120px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const untested = Boolean(item.currentVersionId && !item.tests.length);
  const showReplay = replay && !untested;
  const replayQuery = showReplay ? `?replay=1${showcase ? `&version=${encodeURIComponent(showcase.versionId)}` : ''}` : '';
  const lastTest = untested ? undefined : showcase ? item.tests.find((test) => test.testId === showcase.testIds[0]) : item.latestWalk ?? item.latestTest ?? item.tests.at(-1);
  const metric = showcase ? `${showcase.componentCount} components` : keyMetric(lastTest);
  const passed = item.status === 'passed';
  const createdAt = new Date(item.createdAt);
  return (
    <Link ref={cardRef} to={`/i/${item.id}${replayQuery}`} className="invention-card" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onFocus={() => setHover(true)} onBlur={() => setHover(false)} aria-label={showReplay ? `Replay ${item.title}` : `Explore ${item.title} in 3D`} aria-describedby={summaryId}>
      <div className={`invention-card__preview${showcase ? ' invention-card__preview--showcase' : ''}`}>
        <GalleryPreview key={item.currentVersionId ?? item.id} item={item} hover={hover || inView} testId={lastTest?.testId} preferSavedImage={!!showcase} />
        <div className="invention-card__tags">
          {item.visibility === 'private' && <span>Private</span>}
          {item.featured && <span>Featured</span>}
          {item.sourceInventionId && <span>Remix</span>}
        </div>
        <span className="invention-card__view-label" aria-hidden="true">ISO VIEW</span>
      </div>
      <div className="invention-card__body">
        <div className="invention-card__metrics">
          <span className={`invention-card__status ${passed ? 'is-passed' : ''}`}>{untested ? 'Not tested' : passed ? 'Tests passed' : 'Did not pass'}</span>
          {metric && <span className="invention-card__distance">{metric}</span>}
        </div>
        <h3>{item.title}</h3>
        <p className="line-clamp-2" id={summaryId}>{showcase?.detail || item.description || item.prompt}</p>
        {Number.isFinite(createdAt.getTime()) && (
          <time className="invention-card__date" dateTime={item.createdAt}>Created {buildDate.format(createdAt)}</time>
        )}
        <div className="invention-card__footer">
          <span>{item.ownerLabel} · {item.modelId === 'deterministic-planner' ? 'planner' : item.modelId}</span>
          <span className="invention-card__explore" aria-hidden="true">{showReplay ? 'Replay test ↗' : 'Explore in 3D ↗'}</span>
        </div>
      </div>
    </Link>
  );
}

function GalleryPreview({ item, hover, testId, preferSavedImage }: { item: InventionPublic; hover: boolean; testId?: string; preferSavedImage: boolean }) {
  const [version, setVersion] = useState<VersionRecord | null>(null);
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const [privateImage, setPrivateImage] = useState<{ url: string; src: string } | null>(null);
  const [traced, setTraced] = useState(false);
  const { id, currentVersionId, previewUrl } = item;
  const savedImage = preferSavedImage && item.visibility === 'public' && previewUrl !== failedImage ? previewUrl : null;
  const [checkedVersion, setCheckedVersion] = useState(!currentVersionId);
  const hasAssembly = Boolean(version?.assembly.instances.length);
  const animate = !preferSavedImage && hover && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  useEffect(() => {
    if (!checkedVersion || hasAssembly || item.visibility !== 'private' || !item.isOwner || previewUrl !== `/api/inventions/${id}/preview`) return;
    const controller = new AbortController();
    let src: string | undefined;
    fetch(previewUrl, { headers: { 'x-session-id': sessionId() }, signal: controller.signal })
      .then((response) => response.ok ? response.blob() : null)
      .then((blob) => {
        if (!blob || controller.signal.aborted) return;
        src = URL.createObjectURL(blob);
        setPrivateImage({ url: previewUrl, src });
      }).catch(() => {});
    return () => {
      controller.abort();
      if (src) URL.revokeObjectURL(src);
    };
  }, [checkedVersion, hasAssembly, id, item.visibility, item.isOwner, previewUrl]);
  useEffect(() => {
    if (!currentVersionId || savedImage) return;
    let cancelled = false;
    api.version(id, currentVersionId, false).then(({ version }) => {
      if (!cancelled) setVersion((current) => current ?? version);
    }).catch(() => {}).finally(() => {
      if (!cancelled) setCheckedVersion(true);
    });
    return () => { cancelled = true; };
  }, [id, currentVersionId, savedImage]);
  useEffect(() => {
    if (!animate || traced || !currentVersionId) return;
    let cancelled = false;
    api.version(id, currentVersionId, true).then(({ version }) => {
      if (cancelled) return;
      setVersion(version);
      setTraced(true);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [animate, traced, id, currentVersionId]);

  if (savedImage) {
    return <img src={savedImage} alt="" className="h-full w-full object-contain" decoding="async" onError={() => setFailedImage(savedImage)} />;
  }
  if (version?.assembly.instances.length) {
    const test = version.tests.find((test) => test.testId === testId) ?? version.tests.at(-1);
    return <IsoPreview assembly={version.assembly} trace={traced ? test?.trace : null} playing={animate && traced} className="h-full w-full" />;
  }
  const image = item.visibility === 'public' ? previewUrl : item.isOwner && privateImage?.url === previewUrl ? privateImage.src : null;
  if (image && image !== failedImage) {
    return <img src={image} alt="" className="h-full w-full object-cover" onError={() => setFailedImage(image)} />;
  }
  return (
    <div className="invention-card__placeholder" aria-hidden="true"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" /><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" /></svg></div>
  );
}
