import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { tiltDeg, upVector } from '@protolab/parts';
import type { Assembly, TestResult, TestSpec, VersionRecord } from '@protolab/schema';
import Header from '../components/Header.tsx';
import Viewer from '../components/Viewer.tsx';
import { recordedPenPath } from '../components/replayEvidence.ts';
import ReplayComparison from '../components/ReplayComparison.tsx';
import CrabProofPanel, { crabProofPair } from '../components/CrabProofPanel.tsx';
import FollowerTimingEvidence from '../components/FollowerTimingEvidence.tsx';
import TriplexTimingEvidence from '../components/TriplexTimingEvidence.tsx';
import OrbitReplayEvidence, { curatedOrreryId } from '../components/OrbitReplayEvidence.tsx';
import TrayTiltEvidence from '../components/TrayTiltEvidence.tsx';
import LotusReplayEvidence from '../components/LotusReplayEvidence.tsx';
import ReceiverReplayEvidence, { replayReceiverTargets } from '../components/ReceiverReplayEvidence.tsx';
import IndexedMotionEvidence, { carouselBaselineVersionId } from '../components/IndexedMotionEvidence.tsx';
import type { DiagnosticTone } from '../components/diagnosticColors.ts';
import AssemblyTree from '../components/AssemblyTree.tsx';
import ActivityPanel, { Metrics, SpecPanel } from '../components/ActivityPanel.tsx';
import BuildProgress, { BuildStrip, IterationRibbon, LiveBuildHeartbeat, SimulationStatus, keyMetric, recordedTestSpec } from '../components/BuildProgress.tsx';
import { api, fmt, type InventionDetail, type JobEvent, type TestSummary, type VersionMeta } from '../api.ts';
import { largeShowcases } from '../../../large-showcases.mts';
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
const exhaustedTestBudget = /^Test budget \((\d+)\) exhausted\b/;

function movedPart(before: Assembly['instances'][number] | undefined, after: Assembly['instances'][number]) {
  return !before || before.partId !== after.partId ||
    after.transform.position.some((value, i) => Math.abs(value - before.transform.position[i]) > 1e-4) ||
    Math.abs(after.transform.rotation.reduce((dot, value, i) => dot + value * before.transform.rotation[i], 0)) < 0.99999;
}

function revisionChanges(before: Assembly, after: Assembly) {
  const previousParts = new Map(before.instances.map((part) => [part.id, part]));
  const changed = new Set(after.instances.filter((part) => movedPart(previousParts.get(part.id), part)).map((part) => part.id));
  const previousDrives = new Map(before.controller.drives.map((drive) => [drive.controlId, JSON.stringify(drive)]));
  const nextDrives = new Map(after.controller.drives.map((drive) => [drive.controlId, JSON.stringify(drive)]));
  const drives = new Set<string>();
  for (const joint of after.joints) {
    const controlId = joint.motor?.controlId;
    if (controlId && previousDrives.get(controlId) !== nextDrives.get(controlId)) drives.add(joint.b.instanceId);
  }
  return { changed, drives };
}

function walkTiltHighlight(assembly: Assembly, test: TestResult, definition: TestSpec | undefined, time: number) {
  if (test.kind !== 'walk' || test.passed || definition?.kind !== 'walk') return null;
  const { frames, dt } = test.trace;
  if (!frames.length || dt <= 0) return null;
  const end = Math.min(frames.length - 1, Math.round(time / dt));
  // Brief failures are easy to miss at normal playback speed. Hold the strongest
  // recent reading long enough to see which side the chassis leaned toward.
  const start = Math.max(0, Math.ceil((time - 0.45) / dt));
  let peak = { index: -1, tilt: definition.maxTilt_deg };
  for (let index = start; index <= end; index++) {
    const pose = frames[index].bodies[definition.base];
    const tilt = pose ? tiltDeg(pose.rotation) : 0;
    if (tilt > peak.tilt) peak = { index, tilt };
  }
  if (peak.index < 0) return null;
  const frame = frames[peak.index];
  const base = frame.bodies[definition.base];

  const highlights = new Map<string, DiagnosticTone>([[definition.base, 'failure']]);
  const [leanX, , leanZ] = upVector(base.rotation);
  const pads = new Set(assembly.parts.filter((part) => part.kind === 'foot_pad').map((part) => part.id));
  let feet = 0;
  for (const foot of assembly.instances) {
    const pose = frame.bodies[foot.id];
    if (!pads.has(foot.partId) || !pose) continue;
    const side = (pose.position[0] - base.position[0]) * leanX + (pose.position[2] - base.position[2]) * leanZ;
    if (side <= 0) continue;
    feet++;
    highlights.set(foot.id, 'failure');
    const link = assembly.joints.find((joint) => joint.type === 'fixed' && joint.b.instanceId === foot.id);
    if (link) highlights.set(link.a.instanceId, 'failure');
  }
  return { highlights, tilt: peak.tilt, feet, limit: definition.maxTilt_deg };
}

