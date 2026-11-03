import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { Assembly, VersionRecord } from '@protolab/schema';
import Header from '../components/Header.tsx';
import Viewer from '../components/Viewer.tsx';
import AssemblyTree from '../components/AssemblyTree.tsx';
import ActivityPanel, { Metrics, SpecPanel } from '../components/ActivityPanel.tsx';
import BuildProgress, { BuildStrip, IterationRibbon, SimulationStatus, keyMetric } from '../components/BuildProgress.tsx';
import { api, fmt, type InventionDetail, type JobEvent, type TestSummary, type VersionMeta } from '../api.ts';
import './Workspace.css';

/** Change suggestions that fit the mechanism actually built (wings, legs, rotors, launchers, grippers), not just walkers. */
function suggestionsFor(version: VersionRecord | null): string[] {
  if (!version) return ['Make it bigger', 'Make it faster', 'Change the colours'];
  const cats = new Set(version.assembly.parts.map((p) => p.category as string));
  const kinds = new Set(version.assembly.parts.map((p) => p.kind as string));
  const tests = new Set(version.tests.map((t) => t.kind));
  const out: string[] = [];
  if (version.assembly.parts.some((part) => /crab/i.test(part.name))) out.push('Scuttle 35 cm in 6 seconds', 'Keep peak tilt below 5°', 'Make the claws larger');
  if (version.assembly.family === 'legged_walker' || cats.has('legs')) out.push('Give it six legs', 'Walk 30% further', 'Make it dance', 'Use longer legs', 'Make it calmer');
  const rotor = kinds.has('big_wheel') || kinds.has('propeller') || kinds.has('wheel');
  // Sails and blades are wing parts too (style 3); only count real flapping wings.
  const flapping = kinds.has('insect_body') || version.assembly.parts.some((p) => p.category === 'wings' && !(p.kind === 'wing' && ((p.params as Record<string, number> | undefined)?.style ?? 0) >= 3) && !rotor);
  if (flapping) out.push('Give it four wings like a dragonfly', 'Flap faster', 'Bigger wings', 'Make it a bird instead', 'Slower, gentler flapping');
  if (rotor) out.push('Spin faster', 'Make the wheel bigger', 'Reverse the direction', kinds.has('gondola') ? 'Add more gondolas' : 'Add more blades');
  if (tests.has('launch')) out.push('Throw it twice as far', 'Launch a heavier ball', 'Lower the arc');
  if (tests.has('grip')) out.push('Grip a bigger block', 'Lift the block higher', 'Add a third finger');
  if (kinds.has('linear_actuator') || kinds.has('hinge')) out.push('Open it twice as fast', 'Make the deck longer');
  if (!out.length) out.push('Make it bigger', 'Make it faster', 'Change the colours', 'Add a decorative shell');
  return [...new Set(out)].slice(0, 6);
}

type ReplayStep = { version: VersionMeta; test: TestSummary; label: string };

function replayStory(versions: VersionMeta[]): ReplayStep[] {
  const results = versions.flatMap((version) => version.tests.map((test) => ({ version, test })));
  for (let i = results.length - 1; i >= 1; i--) {
    const passed = results[i];
    if (!passed.test.passed) continue;
    const failed = results.slice(0, i).reverse().find((result) =>
      !result.test.passed && result.version.iteration < passed.version.iteration &&
      sameTestName(result.test, passed.test)
    );
    if (!failed) continue;
    const dance = results.slice(i + 1).find((result) => result.test.passed && /^dance\b/i.test(result.test.testId));
    return [
      { ...failed, label: 'Before revision' },
      { ...passed, label: 'After revision' },
      ...(dance ? [{ ...dance, label: 'Dance' }] : []),
    ];
  }
  return [];
}

function revisionStory(before: VersionMeta, after: VersionMeta): ReplayStep[] {
  const result = after.tests[after.tests.length - 1];
  if (!result) return [];
  const baseline = [...before.tests].reverse().find((test) => test.kind === result.kind) ?? before.tests[before.tests.length - 1];
  return baseline ? [{ version: before, test: baseline, label: 'Before your change' }, { version: after, test: result, label: 'After your change' }] : [];
}

