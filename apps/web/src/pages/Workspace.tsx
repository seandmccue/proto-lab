import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { VersionRecord } from '@protolab/schema';
import Header from '../components/Header.tsx';
import Viewer from '../components/Viewer.tsx';
import AssemblyTree from '../components/AssemblyTree.tsx';
import ActivityPanel, { Metrics, SpecPanel } from '../components/ActivityPanel.tsx';
import { api, fmt, type InventionDetail, type JobEvent } from '../api.ts';
import './Workspace.css';

export default function Workspace() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [detail, setDetail] = useState<InventionDetail | null>(null);
  const [jobId, setJobId] = useState<string | null>(params.get('job'));
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [jobStatus, setJobStatus] = useState<string>('queued');
  const [jobStep, setJobStep] = useState<string>('');
  const [versionId, setVersionId] = useState<string | null>(null);
  const [version, setVersion] = useState<VersionRecord | null>(null);
  const [prevVersion, setPrevVersion] = useState<VersionRecord | null>(null);
  const [testId, setTestId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
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
  const [remixOpen, setRemixOpen] = useState(false);
  const [mobilePane, setMobilePane] = useState<'canvas' | 'tree' | 'agent'>('canvas');
  const captureRef = useRef<(() => string | null) | null>(null);
  const uploadedPreview = useRef(false);
  const running = jobStatus === 'queued' || jobStatus === 'running';

  const refresh = useCallback(async () => {
    const d = await api.invention(id);
    setDetail(d);
    if (!jobId && d.latestJob) setJobId(d.latestJob.id);
    return d;
  }, [id, jobId]);

  useEffect(() => { refresh().catch((e) => setError((e as Error).message)); }, [refresh]);

  // Poll the job while it runs
  useEffect(() => {
    if (!jobId) return;
    let since = 0, stop = false;
    setEvents([]);
    const tick = async () => {
      try {
        const j = await api.job(jobId, since);
        if (stop) return;
        if (j.events.length) { setEvents((prev) => [...prev, ...j.events]); since = j.eventCount; }
        setJobStatus(j.status); setJobStep(j.step);
        if (j.events.some((e) => e.type === 'version' || e.type === 'done')) await refresh();
        if (j.status === 'queued' || j.status === 'running') setTimeout(tick, 700);
        else await refresh();
      } catch (e) { if (!stop) { setError((e as Error).message); } }
    };
    void tick();
    return () => { stop = true; };
  }, [jobId, refresh]);

  // Follow the newest version while running, otherwise keep the user's pick
  useEffect(() => {
    if (!detail) return;
    const latest = detail.versions[detail.versions.length - 1]?.id ?? null;
    if (!versionId || running) setVersionId(latest);
  }, [detail, running, versionId]);

  useEffect(() => {
    if (!versionId || !detail) return;
    let cancelled = false;
    api.version(id, versionId, true).then((r) => {
      if (cancelled) return;
      setVersion(r.version);
      setTestId((cur) => (cur && r.version.tests.some((t) => t.testId === cur) ? cur : r.version.tests[r.version.tests.length - 1]?.testId ?? null));
    }).catch((e) => setError((e as Error).message));
    const idx = detail.versions.findIndex((v) => v.id === versionId);
    const prev = idx > 0 ? detail.versions[idx - 1] : null;
    if (prev) api.version(id, prev.id, false).then((r) => { if (!cancelled) setPrevVersion(r.version); }).catch(() => {});
    else setPrevVersion(null);
    return () => { cancelled = true; };
  }, [id, versionId, detail]);

  // Once a passing version exists and the job is done, capture a thumbnail for the gallery (owner only).
  useEffect(() => {
    if (!detail || running || uploadedPreview.current || !version || !(detail.invention.isOwner || detail.invention.featured) || detail.invention.previewUrl) return;
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

  const act = async (fn: () => Promise<{ inventionId: string; jobId: string }>) => {
    setBusy(true); setError(null);
    try {
      const r = await fn();
      setRequest('');
      if (r.inventionId !== id) nav(`/i/${r.inventionId}?job=${r.jobId}`);
      else { setJobId(r.jobId); setJobStatus('queued'); }
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const inv = detail?.invention;
  const canFollowUp = !!inv?.isOwner && !running && !!inv.currentVersionId;
  const vmeta = detail?.versions.find((v) => v.id === versionId);

  return (
    <div className="workbench">
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
          <button className="btn-secondary" disabled={running || !inv?.currentVersionId} onClick={() => setRemixOpen(true)}>Remix</button>
          {inv?.isOwner && inv.visibility !== 'public' && <button className="btn-primary" disabled={running || !inv.currentVersionId} onClick={() => setPublishOpen(true)}>Publish</button>}
          <button className="btn-secondary !text-xs" disabled title="Coming soon: printable custom parts, purchased parts, tolerances and an assembly guide. Not available until validated.">3D Print — Coming Soon</button>
        </div>
      </div>
      {error && <div className="bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>}
      {jobStatus === 'error' && <div className="bg-amber-50 px-4 py-2 text-sm text-amber-800">The build stopped: {jobStep || 'error'}. {detail?.invention.currentVersionId ? 'The versions recorded so far are shown below; use “Request change” or Remix to continue from them.' : 'Nothing was recorded; start a new build.'}</div>}

      <div className="workbench-mobile-nav" role="group" aria-label="Workspace panels">
        {(['canvas', 'tree', 'agent'] as const).map((p) => <button key={p} onClick={() => setMobilePane(p)} aria-pressed={mobilePane === p}>{p === 'canvas' ? '3D view' : p === 'tree' ? 'Parts' : 'Agent'}</button>)}
      </div>

      <div className="workbench-grid">
        <aside className="workbench-panel workbench-parts" data-active={mobilePane === 'tree'} aria-label="Assembly and parts">
          {version ? <AssemblyTree assembly={version.assembly} selectedId={selected} onSelect={setSelected} changedIds={changedIds} /> : <div className="p-4 text-sm text-slate-400">{running ? 'Assembling…' : 'No assembly yet.'}</div>}
        </aside>

        <section className="workbench-panel workbench-canvas" data-active={mobilePane === 'canvas'} aria-label="3D simulation">
          <div className="workbench-panel-heading">
            <span className="workbench-label">3D simulation</span>
            {version && <span className="workbench-view-hint">Drag to orbit · Pinch or scroll to zoom</span>}
          </div>
          <div className="workbench-stage">
            {version ? (
              <Viewer assembly={version.assembly} test={test} playing={playing} speed={speed} explode={explode} blueprint={blueprint} follow={follow && explode === 0} selectedId={selected} changedIds={changedIds} onSelect={setSelected} onTime={(t, d) => { if (Math.abs(t - time.t) > 0.05 || d !== time.d) setTime({ t, d }); }} seekTo={seek} captureRef={captureRef} />
            ) : (
              <div className="flex h-full items-center justify-center text-slate-400">
                <div className="text-center"><div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-accent" /><p className="text-sm">{events.length ? String(events[events.length - 1].message ?? events[events.length - 1].summary ?? 'Working…') : 'Starting the engineering agent…'}</p></div>
              </div>
            )}
            {version && (
              <div className="workbench-readout">
                <span className="workbench-readout-model">v{version.iteration} · {version.modelId === 'deterministic-planner' ? 'deterministic planner' : version.modelId}{changedIds.size > 0 && <span className="ml-2 text-warn">● {changedIds.size} parts changed</span>}</span>
                {test && <span className={`rounded-md px-2 py-1 text-xs shadow-sm ${test.passed ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>{test.testId}: {test.passed ? 'passed' : 'did not pass'}{test.metrics.distance_m !== undefined ? ` · ${fmt.m2(test.metrics.distance_m)}` : test.metrics.landingDistance_m !== undefined ? ` · landed ${fmt.m2(test.metrics.landingDistance_m)}` : ''}{test.metrics.maxTilt_deg !== undefined ? ` · tilt ${fmt.deg(test.metrics.maxTilt_deg)}` : ''}</span>}
              </div>
            )}
          </div>
          <div className="workbench-toolbar">
            <div className="workbench-control-group" role="group" aria-label="Replay controls">
              <button className="btn-secondary" onClick={() => setPlaying((p) => !p)} disabled={!test} aria-label={playing ? 'Pause' : 'Play'}>{playing ? '❚❚' : '▶'}</button>
              <button className="btn-ghost" onClick={() => { setSeek(0); setTimeout(() => setSeek(null), 50); }} disabled={!test}>Reset</button>
              <input type="range" min={0} max={Math.max(0.01, time.d)} step={0.01} value={Math.min(time.t, time.d)} onChange={(e) => { setPlaying(false); setSeek(Number(e.target.value)); }} className="workbench-timeline" aria-label="Scrub time" disabled={!test} />
              <span className="mono whitespace-nowrap text-xs text-slate-600">{time.t.toFixed(2)} / {time.d.toFixed(1)} s</span>
              <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Playback speed"><option value={0.25}>0.25×</option><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option></select>
              {version && version.tests.length > 1 && (
                <select value={testId ?? ''} onChange={(e) => setTestId(e.target.value)} aria-label="Test to replay">{version.tests.map((t) => <option key={t.testId} value={t.testId}>{t.testId} {t.passed ? '✓' : '✗'}</option>)}</select>
              )}
            </div>
            <div className="workbench-control-group" role="group" aria-label="View controls">
              <label>Explode <input type="range" min={0} max={1} step={0.01} value={explode} onChange={(e) => setExplode(Number(e.target.value))} className="w-16" aria-label="Explode view" /></label>
              <button className="btn-ghost" aria-pressed={blueprint} onClick={() => setBlueprint((b) => !b)}>Blueprint</button>
              <label><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow</label>
            </div>
          </div>
          {canFollowUp && (
            <form onSubmit={(e) => { e.preventDefault(); if (request.trim()) void act(() => api.followUp(id, request.trim())); }} className="workbench-followup">
              <input value={request} onChange={(e) => setRequest(e.target.value)} aria-label="Describe a change" placeholder="Ask for a change: “Make it dance”, “Walk 30% further”, “Give it six legs”" className="min-w-0 flex-1 rounded-full border border-slate-200 px-4 py-2 text-sm outline-none focus:border-accent" maxLength={400} />
              <button type="submit" className="btn-primary" disabled={busy || request.trim().length < 2}>Request change</button>
              {version?.assembly.family === 'legged_walker' && !version?.spec.followUps.includes('dance') && <button type="button" className="btn-secondary" disabled={busy} onClick={() => void act(() => api.followUp(id, 'Make it dance'))}>Make it dance</button>}
            </form>
          )}
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

      {remixOpen && inv && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal>
          <form className="card w-full max-w-md p-5" onSubmit={(e) => { e.preventDefault(); const r = String(new FormData(e.currentTarget).get('change') || '').trim(); if (r.length >= 2) { setRemixOpen(false); void act(() => api.remix(id, r)); } }}>
            <h2 className="text-lg font-semibold">Remix this invention</h2>
            <p className="mt-1 text-sm text-slate-500">Forks the current version into your own invention, keeps credit to {inv.ownerLabel}, and asks the agent for one change.</p>
            <label className="mt-4 block text-sm">What should change?<input name="change" autoFocus defaultValue="Give it six legs" maxLength={400} className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2" /></label>
            <div className="mt-2 flex flex-wrap gap-1">{['Give it six legs', 'Walk 30% further', 'Make it dance', 'Use longer legs', 'Make it calmer'].map((s) => <button type="button" key={s} className="chip !py-1 !text-xs" onClick={(e) => { const f = (e.currentTarget.closest('form') as HTMLFormElement); (f.elements.namedItem('change') as HTMLInputElement).value = s; }}>{s}</button>)}</div>
            <div className="mt-4 flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={() => setRemixOpen(false)}>Cancel</button><button type="submit" className="btn-primary" disabled={busy}>Remix</button></div>
          </form>
        </div>
      )}
      {publishOpen && inv && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal>
          <form className="card w-full max-w-md p-5" onSubmit={async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); setBusy(true); try { await api.publish(id, { title: String(f.get('title') || inv.title), description: String(f.get('description') || inv.description) }); setPublishOpen(false); await refresh(); } catch (err) { setError((err as Error).message); } finally { setBusy(false); } }}>
            <h2 className="text-lg font-semibold">Publish to the gallery</h2>
            <p className="mt-1 text-sm text-slate-500">Anyone will be able to open the interactive 3D assembly, see its measured test results and remix it. Credit stays with you.</p>
            <label className="mt-4 block text-sm">Title<input name="title" defaultValue={inv.title} maxLength={80} className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2" /></label>
            <label className="mt-3 block text-sm">What it does<textarea name="description" defaultValue={inv.description} maxLength={400} rows={3} className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2" /></label>
            <p className="mt-3 text-xs text-slate-500">Status shown on the card: {inv.status === 'passed' ? 'tests passed' : 'did not pass'} · model: {version?.modelId}</p>
            <div className="mt-4 flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={() => setPublishOpen(false)}>Cancel</button><button type="submit" className="btn-primary" disabled={busy}>Publish</button></div>
          </form>
        </div>
      )}
    </div>
  );
}