export default function Workspace() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const compareLink = params.get('compare') === '1';
  const replayLink = compareLink || params.get('replay') === '1';
  const requestedVersionId = replayLink ? params.get('version') : null;
  const nav = useNavigate();
  const [detail, setDetail] = useState<InventionDetail | null>(null);
  const [jobId, setJobId] = useState<string | null>(params.get('job'));
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [jobStatus, setJobStatus] = useState<string>(params.get('job') ? 'queued' : ''); // only a fresh ?job= link is known to be running; otherwise wait for the invention's latest job
  const [jobStep, setJobStep] = useState<string>('');
  const [reconnecting, setReconnecting] = useState(false);
  const [versionId, setVersionId] = useState<string | null>(null);
  const pinnedVersionId = detail?.versions.some((version) => version.id === requestedVersionId) ? requestedVersionId : null;
  const [presentPinnedVersion, setPresentPinnedVersion] = useState(true);
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
  const [showStrokeGuides, setShowStrokeGuides] = useState(() =>
    largeShowcases.find((entry) => entry.inventionId === id)?.showStrokeGuidesInitially ?? id !== 'inv_drawing_automaton');
  const [showMotionPath, setShowMotionPath] = useState(true);
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
  const [explain, setExplain] = useState<{ vid: string; text: string; modelId: string; loading?: boolean; error?: string } | null>(null);
  const [mobilePane, setMobilePane] = useState<'canvas' | 'tree' | 'agent'>('canvas');
  const [stageMode, setStageMode] = useState(replayLink);
  const [comparisonOpen, setComparisonOpen] = useState(compareLink);
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
  const showcase = largeShowcases.find((entry) => entry.inventionId === id && entry.versionId === detail?.invention.currentVersionId);
  const story = useMemo(() => {
    const versions = detail?.versions ?? [];
    if (replayLink && showcase?.baseline) {
      const before = versions.find((version) => version.id === showcase.baseline?.versionId);
      const after = versions.find((version) => version.id === showcase.versionId);
      const failed = before?.tests.find((test) => test.testId === showcase.baseline?.testId && !test.passed);
      const passed = after?.tests.find((test) => test.testId === showcase.testIds[0] && test.passed);
      if (before && after && before.iteration < after.iteration && failed && passed) return [
        { version: before, test: failed, label: 'Before revision' },
        { version: after, test: passed, label: 'After revision' },
      ];
    }
    const ownBaseline = versions.find((v) => v.id === ownBaselineId);
    const before = ownBaseline ?? sourceVersion;
    const after = revisionResultId === undefined ? versions[versions.length - 1] : versions.find((v) => v.id === revisionResultId);
    const saved = replayStory(versions);
    if (replayLink && detail?.invention.id === 'inv_b99f505fab294915') {
      const initial = versions.find((version) => version.id === carouselBaselineVersionId);
      const baseline = initial?.tests.find((test) => test.testId === 'geneva_10s#1' && !test.passed);
      const revision = [...versions].reverse().flatMap((version) => version.tests.map((test) => ({ version, test })))
        .find(({ test }) => test.passed && test.metrics.indexedConsecutiveSteps >= 2);
      if (initial && baseline && revision) return [
        { version: initial, test: baseline, label: 'Before revision' },
        { ...revision, label: 'After revision' },
      ];
    }
    if (replayLink && detail?.invention.id === 'inv_437c3b45e27d4138') {
      const initial = versions.find(({ iteration }) => iteration === 1);
      const baseline = initial?.tests.find((test) => !test.passed && test.metrics.groundContactViolation === 1);
      const revision = [...versions].reverse().flatMap((version) => version.tests.map((test) => ({ version, test })))
        .find(({ test }) => test.passed && test.metrics.endInHold_s >= 0.75);
      if (initial && baseline && revision) return [
        { version: initial, test: baseline, label: 'Before revision' },
        { ...revision, label: 'After revision' },
      ];
    }
    if (replayLink && detail?.invention.id === 'inv_ba7b3c7716564397') {
      const initial = versions.find((version) => version.id === 'ver_3989ed3cf2374987');
      const baseline = initial?.tests.find((test) => test.kind === 'motion' && test.testId === 'lotus_cycle#1');
      if (initial && baseline) {
        const revisions = versions.filter((version) => version.iteration > initial.iteration)
          .flatMap((version) => version.tests.filter((test) => sameTestName(baseline, test))
            .map((test) => ({ version, test }))).reverse();
        const revision = revisions.find(({ test }) => test.passed) ?? revisions[0];
        if (revision) return [
          { version: initial, test: baseline, label: 'Before revision' },
          { ...revision, label: 'After revision' },
        ];
      }
    }
    if (replayLink && detail?.invention.id === 'inv_d3f76fcc393b49d6' && saved[1]) {
      const initial = versions.find((version) => version.id === 'ver_26bf003825cd48d9');
      const failure = initial?.tests.find((test) => !test.passed && sameTestName(test, saved[1].test));
      if (initial && failure) return [
        { version: initial, test: failure, label: 'Before revision' },
        ...saved.slice(1),
      ];
    }
    if (replayLink && detail?.invention.id === curatedOrreryId) {
      const initial = versions.find((version) => version.id === 'ver_39ff127f0f23431a');
      const revision = versions.at(-1);
      if (initial && revision && initial.id !== revision.id) {
        const result = [...revision.tests].reverse().find((test) => test.kind === 'motion' &&
          initial.tests.some((baseline) => sameTestName(baseline, test)));
        const baseline = result && initial.tests.find((test) => sameTestName(test, result));
        if (baseline && result) return [
          { version: initial, test: baseline, label: 'First assembly' },
          { version: revision, test: result, label: 'Revised assembly' },
        ];
      }
    }
    if (!ownBaselineId && replayLink && saved.length) return saved;
    if (before && after && before.id !== after.id && (!ownBaseline || before.iteration < after.iteration)) {
      const revision = revisionStory(before, after);
      if (revision.length) return revision;
    }
    return saved;
  }, [detail?.versions, detail?.invention.id, ownBaselineId, sourceVersion, replayLink, revisionResultId, showcase]);

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
          setJobStatus('');
          setReconnecting(false);
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
      if (!versionId && !running && pinnedVersionId) {
        setVersionId(pinnedVersionId);
        setTestId(largeShowcases.find((entry) => entry.inventionId === id && entry.versionId === pinnedVersionId)?.testIds[0] ?? null);
        return;
      }
      const first = !running && stageMode ? story[0] : undefined;
      setVersionId(first?.version.id ?? latest);
      if (first) setTestId(first.test.testId);
    }
  }, [detail, id, pinnedVersionId, running, stageMode, story, versionId, viewMode]);

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
  const { changed: changedIds, drives: driveChangedIds } = useMemo(() => {
    if (!version || !prevVersion) return { changed: new Set<string>(), drives: new Set<string>() };
    return revisionChanges(prevVersion.assembly, version.assembly);
  }, [version, prevVersion]);
  const revisionHighlights = useMemo(() => {
    const highlights = new Map<string, DiagnosticTone>();
    for (const partId of [...changedIds, ...driveChangedIds]) highlights.set(partId, 'change');
    return highlights;
  }, [changedIds, driveChangedIds]);

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
        setComparisonOpen(false);
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
  const sharedTravel = story[0]?.test.kind === 'motion' && story[1]?.test.kind === 'motion' &&
    Object.keys(story[0].test.metrics).some((metric) => /\.travel_[xyz]_m$/.test(metric) && metric in story[1].test.metrics);
  const carouselPair = inv?.id === 'inv_b99f505fab294915' && story[0]?.version.id === carouselBaselineVersionId &&
    !!story[1]?.test.passed && story[1].test.metrics.indexedConsecutiveSteps >= 2;
  const canCompare = !running && !!story[1] && (!separateChecks || sharedTravel || carouselPair) && story[0].version.id !== story[1].version.id;
  const sideBySide = comparisonOpen && canCompare;
  const pinnedPresentation = presentPinnedVersion && stageMode && !sideBySide && !!pinnedVersionId && versionId === pinnedVersionId;
  const stageRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!changeMode && !publishOpen) return;
    const viewport = window.visualViewport;
    const fitDialog = () => {
      document.querySelectorAll<HTMLElement>('.workbench-dialog').forEach((dialog) => {
        dialog.style.top = `${viewport?.offsetTop ?? 0}px`;
        dialog.style.height = `${viewport?.height ?? window.innerHeight}px`;
      });
    };
    fitDialog();
    window.addEventListener('resize', fitDialog);
    viewport?.addEventListener('resize', fitDialog);
    viewport?.addEventListener('scroll', fitDialog);
    return () => {
      window.removeEventListener('resize', fitDialog);
      viewport?.removeEventListener('resize', fitDialog);
      viewport?.removeEventListener('scroll', fitDialog);
    };
  }, [changeMode, publishOpen]);
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const workbench = stage.closest('.workbench');
    const heading = stage.parentElement?.querySelector('.workbench-panel-heading');
    const fit = () => {
      if (!stage.getClientRects().length) return;
      const top = stage.getBoundingClientRect().top + window.scrollY;
      const viewport = window.visualViewport?.height ?? window.innerHeight;
      stage.style.setProperty('--stage-room', `${Math.floor(viewport - top - 12)}px`);
    };
    const observer = new ResizeObserver(fit);
    if (workbench) observer.observe(workbench);
    workbench?.querySelectorAll(':scope > :not(.workbench-grid)').forEach((element) => observer.observe(element));
    if (heading) observer.observe(heading);
    window.addEventListener('resize', fit);
    window.visualViewport?.addEventListener('resize', fit);
    fit();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', fit);
      window.visualViewport?.removeEventListener('resize', fit);
    };
  }, [sideBySide, mobilePane, running, reconnecting, Boolean(error), jobStatus, stageMode, inv?.title, version?.id]);
  const canonicalProof = sideBySide && story[0].version.id === crabProofPair.beforeId && story[1].version.id === crabProofPair.afterId;
  const vmeta = detail?.versions.find((v) => v.id === versionId);
  const [earlierTestSpecs, setEarlierTestSpecs] = useState<Record<string, TestSpec>>({});
  const testSpecKey = version && test ? `${version.id}/${test.testId}` : null;
  const testDefinition = test && version
    ? recordedTestSpec(test.testId, [version, prevVersion?.id === version.parentVersionId ? prevVersion : null]) ?? (testSpecKey ? earlierTestSpecs[testSpecKey] : undefined)
    : undefined;
  const strokeTargets = testDefinition?.kind === 'motion' && test?.trace.frames.length ? testDefinition.measure.linearTravel : undefined;
  const receiverTarget = replayReceiverTargets(testDefinition);
  const receiverPath = Array.isArray(receiverTarget) ? undefined : receiverTarget?.instance;
  const motionPath = receiverPath ?? (version ? recordedPenPath(version.assembly, test) : undefined);
  const sourceParentId = detail?.source?.versionId;
  useEffect(() => {
    if (!version || !test || !testSpecKey || testDefinition || !version.parentVersionId) return;
    let cancelled = false;
    void (async () => {
      let ancestor = prevVersion?.id === version.parentVersionId ? prevVersion : version;
      const visited = new Set([ancestor.id]);
      while (!cancelled && ancestor.parentVersionId && !visited.has(ancestor.parentVersionId)) {
        const parentId = ancestor.parentVersionId;
        visited.add(parentId);
        const inventionId = parentId === sourceParentId && sourceId ? sourceId : ancestor.inventionId;
        ancestor = (await api.version(inventionId, parentId, false)).version;
        const definition = recordedTestSpec(test.testId, [ancestor]);
        if (definition) {
          if (!cancelled) setEarlierTestSpecs((cached) => ({ ...cached, [testSpecKey]: definition }));
          break;
        }
      }
    })().catch(() => {});
    return () => { cancelled = true; };
  }, [version, test, testSpecKey, testDefinition, prevVersion, sourceId, sourceParentId]);
  const revisionDecision = version?.decisions.slice().reverse().find((decision) =>
    decision.source === 'model' && (decision.previousTestId || decision.basedOn));
  const tiltHighlight = !showLive && version && test && version.id === versionId
    ? walkTiltHighlight(version.assembly, test, testDefinition, time.t)
    : null;
  const showRevisionHighlights = !showLive && version?.id === versionId && test && storyStep === 1 &&
    prevVersion?.id === story[0]?.version.id && revisionHighlights.size > 0;
  const preserveOrbitColors = inv?.id === curatedOrreryId && !comparing;
  const diagnosticHighlights = pinnedPresentation ? undefined : tiltHighlight?.highlights ?? (showRevisionHighlights ? revisionHighlights : undefined);
  const showChangeColors = !pinnedPresentation && !preserveOrbitColors && !(comparing && storyStep === 0);
  const currentUntested = Boolean(inv?.currentVersionId && !inv.tests.length);
  const savedProgress = Boolean(inv?.currentVersionId);
  const stoppedBuild = jobStatus === 'error' || (jobStatus === 'done' && (currentUntested || inv?.status === 'failed'));
  const stoppedEvent = stoppedBuild ? [...events].reverse().find((event) => jobStatus === 'error'
    ? event.type === 'error' : event.type === 'done' && event.status === 'failed') : undefined;
  const outcomeText = stoppedEvent?.type === 'error' ? stoppedEvent.message : stoppedEvent?.summary;
  const stoppedSummary = typeof outcomeText === 'string' ? outcomeText.trim() : '';
  const stoppedReason = jobStatus === 'error' ? jobStep || 'Build error'
    : currentUntested ? 'Not tested' : savedProgress ? 'Design did not pass' : 'No version saved';
  const exhaustedTest = stoppedBuild && jobStatus === 'done' ? events.find((event) =>
    event.type === 'tool' && event.tool === 'run_test' && event.ok === false &&
    typeof event.summary === 'string' && exhaustedTestBudget.test(event.summary)) : undefined;
  const testLimit = typeof exhaustedTest?.summary === 'string' ? exhaustedTestBudget.exec(exhaustedTest.summary)?.[1] : undefined;
  const finalVersion = !running && inv?.status === 'passed' && version?.id === inv.currentVersionId ? version : null;
  const finalEvent = finalVersion && detail?.latestJob?.versionId === finalVersion.id
    ? [...events].reverse().find((event) => event.type === 'done' && event.status === 'passed')
    : undefined;
  const finalSummary = (typeof finalEvent?.summary === 'string' ? finalEvent.summary : inv?.description?.trim()) || finalVersion?.spec.plan?.purpose;
  const replayStatus = !showLive && version && test
    ? { iteration: version.iteration, test, playing, definition: testDefinition, adjustment: revisionDecision?.summary }
    : null;


  const askForExplanation = async (target: VersionRecord) => {
    setExplain({ vid: target.id, text: '', modelId: '', loading: true });
    try {
      const result = await api.explain(target.inventionId, target.id);
      setExplain((current) => current?.vid === target.id ? { vid: target.id, ...result } : current);
    } catch (error) {
      setExplain((current) => current?.vid === target.id ? { vid: target.id, text: '', modelId: '', error: (error as Error).message } : current);
    }
  };

  const renderExplanation = (target: VersionRecord) => {
    const explanation = explain?.vid === target.id ? explain : null;
    if (explanation?.text) {
      return <div className="workbench-explanation-muse"><p>{explanation.text}</p><small>Explained by {explanation.modelId} from the recorded design and tests.</small></div>;
    }
    return (
      <>
        {explanation?.error && <p role="alert">{explanation.error}</p>}
        <button type="button" className="btn-secondary" disabled={explanation?.loading} onClick={() => void askForExplanation(target)}>
          {explanation?.loading ? 'Asking Muse…' : explanation?.error ? 'Retry explanation' : 'Ask Muse for more detail'}
        </button>
      </>
    );
  };

  if (missing) {
    return (
      <div className="min-h-screen">
        <Header />
        <main className="mx-auto max-w-2xl px-4 py-20 text-center">
          <p className="text-xs font-mono uppercase tracking-widest text-muted">Invention unavailable</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">This invention is private or doesn’t exist</h1>
          <p className="mt-3 text-muted">Builds are private until their owner publishes them to the gallery. If someone sent you this link, ask them to publish it, or start your own.</p>
          <div className="mt-8 flex justify-center gap-3">
            <Link to="/" className="btn-primary">Start a new invention</Link>
            <Link to="/gallery" className="btn-secondary">Browse the gallery</Link>
          </div>
        </main>
      </div>
    );
  }
  const storyControls = !running && story.length > 0 && (
    <div className="workbench-story">
      <div className="workbench-story-heading">
        <span className="workbench-label">Saved simulation</span>
        {target ? <span><strong>Original test target</strong> {target}</span> : <span>{separateChecks ? 'Each version has its own recorded test.' : 'Compare the recorded simulations before and after the revision.'}</span>}
        {canCompare && !sideBySide && <button type="button" className="btn-secondary workbench-comparison-toggle" onClick={() => {
          setPresentPinnedVersion(false);
          setComparisonOpen(true);
          setVersionId(story[0].version.id);
          setTestId(story[0].test.testId);
          setStageMode(true);
          setMobilePane('canvas');
        }}>Compare side by side</button>}
      </div>
      {changeBrief && <p className="workbench-story-brief"><strong>Requested change</strong> {changeBrief}</p>}
      {!sideBySide && <div className="workbench-story-steps" role="group" aria-label="Simulation replay steps">
        {story.map((step, index) => (
          <button key={`${step.version.id}/${step.test.testId}`} type="button" aria-pressed={storyStep === index} onClick={() => {
            setPresentPinnedVersion(false);
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
      </div>}
      {!sideBySide && currentStep && (
        <p className="workbench-story-caption" aria-live="polite">
          {stepDecision ? `${stepDecision.modelId === 'muse-wonder-1.0' ? 'Muse Wonder' : 'Muse'}’s adjustment: ${stepDecision.summary}` : currentStep.label === 'Dance' ? 'The robot swayed and bobbed while staying upright.' : currentStep.test.failureReasons.join(' · ') || (currentStep.test.passed ? 'The mechanism passed the recorded test.' : 'The test did not meet its target.')}
        </p>
      )}
      {!sideBySide && storyStep === 1 && currentStep.test.failureReasons.length > 0 && stepDecision && <p className="workbench-story-caption">{currentStep.test.failureReasons.join(' · ')}</p>}
    </div>
  );
  const requestChangeButton = inv && (
    <button type="button" className="btn-primary" disabled={!canRequestChange} onClick={() => { setError(null); setChangeMode(inv.isOwner ? 'follow-up' : 'remix'); }}>
      Request a change
    </button>
  );
  const workbenchActions = <>
    {!stoppedBuild && requestChangeButton}
    {inv?.isOwner && <button className="btn-secondary" disabled={!canRequestChange} onClick={() => { setError(null); setChangeMode('remix'); }}>Remix</button>}
    {inv?.isOwner && inv.visibility !== 'public' && <button className="btn-primary" disabled={running || !inv.currentVersionId} onClick={() => setPublishOpen(true)}>Publish</button>}
    {inv?.visibility === 'public' && <button className="btn-secondary" onClick={() => {
      const link = new URL(`/i/${inv.id}`, window.location.origin);
      if (stageMode || sideBySide || pinnedVersionId) link.searchParams.set('replay', '1');
      if (sideBySide) link.searchParams.set('compare', '1');
      else if (pinnedVersionId) {
        const selectedVersionId = detail?.versions.find((candidate) => candidate.id === versionId)?.id;
        link.searchParams.set('version', selectedVersionId ?? pinnedVersionId);
      }
      navigator.clipboard?.writeText(link.href).then(() => setCopied(true)).catch(() => {});
      setTimeout(() => setCopied(false), 1500);
    }}>{copied ? 'Link copied' : 'Copy link'}</button>}
    <button className="btn-secondary !text-xs" disabled title="Coming soon: printable custom parts, purchased parts, tolerances and an assembly guide. Not available until validated.">3D Print — Coming Soon</button>
  </>;
  const prompt = <>{inv?.prompt}{detail?.source && <> · remix of <Link className="text-accent hover:underline" to={`/i/${detail.source.id}`}>{detail.source.title}</Link> by {detail.source.ownerLabel}</>}</>;
  return (
    <div className={`workbench${stageMode ? ' workbench--stage' : ''}${running || reconnecting ? ' workbench--building' : ''}`}>
      <Header compact />
      <div className="workbench-heading">
        <div className="min-w-0">
          <p className="workbench-label">Invention workbench</p>
          <div className="workbench-title">
            <h1>{inv?.title ?? 'Loading invention…'}</h1>
            {inv && <span className={`workbench-badge ${inv.status === 'passed' ? 'workbench-pass' : currentUntested || inv.status === 'failed' ? 'bg-warn/15 text-warn' : inv.status === 'error' ? 'bg-fail/15 text-fail' : 'bg-accent/15 text-accent'}`}>{running ? 'building' : currentUntested ? 'not tested' : inv.status === 'passed' ? 'tests passed' : inv.status === 'failed' ? 'did not pass' : inv.status}</span>}
            {inv?.visibility === 'public' && <span className="workbench-badge workbench-published">published</span>}
          </div>
          <p className="workbench-prompt workbench-heading-prompt">{prompt}</p>
        </div>
        <div className="workbench-heading-actions">{workbenchActions}</div>
      </div>
      {error && !changeMode && <div role="alert" className="bg-fail/15 px-4 py-2 text-sm text-fail">{error}</div>}
      {(running || reconnecting) && <LiveBuildHeartbeat events={events} jobStatus={jobStatus} reconnecting={reconnecting} load={load} />}
      {stoppedBuild && <section className="workbench-build-outcome" aria-label="Build outcome">
        <div className="workbench-build-outcome-status" role="status">
          <strong>Build stopped</strong>
          <span>{savedProgress && 'Progress saved · '}{stoppedReason}</span>
        </div>
        {savedProgress ? requestChangeButton : <Link to="/" className="btn-secondary">Start a new build</Link>}
        {stoppedSummary && <a className="workbench-build-outcome-link" href="#build-outcome-summary">Build summary ↓{testLimit && ` · ${testLimit}-test limit reached`}</a>}
      </section>}

      <div className="workbench-mobile-nav" role="group" aria-label="Workspace panels">
        {(['canvas', 'tree', 'agent'] as const).map((p) => <button key={p} onClick={() => setMobilePane(p)} aria-pressed={mobilePane === p}>{p === 'canvas' ? '3D view' : p === 'tree' ? 'Parts' : 'Agent'}</button>)}
      </div>

      <div className="workbench-grid">
        <aside className="workbench-panel workbench-parts" data-active={mobilePane === 'tree'} aria-label="Assembly and parts">
          {showLive && live ? <AssemblyTree assembly={live.assembly} selectedId={selected} onSelect={setSelected} changedIds={liveHighlightIds} /> : version ? <AssemblyTree assembly={version.assembly} selectedId={selected} onSelect={setSelected} changedIds={changedIds} /> : <div className="p-4 text-sm text-dim">{running ? 'Assembling…' : 'No assembly yet.'}</div>}
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
            {version && !running && (detail?.versions.length ?? 0) <= 1 && <span className="workbench-view-hint">Drag to orbit · Use + or − to zoom</span>}
            {finalVersion && <a href="#prototype-explanation" className="btn-ghost">How it works ↓</a>}
            {version && !running && <button type="button" className="btn-secondary workbench-stage-toggle" onClick={() => { setComparisonOpen(false); setStageMode((mode) => !mode); setMobilePane('canvas'); }}>{stageMode ? 'Inspect workbench' : 'Expand 3D view'}</button>}
          </div>
          {sideBySide ? <>
            <ReplayComparison key={`${story[0].version.id}/${story[1].version.id}`} before={{ inventionId: story[0].version.id === sourceVersion?.id && sourceId ? sourceId : id, versionId: story[0].version.id, testId: story[0].test.testId, label: story[0].label }} after={{ inventionId: id, versionId: story[1].version.id, testId: story[1].test.testId, label: story[1].label }} reducedMotion={reducedMotion} events={events} baselineDefinition={version?.id === story[0].version.id ? testDefinition : undefined} findTilt={walkTiltHighlight} revisionChanges={revisionChanges} onShowSingle={() => setComparisonOpen(false)} />
            {storyControls}
            {canonicalProof && <CrabProofPanel />}
          </> : <>
          <div className="workbench-stage" ref={stageRef}>
            {showLive && live ? (
              <>
                <Viewer assembly={live.assembly} visibleInstanceIds={visibleLiveIds} enteringInstanceIds={reducedMotion ? undefined : live.newIds} test={null} playing={false} speed={1} explode={explode} blueprint={activeBlueprint} follow={false} selectedId={selected} changedIds={liveHighlightIds} onSelect={setSelected} autoRotate={!reducedMotion && !introBlueprint} />
                <div className="workbench-readout">
                  <span className="workbench-readout-model">{running ? 'Live assembly' : 'Assembly preview'} · v{live.iteration} · {visibleLiveIds ? `${visibleLiveIds.size} of ` : ''}{live.assembly.instances.length} parts placed</span>
                  <span className="rounded-md bg-accent/15 px-2 py-1 text-xs text-accent shadow-none">{running ? 'Assembly preview' : 'Showing the assembled parts before replay'}</span>
                  {live.rationale && <span className="rounded-md bg-accent/15 px-2 py-1 text-xs text-accent shadow-none">{live.rationale}</span>}
                </div>
              </>
            ) : version ? (
              <Viewer assembly={version.assembly} test={test} playing={playing} speed={speed} explode={explode} blueprint={blueprint} follow={follow && !comparing && explode === 0} cameraLock={cameraLock} selectedId={selected} diagnosticHighlights={diagnosticHighlights} changedIds={!diagnosticHighlights && showChangeColors ? (changedIds.size ? changedIds : driveChangedIds) : undefined} onSelect={setSelected} onTime={(t, d) => { if (Math.abs(t - time.t) > 0.05 || d !== time.d) setTime({ t, d }); }} seekTo={seek} captureRef={captureRef}
                strokeTargets={showStrokeGuides ? strokeTargets : undefined} pathInstanceId={showMotionPath ? motionPath : undefined} />
            ) : running ? (
              <BuildProgress events={events} running={running} jobStatus={jobStatus} load={load} brief={inv?.prompt} />
            ) : (
              <div className="p-6 text-sm text-dim">{detail ? 'No assembly yet.' : 'Loading invention…'}</div>
            )}
            {(version || showLive) && <BuildStrip events={events} running={running} />}
            {version && !showLive && (
              <div className="workbench-readout">
                <span className="workbench-readout-model">v{version.iteration} · {version.modelId === 'deterministic-planner' ? 'deterministic planner' : version.modelId}{!diagnosticHighlights && showChangeColors && (changedIds.size > 0 ? <span className="ml-2 text-warn">● {changedIds.size} changed parts in orange</span> : driveChangedIds.size > 0 && <span className="ml-2 text-warn">● Drive changes in orange</span>)}</span>
                {!version.tests.length && <span className="rounded-md bg-accent/15 px-2 py-1 text-xs text-accent shadow-none">Assembly saved · No completed simulation</span>}
                {test && <span className={`rounded-md px-2 py-1 text-xs shadow-none ${test.passed ? 'bg-pass/15 text-pass' : 'bg-warn/15 text-warn'}`}>{test.passed ? 'Test passed' : 'Test failed'}{keyMetric(test) && ` · ${keyMetric(test)}`}</span>}
                {diagnosticHighlights && <div className={`workbench-diagnostic${tiltHighlight ? ' is-failure' : ''}`}>
                  <strong>{tiltHighlight ? 'Tilt limit exceeded' : stepDecision ? 'Changed by Muse' : 'Changed in this revision'}</strong>
                  <span>{tiltHighlight
                    ? `${fmt.deg(tiltHighlight.tilt)} recorded tilt · ${fmt.deg(tiltHighlight.limit)} limit${tiltHighlight.feet ? ' · Legs on the lean side highlighted' : ''}`
                    : `${revisionHighlights.size} parts highlighted · pose or drive changes`}</span>
                </div>}
              </div>
            )}
          </div>
          <div className="workbench-toolbar">
            {!showLive && <div className="workbench-control-group" role="group" aria-label="Replay controls">
              <button className="btn-secondary" onClick={() => setPlaying((p) => !p)} disabled={!test} aria-label={playing ? 'Pause' : 'Play'}>{playing ? '❚❚' : '▶'}</button>
              <button className="btn-ghost" onClick={() => { setSeek(0); setTimeout(() => setSeek(null), 50); }} disabled={!test}>Reset</button>
              <input type="range" min={0} max={Math.max(0.01, time.d)} step={0.01} value={Math.min(time.t, time.d)} onChange={(e) => { setPlaying(false); setSeek(Number(e.target.value)); }} className="workbench-timeline" aria-label="Scrub time" disabled={!test} />
              <span className="mono whitespace-nowrap text-xs text-muted">{time.t.toFixed(2)} / {time.d.toFixed(1)} s</span>
              <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Playback speed"><option value={0.25}>0.25×</option><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option></select>
              {version && version.tests.length > 1 && (
                <select value={testId ?? ''} onChange={(e) => setTestId(e.target.value)} aria-label="Test to replay">{version.tests.map((t) => <option key={t.testId} value={t.testId}>{t.testId} {t.passed ? '✓' : '✗'}</option>)}</select>
              )}
            </div>}
            <div className="workbench-control-group" role="group" aria-label="View controls">
              <label>Explode <input type="range" min={0} max={1} step={0.01} value={explode} onChange={(e) => setExplode(Number(e.target.value))} className="w-16" aria-label="Explode view" /></label>
              <button className="btn-ghost" aria-pressed={activeBlueprint} onClick={() => { setIntroBlueprint(false); setBlueprint(!activeBlueprint); }}>Blueprint</button>
              {!showLive && !!strokeTargets?.length && <button type="button" className="btn-ghost" aria-pressed={showStrokeGuides && !explode} disabled={explode > 0} onClick={() => setShowStrokeGuides((show) => !show)}>Stroke guides</button>}
              {!showLive && motionPath && <button type="button" className="btn-ghost" aria-pressed={showMotionPath && !explode} disabled={explode > 0} onClick={() => setShowMotionPath((show) => !show)}>{receiverPath ? 'Delivery path' : 'Pen path'}</button>}
              {!showLive && (comparing ? <span className="workbench-view-hint">Camera fits the recorded motion</span> : <label><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow</label>)}
            </div>
          </div>
          {!showLive && test && <ReceiverReplayEvidence targets={receiverTarget} test={test} time={time.t} />}
          {!showLive && test && <FollowerTimingEvidence time={time.t} test={test} definition={testDefinition} isSemaphore={version?.id === 'ver_cam_semaphore_1' && test.testId === 'cam_semaphore_stroke'} />}
          {!showLive && version && test && <TriplexTimingEvidence version={version} time={time.t} test={test} />}
          {!showLive && version && test && <OrbitReplayEvidence definition={testDefinition} inventionId={version.inventionId} time={time.t} test={test} />}
          {!showLive && version && test && <TrayTiltEvidence version={version} time={time.t} test={test} />}
          {!showLive && version && test && <LotusReplayEvidence version={version} time={time.t} test={test} />}
          {!showLive && test && <IndexedMotionEvidence versionId={version?.id} time={time.t} test={test} definition={testDefinition} />}
          {(!stageMode || !story.length) && <IterationRibbon versions={detail?.versions ?? []} currentId={versionId} onPick={(next) => { if (running) setViewMode('tested'); setVersionId(next); }} />}
          {storyControls}
          {running && <SimulationStatus events={events} running replay={replayStatus} />}
          {!running && replayStatus && <SimulationStatus events={events} running={false} replay={replayStatus} />}
          </>}
          {finalVersion && (
            <section id="prototype-explanation" className="workbench-explanation" aria-label="How the final prototype works">
              <div className="workbench-explanation-heading">
                <span className="workbench-label">Passed design · v{finalVersion.iteration}</span>
                <h3>How it works</h3>
              </div>
              <p>{finalSummary || `This design uses ${finalVersion.assembly.instances.length} components and ${finalVersion.assembly.controller.drives.length} programmed drives.`}</p>
              {!!finalVersion.spec.plan?.motions.length && (
                <ul aria-label="Planned motions">{finalVersion.spec.plan.motions.slice(0, 4).map((motion, i) => <li key={i}>{motion}</li>)}</ul>
              )}
              {renderExplanation(finalVersion)}
            </section>
          )}
        </section>

        <aside className="workbench-panel workbench-agent" data-active={mobilePane === 'agent'} aria-label="Engineering agent">
          <div className="workbench-agent-nav" role="group" aria-label="Agent panels">
            {(['activity', 'spec', 'tests'] as const).map((t) => <button key={t} onClick={() => setTab(t)} aria-pressed={tab === t}>{t}</button>)}
          </div>
          <div className="workbench-agent-content">
            {tab === 'activity' && <ActivityPanel events={events} running={running} versions={detail?.versions ?? []} currentVersionId={versionId} onPickVersion={setVersionId} status={jobStatus} />}
            {tab === 'spec' && <div className="overflow-auto p-3">{version ? <SpecPanel spec={version.spec} /> : <p className="text-xs text-dim">No spec yet.</p>}</div>}
            {tab === 'tests' && (
              <div className="overflow-auto p-3 space-y-3">
                {vmeta && <p className="text-xs text-muted">Version v{vmeta.iteration} · {new Date(vmeta.createdAt).toLocaleTimeString()} {version?.tests[0]?.engine ? ` · engine: ${version.tests[0].engine}` : ''}</p>}
                {version && !running && !finalVersion && <div className="rounded-md border border-line bg-surface2 p-2 text-xs">{renderExplanation(version)}</div>}
                {detail && detail.versions.length > 1 && (
                  <div className="rounded-md border border-line p-2 text-xs">
                    <div className="panel-title mb-1">Iterations</div>
                    <table className="w-full mono"><tbody>
                      {detail.versions.map((v) => { const t = v.tests[v.tests.length - 1]; const key = t ? (t.metrics.distance_m !== undefined ? ['distance', fmt.m2(t.metrics.distance_m)] : t.metrics.landingDistance_m !== undefined ? ['landing', fmt.m2(t.metrics.landingDistance_m)] : t.metrics.payloadDrop_m !== undefined ? ['payload drop', fmt.m2(t.metrics.payloadDrop_m)] : Object.entries(t.metrics).find(([k]) => k.endsWith('amplitude_rad')) ? ['amplitude', `${Object.entries(t.metrics).find(([k]) => k.endsWith('amplitude_rad'))![1].toFixed(2)} rad`] : ['tilt', fmt.deg(t.metrics.maxTilt_deg ?? 0)]) : ['', '']; return (
                        <tr key={v.id} className={`${v.id === versionId ? 'bg-accent/15' : ''} cursor-pointer hover:bg-surface2`} onClick={() => setVersionId(v.id)}>
                          <td className="px-1 py-0.5 text-muted">v{v.iteration}</td><td className="px-1 py-0.5">{t?.testId ?? '—'}</td><td className="px-1 py-0.5 text-muted">{key[0]}</td><td className="px-1 py-0.5">{key[1]}</td><td className={`px-1 py-0.5 ${!t ? 'text-muted' : v.status === 'passed' ? 'text-pass' : 'text-fail'}`}>{!t ? 'Not tested' : v.status === 'passed' ? '✓' : '✗'}</td>
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
                    <div className="rounded-md border border-warn/30 bg-warn/15 p-2 text-xs text-ink">
                      <div className="panel-title mb-1 text-warn">Changed since v{prevVersion.iteration}</div>
                      {swapped.length > 0 && <div><span className="text-muted">Part swaps:</span> {swapped.slice(0, 6).join('; ')}{swapped.length > 6 ? ` (+${swapped.length - 6})` : ''}</div>}
                      {added.length > 0 && <div><span className="text-muted">Added:</span> {added.slice(0, 8).map((i) => i.label).join(', ')}{added.length > 8 ? ` (+${added.length - 8})` : ''}</div>}
                      {removed.length > 0 && <div><span className="text-muted">Removed:</span> {removed.slice(0, 8).map((i) => i.label).join(', ')}{removed.length > 8 ? ` (+${removed.length - 8})` : ''}</div>}
                      {moved > 0 && <div><span className="text-muted">Repositioned:</span> {moved} component{moved === 1 ? '' : 's'}</div>}
                      {driveChanges.length > 0 && <div><span className="text-muted">Drives:</span> {driveChanges.slice(0, 6).join('; ')}{driveChanges.length > 6 ? ` (+${driveChanges.length - 6})` : ''}</div>}
                    </div>
                  );
                })()}
                {version?.decisions.map((d, i) => (
                  <div key={i} className="rounded-md border border-accent/30 bg-accent/15 p-2 text-xs">
                    <div className="font-medium text-ink">{d.source === 'model' ? `Model decision${d.modelId ? ` · ${d.modelId}` : ''}` : 'Planner decision'}</div>
                    <p className="text-ink">{d.summary}</p>
                    {d.basedOn && <p className="mt-1 text-muted">Based on: {d.basedOn}</p>}
                    {Object.keys(d.changes).length > 0 && <ul className="mt-1 mono text-muted">{Object.entries(d.changes).map(([k, c]) => <li key={k}>{k}: {c.from !== undefined ? `${c.from} → ` : ''}{c.to}</li>)}</ul>}
                  </div>
                ))}
                {version?.tests.map((t) => (
                  <div key={t.testId} className={`rounded-md border p-2 text-xs ${t.passed ? 'border-pass/30' : 'border-warn/30'}`}>
                    <div className="mb-1 flex items-center justify-between"><span className="font-medium">{t.testId}</span><span className={t.passed ? 'text-pass' : 'text-warn'}>{t.passed ? 'passed' : 'did not pass'}</span></div>
                    <Metrics metrics={t.metrics} kind={t.kind} />
                    {t.failureReasons.length > 0 && <ul className="mt-1 list-disc pl-4 text-warn">{t.failureReasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
                    {t.notes?.length > 0 && <ul className="mt-1 list-disc pl-4 text-muted">{t.notes.map((r, i) => <li key={i}>{r}</li>)}</ul>}
                  </div>
                ))}
                {version && <p className="text-[11px] text-dim">Metrics are computed by the physics engine from this exact assembly and are reproducible. Rigid-body simulation is not engineering certification.</p>}
              </div>
            )}
          </div>
        </aside>
      </div>

      {stoppedSummary && <section id="build-outcome-summary" className="workbench-build-summary" aria-labelledby="build-outcome-heading">
        <h2 id="build-outcome-heading">Build summary</h2>
        <p>{stoppedSummary}</p>
      </section>}
      {inv && <div className="workbench-mobile-details">
        <div className="workbench-detail-actions">{workbenchActions}</div>
        <details>
          <summary>Build brief</summary>
          <p className="workbench-prompt">{prompt}</p>
        </details>
      </div>}
      {changeMode && inv && version && (
        <div className="workbench-dialog fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal aria-labelledby="revision-title" onKeyDown={(e) => { if (e.key === 'Escape' && !busy) setChangeMode(null); }}>
          <form className="card w-full max-w-md p-5" onSubmit={(e) => { e.preventDefault(); if (request.trim().length >= 2) void act(changeMode, request.trim()); }}>
            <h2 id="revision-title" className="text-lg font-semibold">Request a change</h2>
            <p className="mt-1 text-sm text-muted">
              {changeMode === 'remix' ? `Muse will use version ${version.iteration} to build a private remix and keep credit to ${inv.ownerLabel}.` : `Muse will use version ${version.iteration} as the baseline and save a new version of your invention.`}
            </p>
            <label className="mt-4 block text-sm">What should change?<input name="change" autoFocus value={request} onChange={(e) => setRequest(e.target.value)} placeholder={suggestionsFor(version)[0]} maxLength={400} className="mt-1 w-full rounded-md border border-line px-3 py-2" /></label>
            <div className="mt-2 flex flex-wrap gap-1">{suggestionsFor(version).map((s) => <button type="button" key={s} className="chip !py-1 !text-xs" onClick={() => setRequest(s)}>{s}</button>)}</div>
            {error && <p role="alert" className="mt-2 text-sm text-fail">{error}</p>}
            <div className="mt-4 flex justify-end gap-2"><button type="button" className="btn-ghost" disabled={busy} onClick={() => setChangeMode(null)}>Cancel</button><button type="submit" className="btn-primary" disabled={busy || request.trim().length < 2}>{busy ? 'Starting…' : changeMode === 'remix' ? 'Build my remix' : 'Build revision'}</button></div>
          </form>
        </div>
      )}
      {publishOpen && inv && (
        <div className="workbench-dialog fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal aria-labelledby="publish-title">
          <form className="card w-full max-w-md p-5" onSubmit={async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); setBusy(true); try { await api.publish(id, { title: String(f.get('title') || inv.title), description: String(f.get('description') || inv.description) }); setPublishOpen(false); await refresh(); } catch (err) { setError((err as Error).message); } finally { setBusy(false); } }}>
            <h2 id="publish-title" className="text-lg font-semibold">Publish to the gallery</h2>
            <p className="mt-1 text-sm text-muted">Anyone will be able to open the interactive 3D assembly, see its measured test results and remix it. Credit stays with you.</p>
            <label className="mt-4 block text-sm">Title<input name="title" defaultValue={inv.title} maxLength={80} className="mt-1 w-full rounded-md border border-line px-3 py-2" /></label>
            <label className="mt-3 block text-sm">What it does<textarea name="description" defaultValue={inv.description.slice(0, 400)} maxLength={400} rows={3} className="mt-1 w-full rounded-md border border-line px-3 py-2" /></label>
            <p className="mt-3 text-xs text-muted">Status shown on the card: {currentUntested ? 'not tested' : inv.status === 'passed' ? 'tests passed' : 'did not pass'} · model: {version?.modelId}</p>
            <div className="mt-4 flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={() => setPublishOpen(false)}>Cancel</button><button type="submit" className="btn-primary" disabled={busy}>Publish</button></div>
          </form>
        </div>
      )}
    </div>
  );
}