function sameTestName(before: TestSummary, after: TestSummary) {
  return before.kind === after.kind && before.testId.replace(/#\d+$/, '') === after.testId.replace(/#\d+$/, '');
}

function testReadout(test: TestSummary, label: string) {
  if (test.kind === 'walk' && test.metrics.distance_m !== undefined) {
    const tilt = test.metrics.maxTilt_deg;
    return `${fmt.cm(test.metrics.distance_m)} travelled${tilt !== undefined ? ` · ${fmt.deg(tilt)} peak tilt` : ''}`;
  }
  if (label === 'Dance' && test.metrics.maxTilt_deg !== undefined) return `tilt ${fmt.deg(test.metrics.maxTilt_deg)}`;
  return keyMetric(test);
}

function walkTargets(test: TestSummary): string | null {
  if (test.kind !== 'walk') return null;
  const reasons = test.failureReasons.join(' ');
  const distance = reasons.match(/target (\d+(?:\.\d+)?) m/i)?.[1];
  const tilt = reasons.match(/limit (\d+(?:\.\d+)?)°/i)?.[1];
  const duration = test.metrics.duration_s;
  const values = [
    distance && `at least ${Number(distance) * 100} cm${duration ? ` in ${duration} s` : ''}`,
    tilt && `at most ${tilt}° tilt`,
  ].filter(Boolean);
  return values.length ? values.join(' · ') : null;
}

type LiveSnapshot = Awaited<ReturnType<typeof api.jobAssembly>>;

function movedPart(before: Assembly['instances'][number] | undefined, after: Assembly['instances'][number]) {
  return !before || before.partId !== after.partId ||
    after.transform.position.some((value, i) => Math.abs(value - before.transform.position[i]) > 1e-4) ||
    Math.abs(after.transform.rotation.reduce((dot, value, i) => dot + value * before.transform.rotation[i], 0)) < 0.99999;
}

export default function Workspace() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const replayLink = params.get('replay') === '1';
  const nav = useNavigate();
  const [detail, setDetail] = useState<InventionDetail | null>(null);
  const [jobId, setJobId] = useState<string | null>(params.get('job'));
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [jobStatus, setJobStatus] = useState<string>(params.get('job') ? 'queued' : ''); // only a fresh ?job= link is known to be running; otherwise wait for the invention's latest job
  const [jobStep, setJobStep] = useState<string>('');
  const [reconnecting, setReconnecting] = useState(false);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [live, setLive] = useState<(LiveSnapshot & { newIds: string[]; changedIds: Set<string> }) | null>(null);
  const [viewMode, setViewMode] = useState<'auto' | 'live' | 'tested'>('auto');
  const [load, setLoad] = useState<{ active: number; queued: number; maxConcurrent: number } | null>(null); // queue hint while this build waits for a worker
  const [reveal, setReveal] = useState<{ snapshot: LiveSnapshot; count: number } | null>(null);
  const [introActive, setIntroActive] = useState(false);
  const [introBlueprint, setIntroBlueprint] = useState(false);
  const [reducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const hasLiveAssembly = Boolean(live?.assembly.instances.length);
  useEffect(() => {
    if (!hasLiveAssembly || reducedMotion) return;
    setIntroActive(true);
    setIntroBlueprint(true);
    const shade = setTimeout(() => setIntroBlueprint(false), 4000);
    const finish = setTimeout(() => setIntroActive(false), 4650);
    return () => {
      clearTimeout(shade);
      clearTimeout(finish);
      setIntroActive(false);
      setIntroBlueprint(false);
    };
  }, [hasLiveAssembly, jobId, reducedMotion]);
  const revealCount = !live || reducedMotion ? live?.newIds.length ?? 0 : reveal?.snapshot === live ? reveal.count : 1;
  useEffect(() => {
    if (!live || revealCount >= live.newIds.length) return;
    const timer = setTimeout(() => setReveal({ snapshot: live, count: revealCount + 1 }), Math.min(110, 1300 / live.newIds.length));
    return () => clearTimeout(timer);
  }, [live, revealCount]);
  const visibleLiveIds = useMemo(() => {
    if (!live || revealCount >= live.newIds.length) return undefined;
    const remaining = new Set(live.newIds.slice(revealCount));
    return new Set(live.assembly.instances.filter((part) => !remaining.has(part.id)).map((part) => part.id));
  }, [live, revealCount]);
  const liveHighlightIds = useMemo(() => {
    if (!live) return undefined;
    const additions = new Set(live.newIds);
    const highlighted = new Set([...live.changedIds].filter((id) => !additions.has(id)));
    const arriving = live.newIds[revealCount - 1];
    if (arriving) highlighted.add(arriving);
    return highlighted;
  }, [live, revealCount]);
  const [version, setVersion] = useState<VersionRecord | null>(null);
  const [prevVersion, setPrevVersion] = useState<VersionRecord | null>(null);
  const [testId, setTestId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(!reducedMotion);
  const [explode, setExplode] = useState(0);
  const [blueprint, setBlueprint] = useState(false);
  const [follow, setFollow] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [speed, setSpeed] = useState(1);
  const [time, setTime] = useState({ t: 0, d: 0 });
  const [seek, setSeek] = useState<number | null>(null);
  const [tab, setTab] = useState<'activity' | 'spec' | 'tests'>('activity');
  const [request, setRequest] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [changeMode, setChangeMode] = useState<'follow-up' | 'remix' | null>(null);
  const [sourceVersion, setSourceVersion] = useState<VersionRecord | null>(null);
  const [localRevision, setLocalRevision] = useState<{ jobId: string; versionId: string; changeRequest: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [explain, setExplain] = useState<{ vid: string; text: string; modelId: string; loading?: boolean } | null>(null);
  const [mobilePane, setMobilePane] = useState<'canvas' | 'tree' | 'agent'>('canvas');
  const [stageMode, setStageMode] = useState(replayLink);
  const captureRef = useRef<(() => string | null) | null>(null);
  const uploadedPreview = useRef(false);
  const running = jobStatus === 'queued' || jobStatus === 'running';
  const latestAssemblyEvent = useMemo(() => [...events].reverse().find((event) => event.type === 'assembly' || event.type === 'version'), [events]);
  const newerAssembly = latestAssemblyEvent?.type === 'assembly' && !!live && live.at >= latestAssemblyEvent.t;
  const showLive = hasLiveAssembly && (running
    ? !version || viewMode === 'live' || (viewMode === 'auto' && (newerAssembly || introActive))
    : introActive && viewMode === 'auto');
  const activeBlueprint = blueprint || (showLive && introBlueprint);
  const sourceId = detail?.source?.id;
  const sourceVersionId = detail?.source?.versionId ?? detail?.invention.parentVersionId;
  useEffect(() => {
    if (!sourceId || !sourceVersionId) return;
    let cancelled = false;
    api.version(sourceId, sourceVersionId).then(({ version }) => { if (!cancelled) setSourceVersion(version); }).catch(() => {});
    return () => { cancelled = true; };
  }, [sourceId, sourceVersionId]);

  const ownBaselineId = detail?.latestJob?.baselineVersionId ?? (localRevision?.jobId === jobId ? localRevision?.versionId : null);
  const revisionResultId = detail?.latestJob?.versionId;
  const changeBrief = detail?.latestJob?.changeRequest ?? localRevision?.changeRequest ?? detail?.source?.changeRequest;
  const story = useMemo(() => {
    const versions = detail?.versions ?? [];
    const ownBaseline = versions.find((v) => v.id === ownBaselineId);
    const before = ownBaseline ?? sourceVersion;
    const after = revisionResultId === undefined ? versions[versions.length - 1] : versions.find((v) => v.id === revisionResultId);
    const saved = replayStory(versions);
    if (!ownBaselineId && replayLink && saved.length) return saved;
    if (before && after && before.id !== after.id && (!ownBaseline || before.iteration < after.iteration)) {
      const revision = revisionStory(before, after);
      if (revision.length) return revision;
    }
    return saved;
  }, [detail?.versions, ownBaselineId, sourceVersion, replayLink, revisionResultId]);

  const refresh = useCallback(async () => {
    const d = await api.invention(id);
    setDetail(d);
    if (!jobId && d.latestJob) { setJobId(d.latestJob.id); setJobStatus(d.latestJob.status); }
    return d;
  }, [id, jobId]);

  const [missing, setMissing] = useState(false);
  useEffect(() => { refresh().catch((e) => { if (/not found|HTTP 404/i.test((e as Error).message)) setMissing(true); else setError((e as Error).message); }); }, [refresh]);

  // Poll the job while it runs
  useEffect(() => {
    if (!jobId) return;
    let since = 0, stop = false, retries = 0;
    let needsRefresh = false;
    let pendingAssembly: JobEvent | undefined;
    let readingAssembly = false;
    let wasActive = jobId === params.get('job') || jobId === localRevision?.jobId;
    let timer: ReturnType<typeof setTimeout>;
    setEvents([]);
    setLive(null);
    setReveal(null);
    setViewMode('auto');
    setReconnecting(false);
    const tick = async () => {
      try {
        const j = await api.job(jobId, since);
        if (stop) return;
        if (j.events.length) { setEvents((prev) => [...prev, ...j.events]); since = j.eventCount; }
        setJobStatus(j.status); setJobStep(j.step);
        if (j.status === 'queued') api.load().then((next) => { if (!stop) setLoad(next); }).catch(() => {}); else setLoad(null);
        const active = j.status === 'queued' || j.status === 'running';
        pendingAssembly = [...j.events].reverse().find((event) => event.type === 'assembly') ?? pendingAssembly;
        const recentlyFinished = wasActive && pendingAssembly && Date.now() - Date.parse(pendingAssembly.t) < 15_000;
        if ((active || recentlyFinished) && pendingAssembly && !readingAssembly) {
          const requested = pendingAssembly;
          readingAssembly = true;
          void api.jobAssembly(jobId).then((next) => {
            if (stop) return;
            if (pendingAssembly === requested || (pendingAssembly && pendingAssembly.t <= next.at)) pendingAssembly = undefined;
            setLive((previous) => {
              if (previous && previous.at >= next.at) return previous;
              const before = new Map(previous?.assembly.instances.map((part) => [part.id, part]));
              return {
                ...next,
                newIds: next.assembly.instances.filter((part) => !before.has(part.id)).map((part) => part.id),
                changedIds: new Set(next.assembly.instances.filter((part) => movedPart(before.get(part.id), part)).map((part) => part.id)),
              };
            });
          }).catch(() => {}).finally(() => { readingAssembly = false; });
        }
        needsRefresh ||= !active || j.events.some((e) => e.type === 'version' || e.type === 'done');
        if (needsRefresh) { await refresh(); needsRefresh = false; }
        if (stop) return;
        retries = 0;
        setReconnecting(false);
        if (active) {
          wasActive = true;
          timer = setTimeout(tick, 700);
        } else if (wasActive && j.versionId) {
          setVersionId(j.versionId);
        }
      } catch (e) {
        if (stop) return;
        if (/not found|forbidden|unauthorized|HTTP (400|401|403|404)/i.test((e as Error).message)) {
          setError((e as Error).message);
          return;
        }
        setReconnecting(true);
        timer = setTimeout(tick, Math.min(10_000, 1000 * 2 ** retries++));
      }
    };
    void tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [jobId, localRevision?.jobId, params, refresh]);

  // Follow the newest version while running, otherwise keep the user's pick
  useEffect(() => {
    if (!detail) return;
    const latest = detail.versions[detail.versions.length - 1]?.id ?? null;
    if (!versionId || (running && viewMode !== 'tested')) {
      const first = !running && stageMode ? story[0] : undefined;
      setVersionId(first?.version.id ?? latest);
      if (first) setTestId(first.test.testId);
    }
  }, [detail, running, stageMode, story, versionId, viewMode]);

  useEffect(() => {
    if (!versionId || !detail) return;
    let cancelled = false;
    const requestVersion = sourceVersion?.id === versionId ? Promise.resolve({ version: sourceVersion }) : api.version(id, versionId, true);
    requestVersion.then((r) => {
      if (cancelled) return;
      setVersion(r.version);
      setTestId((cur) => (cur && r.version.tests.some((t) => t.testId === cur) ? cur : r.version.tests[r.version.tests.length - 1]?.testId ?? null));
    }).catch((e) => setError((e as Error).message));
    const idx = detail.versions.findIndex((v) => v.id === versionId);
    const prev = story[1]?.version.id === versionId ? story[0].version : idx > 0 ? detail.versions[idx - 1] : null;
    setPrevVersion(null);
    if (prev?.id === sourceVersion?.id) setPrevVersion(sourceVersion);
    else if (prev) api.version(id, prev.id, false).then((r) => { if (!cancelled) setPrevVersion(r.version); }).catch(() => {});
    return () => { cancelled = true; };
  }, [id, versionId, detail, sourceVersion, story]);

  // Once a passing version exists and the job is done, capture a thumbnail for the gallery (owner only).
  useEffect(() => {
    if (!detail || running || uploadedPreview.current || !version || version.id !== detail.invention.currentVersionId || !detail.invention.isOwner || detail.invention.previewUrl) return;
    const timer = setTimeout(async () => {
      const dataUrl = captureRef.current?.();
      if (!dataUrl) return;
      uploadedPreview.current = true;
      const blob = await (await fetch(dataUrl)).blob();
      await api.preview(id, blob).catch(() => {});
    }, 1500);
    return () => clearTimeout(timer);
  }, [detail, running, version, id]);

  const test = useMemo(() => version?.tests.find((t) => t.testId === testId) ?? null, [version, testId]);
  const changedIds = useMemo(() => {
    if (!version || !prevVersion) return new Set<string>();
    const prevMap = new Map(prevVersion.assembly.instances.map((i) => [i.id, i]));
    const s = new Set<string>();
    for (const i of version.assembly.instances) {
      const p = prevMap.get(i.id);
      if (!p || p.partId !== i.partId || p.transform.position.some((v, k) => Math.abs(v - i.transform.position[k]) > 1e-4) || p.transform.rotation.some((v, k) => Math.abs(v - i.transform.rotation[k]) > 1e-4)) s.add(i.id);
    }
    return s;
  }, [version, prevVersion]);
  const driveChangedIds = useMemo(() => {
    if (!version || !prevVersion || changedIds.size) return new Set<string>();
    const before = new Map(prevVersion.assembly.controller.drives.map((drive) => [drive.controlId, JSON.stringify(drive)]));
    const after = new Map(version.assembly.controller.drives.map((drive) => [drive.controlId, JSON.stringify(drive)]));
    const ids = new Set<string>();
    for (const joint of version.assembly.joints) {
      const controlId = joint.motor?.controlId;
      if (controlId && before.get(controlId) !== after.get(controlId)) ids.add(joint.b.instanceId);
    }
    return ids;
  }, [version, prevVersion, changedIds]);

  const act = async (mode: 'follow-up' | 'remix', changeRequest: string) => {
    const baselineId = version?.inventionId === id ? version.id : detail?.invention.currentVersionId;
    if (!baselineId || busy) return;
    setBusy(true); setError(null);
    try {
      const run = mode === 'follow-up' ? api.followUp : api.remix;
      const r = await run(id, changeRequest, baselineId);
      setRequest('');
      setChangeMode(null);
      if (r.inventionId !== id) nav(`/i/${r.inventionId}?job=${r.jobId}`);
      else {
        setLocalRevision({ jobId: r.jobId, versionId: baselineId, changeRequest });
        setStageMode(false);
        setJobId(r.jobId);
        setJobStatus('queued');
      }
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const inv = detail?.invention;
  const storyStep = story.findIndex((step) => step.version.id === versionId && step.test.testId === testId);
  const currentStep = story[storyStep];
  const stepDecision = storyStep === 1 && version?.id === currentStep?.version.id ? version?.decisions.slice().reverse().find((decision) => decision.source === 'model') : undefined;
  const canRequestChange = !running && !!inv?.currentVersionId && !!version && version.id === versionId && version.inventionId === id;
  const comparing = !running && storyStep >= 0 && storyStep < 2;
  const cameraLock = comparing ? story.slice(0, 2).map((step) => step.version.id).join(':') : undefined;
  const target = story[0]?.label === 'Before revision' ? walkTargets(story[0].test) : null;
  const separateChecks = !!story[1] && !sameTestName(story[0].test, story[1].test);
  const vmeta = detail?.versions.find((v) => v.id === versionId);

  if (missing) {
    return (
      <div className="min-h-screen">
        <Header />
        <main className="mx-auto max-w-2xl px-4 py-20 text-center">
          <p className="text-xs font-mono uppercase tracking-widest text-slate-500">Invention unavailable</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">This invention is private or doesn’t exist</h1>
          <p className="mt-3 text-slate-600">Builds are private until their owner publishes them to the gallery. If someone sent you this link, ask them to publish it, or start your own.</p>
          <div className="mt-8 flex justify-center gap-3">
            <Link to="/" className="btn-primary">Start a new invention</Link>
            <Link to="/gallery" className="btn-secondary">Browse the gallery</Link>
          </div>
        </main>
      </div>
    );
  }
  return (
    <div className={`workbench${stageMode ? ' workbench--stage' : ''}`}>
      <Header compact />
      <div className="workbench-heading">
        <div className="min-w-0">
          <p className="workbench-label">Invention workbench</p>
          <div className="workbench-title">
            <h1>{inv?.title ?? 'Loading invention…'}</h1>
            {inv && <span className={`workbench-badge ${inv.status === 'passed' ? 'workbench-pass' : inv.status === 'failed' ? 'bg-amber-100 text-amber-800' : inv.status === 'error' ? 'bg-rose-100 text-rose-800' : 'bg-sky-100 text-sky-800'}`}>{running ? 'building' : inv.status === 'passed' ? 'tests passed' : inv.status === 'failed' ? 'did not pass' : inv.status}</span>}
            {inv?.visibility === 'public' && <span className="workbench-badge workbench-published">published</span>}
          </div>
          <p className="workbench-prompt">{inv?.prompt}{detail?.source && <> · remix of <Link className="text-accent hover:underline" to={`/i/${detail.source.id}`}>{detail.source.title}</Link> by {detail.source.ownerLabel}</>}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {inv && (
            <button className="btn-primary" disabled={!canRequestChange} onClick={() => { setError(null); setChangeMode(inv.isOwner ? 'follow-up' : 'remix'); }}>
              Request a change
            </button>
          )}
          {inv?.isOwner && <button className="btn-secondary" disabled={!canRequestChange} onClick={() => { setError(null); setChangeMode('remix'); }}>Remix</button>}
          {inv?.isOwner && inv.visibility !== 'public' && <button className="btn-primary" disabled={running || !inv.currentVersionId} onClick={() => setPublishOpen(true)}>Publish</button>}
          {inv?.visibility === 'public' && <button className="btn-secondary" onClick={() => { navigator.clipboard?.writeText(window.location.origin + '/i/' + inv.id + (stageMode ? '?replay=1' : '')).then(() => setCopied(true)).catch(() => {}); setTimeout(() => setCopied(false), 1500); }}>{copied ? 'Link copied' : 'Copy link'}</button>}
          <button className="btn-secondary !text-xs" disabled title="Coming soon: printable custom parts, purchased parts, tolerances and an assembly guide. Not available until validated.">3D Print — Coming Soon</button>
        </div>
      </div>
      {error && !changeMode && <div role="alert" className="bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>}
      {reconnecting && <div role="status" className="bg-amber-50 px-4 py-2 text-sm text-amber-800">Reconnecting to the build.{version && ' The last recorded simulation is still available.'}</div>}
      {jobStatus === 'error' && <div className="bg-amber-50 px-4 py-2 text-sm text-amber-800">The build stopped: {jobStep || 'error'}. {detail?.invention.currentVersionId ? 'Choose “Request a change” to continue from a recorded version.' : 'Start a new build to try again.'}</div>}

      <div className="workbench-mobile-nav" role="group" aria-label="Workspace panels">
        {(['canvas', 'tree', 'agent'] as const).map((p) => <button key={p} onClick={() => setMobilePane(p)} aria-pressed={mobilePane === p}>{p === 'canvas' ? '3D view' : p === 'tree' ? 'Parts' : 'Agent'}</button>)}
      </div>

      <div className="workbench-grid">
        <aside className="workbench-panel workbench-parts" data-active={mobilePane === 'tree'} aria-label="Assembly and parts">
          {showLive && live ? <AssemblyTree assembly={live.assembly} selectedId={selected} onSelect={setSelected} changedIds={liveHighlightIds} /> : version ? <AssemblyTree assembly={version.assembly} selectedId={selected} onSelect={setSelected} changedIds={changedIds} /> : <div className="p-4 text-sm text-slate-400">{running ? 'Assembling…' : 'No assembly yet.'}</div>}
        </aside>

        <section className="workbench-panel workbench-canvas" data-active={mobilePane === 'canvas'} aria-label="3D simulation">
          <div className="workbench-panel-heading">
            <span className="workbench-label">{running ? 'Live build' : '3D simulation'}</span>
            {running && hasLiveAssembly && version && (
              <div className="workbench-control-group" role="group" aria-label="Choose live assembly or recorded test">
                <button type="button" className="btn-ghost" aria-pressed={showLive} onClick={() => setViewMode('live')}>Live assembly</button>
                <button type="button" className="btn-ghost" aria-pressed={!showLive} onClick={() => setViewMode('tested')}>Tested replay</button>
              </div>
            )}
            {version && !running && (detail?.versions.length ?? 0) <= 1 && <span className="workbench-view-hint">Drag to orbit · Pinch or scroll to zoom</span>}
            {version && !running && <button type="button" className="btn-secondary workbench-stage-toggle" onClick={() => { setStageMode((mode) => !mode); setMobilePane('canvas'); }}>{stageMode ? 'Inspect workbench' : 'Expand 3D view'}</button>}
          </div>
          {(!stageMode || !story.length) && <IterationRibbon versions={detail?.versions ?? []} currentId={versionId} onPick={(next) => { if (running) setViewMode('tested'); setVersionId(next); }} />}
          {!running && story.length > 0 && (
            <div className="workbench-story">
              <div className="workbench-story-heading">
                <span className="workbench-label">Saved simulation</span>
                {target ? <span><strong>Original test target</strong> {target}</span> : <span>{separateChecks ? 'Each version has its own recorded test.' : 'Compare the recorded simulations before and after the revision.'}</span>}
              </div>
              {changeBrief && <p className="workbench-story-brief"><strong>Requested change</strong> {changeBrief}</p>}
              <div className="workbench-story-steps" role="group" aria-label="Simulation replay steps">
                {story.map((step, index) => (
                  <button key={step.test.testId} type="button" aria-pressed={storyStep === index} onClick={() => {
                    setVersionId(step.version.id);
                    setTestId(step.test.testId);
                    setExplode(0);
                    setBlueprint(false);
                    setPlaying(!window.matchMedia('(prefers-reduced-motion: reduce)').matches);
                  }}>
                    <span className="workbench-story-number">{index + 1}</span>
                    <span><strong>{step.label} <small className="workbench-story-version">v{step.version.iteration}</small></strong><small>{step.test.passed ? 'Passed' : 'Failed'} · {testReadout(step.test, step.label)}</small></span>
                  </button>
                ))}
              </div>
              {currentStep && (
                <p className="workbench-story-caption" aria-live="polite">
                  {stepDecision ? `${stepDecision.modelId === 'muse-wonder-1.0' ? 'Muse Wonder' : 'Muse'}’s adjustment: ${stepDecision.summary}` : currentStep.label === 'Dance' ? 'The robot swayed and bobbed while staying upright.' : currentStep.test.failureReasons.join(' · ') || (currentStep.test.passed ? 'The mechanism passed the recorded test.' : 'The test did not meet its target.')}
                </p>
              )}
              {storyStep === 1 && currentStep.test.failureReasons.length > 0 && stepDecision && <p className="workbench-story-caption">{currentStep.test.failureReasons.join(' · ')}</p>}
            </div>
          )}
          <SimulationStatus events={events} running={running} replay={!showLive && version && test ? { iteration: version.iteration, test, playing } : null} />
          <div className="workbench-stage">
            {showLive && live ? (
              <>
                <Viewer assembly={live.assembly} visibleInstanceIds={visibleLiveIds} enteringInstanceIds={reducedMotion ? undefined : live.newIds} test={null} playing={false} speed={1} explode={explode} blueprint={activeBlueprint} follow={false} selectedId={selected} changedIds={liveHighlightIds} onSelect={setSelected} autoRotate={!reducedMotion && !introBlueprint} />
                <div className="workbench-readout">
                  <span className="workbench-readout-model">{running ? 'Live assembly' : 'Assembly preview'} · v{live.iteration} · {visibleLiveIds ? `${visibleLiveIds.size} of ` : ''}{live.assembly.instances.length} parts placed</span>
                  <span className="rounded-md bg-sky-50 px-2 py-1 text-xs text-sky-800 shadow-sm">{running ? 'Assembly preview' : 'Showing the assembled parts before replay'}</span>
                  {live.rationale && <span className="rounded-md bg-sky-50 px-2 py-1 text-xs text-sky-800 shadow-sm">{live.rationale}</span>}
                </div>
              </>
            ) : version ? (
              <Viewer assembly={version.assembly} test={test} playing={playing} speed={speed} explode={explode} blueprint={blueprint} follow={follow && !comparing && explode === 0} cameraLock={cameraLock} selectedId={selected} changedIds={comparing && storyStep === 0 ? undefined : changedIds.size ? changedIds : driveChangedIds} onSelect={setSelected} onTime={(t, d) => { if (Math.abs(t - time.t) > 0.05 || d !== time.d) setTime({ t, d }); }} seekTo={seek} captureRef={captureRef} />
            ) : running ? (
              <BuildProgress events={events} running={running} jobStatus={jobStatus} load={load} brief={inv?.prompt} />
            ) : (
              <div className="p-6 text-sm text-slate-400">{detail ? 'No assembly yet.' : 'Loading invention…'}</div>
            )}
            {(version || showLive) && <BuildStrip events={events} running={running} />}
            {version && !showLive && (
              <div className="workbench-readout">
                <span className="workbench-readout-model">v{version.iteration} · {version.modelId === 'deterministic-planner' ? 'deterministic planner' : version.modelId}{!(comparing && storyStep === 0) && (changedIds.size > 0 ? <span className="ml-2 text-warn">● {changedIds.size} changed parts in orange</span> : driveChangedIds.size > 0 && <span className="ml-2 text-warn">● Drive changes in orange</span>)}</span>
                {test && <span className={`rounded-md px-2 py-1 text-xs shadow-sm ${test.passed ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>{test.passed ? 'Test passed' : 'Test failed'}{keyMetric(test) && ` · ${keyMetric(test)}`}</span>}
              </div>
            )}
          </div>
          <div className="workbench-toolbar">
            {!showLive && <div className="workbench-control-group" role="group" aria-label="Replay controls">
              <button className="btn-secondary" onClick={() => setPlaying((p) => !p)} disabled={!test} aria-label={playing ? 'Pause' : 'Play'}>{playing ? '❚❚' : '▶'}</button>
              <button className="btn-ghost" onClick={() => { setSeek(0); setTimeout(() => setSeek(null), 50); }} disabled={!test}>Reset</button>
              <input type="range" min={0} max={Math.max(0.01, time.d)} step={0.01} value={Math.min(time.t, time.d)} onChange={(e) => { setPlaying(false); setSeek(Number(e.target.value)); }} className="workbench-timeline" aria-label="Scrub time" disabled={!test} />
              <span className="mono whitespace-nowrap text-xs text-slate-600">{time.t.toFixed(2)} / {time.d.toFixed(1)} s</span>
              <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Playback speed"><option value={0.25}>0.25×</option><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option></select>
              {version && version.tests.length > 1 && (
                <select value={testId ?? ''} onChange={(e) => setTestId(e.target.value)} aria-label="Test to replay">{version.tests.map((t) => <option key={t.testId} value={t.testId}>{t.testId} {t.passed ? '✓' : '✗'}</option>)}</select>
              )}
            </div>}
            <div className="workbench-control-group" role="group" aria-label="View controls">
              <label>Explode <input type="range" min={0} max={1} step={0.01} value={explode} onChange={(e) => setExplode(Number(e.target.value))} className="w-16" aria-label="Explode view" /></label>
              <button className="btn-ghost" aria-pressed={activeBlueprint} onClick={() => { setIntroBlueprint(false); setBlueprint(!activeBlueprint); }}>Blueprint</button>
              {!showLive && (comparing ? <span className="workbench-view-hint">Same camera for both tests</span> : <label><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow</label>)}
            </div>
          </div>
        </section>

        <aside className="workbench-panel workbench-agent" data-active={mobilePane === 'agent'} aria-label="Engineering agent">
          <div className="workbench-agent-nav" role="group" aria-label="Agent panels">
            {(['activity', 'spec', 'tests'] as const).map((t) => <button key={t} onClick={() => setTab(t)} aria-pressed={tab === t}>{t}</button>)}
          </div>
          <div className="workbench-agent-content">
            {tab === 'activity' && <ActivityPanel events={events} running={running} versions={detail?.versions ?? []} currentVersionId={versionId} onPickVersion={setVersionId} status={jobStatus} />}
            {tab === 'spec' && <div className="overflow-auto p-3">{version ? <SpecPanel spec={version.spec} /> : <p className="text-xs text-slate-400">No spec yet.</p>}</div>}
            {tab === 'tests' && (
              <div className="overflow-auto p-3 space-y-3">
                {vmeta && <p className="text-xs text-slate-500">Version v{vmeta.iteration} · {new Date(vmeta.createdAt).toLocaleTimeString()} · engine: {version?.tests[0]?.engine}</p>}
                {version && !running && (
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-xs">
                    {explain?.vid === version.id && !explain.loading ? (
                      <><p className="text-slate-800 whitespace-pre-wrap">{explain.text}</p><p className="mt-1 text-[10px] text-slate-400">Explained by {explain.modelId} from this version's recorded decisions and measurements.</p></>
                    ) : (
                      <button className="btn-secondary !px-3 !py-1 !text-xs" disabled={explain?.loading} onClick={async () => { setExplain({ vid: version.id, text: '', modelId: '', loading: true }); try { const r = await api.explain(id, version.id); setExplain({ vid: version.id, ...r }); } catch (e) { setExplain({ vid: version.id, text: (e as Error).message, modelId: '' }); } }}>{explain?.loading ? 'Asking Muse…' : 'Ask Muse to explain this design'}</button>
                    )}
                  </div>
                )}
                {detail && detail.versions.length > 1 && (
                  <div className="rounded-md border border-slate-200 p-2 text-xs">
                    <div className="panel-title mb-1">Iterations</div>
                    <table className="w-full mono"><tbody>
                      {detail.versions.map((v) => { const t = v.tests[v.tests.length - 1]; const key = t ? (t.metrics.distance_m !== undefined ? ['distance', fmt.m2(t.metrics.distance_m)] : t.metrics.landingDistance_m !== undefined ? ['landing', fmt.m2(t.metrics.landingDistance_m)] : t.metrics.payloadDrop_m !== undefined ? ['payload drop', fmt.m2(t.metrics.payloadDrop_m)] : Object.entries(t.metrics).find(([k]) => k.endsWith('amplitude_rad')) ? ['amplitude', `${Object.entries(t.metrics).find(([k]) => k.endsWith('amplitude_rad'))![1].toFixed(2)} rad`] : ['tilt', fmt.deg(t.metrics.maxTilt_deg ?? 0)]) : ['', '']; return (
                        <tr key={v.id} className={`${v.id === versionId ? 'bg-accent-soft' : ''} cursor-pointer hover:bg-slate-50`} onClick={() => setVersionId(v.id)}>
                          <td className="px-1 py-0.5 text-slate-500">v{v.iteration}</td><td className="px-1 py-0.5">{t?.testId ?? '—'}</td><td className="px-1 py-0.5 text-slate-500">{key[0]}</td><td className="px-1 py-0.5">{key[1]}</td><td className={`px-1 py-0.5 ${v.status === 'passed' ? 'text-emerald-700' : 'text-rose-600'}`}>{v.status === 'passed' ? '✓' : '✗'}</td>
                        </tr>); })}
                    </tbody></table>
                  </div>
                )}
                {version && prevVersion && (() => {
                  const prevI = new Map(prevVersion.assembly.instances.map((i) => [i.id, i])); const curI = new Map(version.assembly.instances.map((i) => [i.id, i]));
                  const prevP = new Map(prevVersion.assembly.parts.map((p) => [p.id, p])); const curP = new Map(version.assembly.parts.map((p) => [p.id, p]));
                  const added = [...curI.values()].filter((i) => !prevI.has(i.id)); const removed = [...prevI.values()].filter((i) => !curI.has(i.id));
                  const swapped = [...curI.values()].filter((i) => prevI.has(i.id) && prevI.get(i.id)!.partId !== i.partId).map((i) => `${i.label}: ${prevP.get(prevI.get(i.id)!.partId)?.name ?? prevI.get(i.id)!.partId} → ${curP.get(i.partId)?.name ?? i.partId}`);
                  const prevD = new Map(prevVersion.assembly.controller.drives.map((d) => [d.controlId, JSON.stringify(d.profile)])); const driveChanges = version.assembly.controller.drives.filter((d) => prevD.get(d.controlId) !== JSON.stringify(d.profile)).map((d) => `${d.controlId}: ${d.profile.kind}${'amplitude' in d.profile ? ` ${(d.profile as { amplitude: number }).amplitude.toFixed(2)}` : ''}${'frequency_hz' in d.profile ? ` @ ${(d.profile as { frequency_hz: number }).frequency_hz} Hz` : ''}${'value' in d.profile ? ` ${(d.profile as { value: number }).value}` : ''}`);
                  const moved = changedIds.size - added.length - swapped.length;
                  if (!added.length && !removed.length && !swapped.length && !driveChanges.length && moved <= 0) return null;
                  return (
                    <div className="rounded-md border border-orange-200 bg-orange-50 p-2 text-xs text-slate-800">
                      <div className="panel-title mb-1 text-orange-700">Changed since v{prevVersion.iteration}</div>
                      {swapped.length > 0 && <div><span className="text-slate-500">Part swaps:</span> {swapped.slice(0, 6).join('; ')}{swapped.length > 6 ? ` (+${swapped.length - 6})` : ''}</div>}
                      {added.length > 0 && <div><span className="text-slate-500">Added:</span> {added.slice(0, 8).map((i) => i.label).join(', ')}{added.length > 8 ? ` (+${added.length - 8})` : ''}</div>}
                      {removed.length > 0 && <div><span className="text-slate-500">Removed:</span> {removed.slice(0, 8).map((i) => i.label).join(', ')}{removed.length > 8 ? ` (+${removed.length - 8})` : ''}</div>}
                      {moved > 0 && <div><span className="text-slate-500">Repositioned:</span> {moved} component{moved === 1 ? '' : 's'}</div>}
                      {driveChanges.length > 0 && <div><span className="text-slate-500">Drives:</span> {driveChanges.slice(0, 6).join('; ')}{driveChanges.length > 6 ? ` (+${driveChanges.length - 6})` : ''}</div>}
                    </div>
                  );
                })()}
                {version?.decisions.map((d, i) => (
                  <div key={i} className="rounded-md border border-sky-200 bg-sky-50 p-2 text-xs">
                    <div className="font-medium text-slate-800">{d.source === 'model' ? `Model decision${d.modelId ? ` · ${d.modelId}` : ''}` : 'Planner decision'}</div>
                    <p className="text-slate-700">{d.summary}</p>
                    {d.basedOn && <p className="mt-1 text-slate-500">Based on: {d.basedOn}</p>}
                    {Object.keys(d.changes).length > 0 && <ul className="mt-1 mono text-slate-600">{Object.entries(d.changes).map(([k, c]) => <li key={k}>{k}: {c.from !== undefined ? `${c.from} → ` : ''}{c.to}</li>)}</ul>}
                  </div>
                ))}
                {version?.tests.map((t) => (
                  <div key={t.testId} className={`rounded-md border p-2 text-xs ${t.passed ? 'border-emerald-200' : 'border-amber-200'}`}>
                    <div className="mb-1 flex items-center justify-between"><span className="font-medium">{t.testId}</span><span className={t.passed ? 'text-emerald-700' : 'text-amber-700'}>{t.passed ? 'passed' : 'did not pass'}</span></div>
                    <Metrics metrics={t.metrics} kind={t.kind} />
                    {t.failureReasons.length > 0 && <ul className="mt-1 list-disc pl-4 text-amber-800">{t.failureReasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
                    {t.notes?.length > 0 && <ul className="mt-1 list-disc pl-4 text-slate-500">{t.notes.map((r, i) => <li key={i}>{r}</li>)}</ul>}
                  </div>
                ))}
                {version && <p className="text-[11px] text-slate-400">Metrics are computed by the physics engine from this exact assembly and are reproducible. Rigid-body simulation is not engineering certification.</p>}
              </div>
            )}
          </div>
        </aside>
      </div>

      {changeMode && inv && version && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal aria-labelledby="revision-title" onKeyDown={(e) => { if (e.key === 'Escape' && !busy) setChangeMode(null); }}>
          <form className="card w-full max-w-md p-5" onSubmit={(e) => { e.preventDefault(); if (request.trim().length >= 2) void act(changeMode, request.trim()); }}>
            <h2 id="revision-title" className="text-lg font-semibold">Request a change</h2>
            <p className="mt-1 text-sm text-slate-600">
              {changeMode === 'remix' ? `Muse will use version ${version.iteration} to build a private remix and keep credit to ${inv.ownerLabel}.` : `Muse will use version ${version.iteration} as the baseline and save a new version of your invention.`}
            </p>
            <label className="mt-4 block text-sm">What should change?<input name="change" autoFocus value={request} onChange={(e) => setRequest(e.target.value)} placeholder={suggestionsFor(version)[0]} maxLength={400} className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2" /></label>
            <div className="mt-2 flex flex-wrap gap-1">{suggestionsFor(version).map((s) => <button type="button" key={s} className="chip !py-1 !text-xs" onClick={() => setRequest(s)}>{s}</button>)}</div>
            {error && <p role="alert" className="mt-2 text-sm text-rose-700">{error}</p>}
            <div className="mt-4 flex justify-end gap-2"><button type="button" className="btn-ghost" disabled={busy} onClick={() => setChangeMode(null)}>Cancel</button><button type="submit" className="btn-primary" disabled={busy || request.trim().length < 2}>{busy ? 'Starting…' : changeMode === 'remix' ? 'Build my remix' : 'Build revision'}</button></div>
          </form>
        </div>
      )}
      {publishOpen && inv && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal>
          <form className="card w-full max-w-md p-5" onSubmit={async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); setBusy(true); try { await api.publish(id, { title: String(f.get('title') || inv.title), description: String(f.get('description') || inv.description) }); setPublishOpen(false); await refresh(); } catch (err) { setError((err as Error).message); } finally { setBusy(false); } }}>
            <h2 className="text-lg font-semibold">Publish to the gallery</h2>
            <p className="mt-1 text-sm text-slate-500">Anyone will be able to open the interactive 3D assembly, see its measured test results and remix it. Credit stays with you.</p>
            <label className="mt-4 block text-sm">Title<input name="title" defaultValue={inv.title} maxLength={80} className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2" /></label>
            <label className="mt-3 block text-sm">What it does<textarea name="description" defaultValue={inv.description.slice(0, 400)} maxLength={400} rows={3} className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2" /></label>
            <p className="mt-3 text-xs text-slate-500">Status shown on the card: {inv.status === 'passed' ? 'tests passed' : 'did not pass'} · model: {version?.modelId}</p>
            <div className="mt-4 flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={() => setPublishOpen(false)}>Cancel</button><button type="submit" className="btn-primary" disabled={busy}>Publish</button></div>
          </form>
        </div>
      )}
    </div>
  );
}
