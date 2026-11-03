import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Grid, Html, Line } from '@react-three/drei';
import { Component, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import * as THREE from 'three';
import type { Assembly, Axis, Instance, Shape, TestResult, TestSpec, Transform } from '@protolab/schema';
import { ensureCCW, shapeHalfExtents as halfExtents } from './shapeMath.ts';
import IsoPreview from './IsoPreview.tsx';
import { diagnosticColors, type DiagnosticTone } from './diagnosticColors.ts';

export interface ViewerProps {
  assembly: Assembly;
  visibleInstanceIds?: Set<string>;
  enteringInstanceIds?: string[];
  test?: TestResult | null;
  playing: boolean;
  speed?: number;
  explode: number;          // 0..1
  blueprint: boolean;
  follow?: boolean;
  cameraLock?: string;
  cameraBounds?: THREE.Box3;
  playbackTime?: number;
  selectedId: string | null;
  changedIds?: Set<string>;
  diagnosticHighlights?: ReadonlyMap<string, DiagnosticTone>;
  onSelect?: (id: string | null) => void;
  timeRef?: MutableRefObject<number>;  // shared current time (s)
  onTime?: (t: number, duration: number) => void;
  seekTo?: number | null;
  autoRotate?: boolean;
  mini?: boolean;
  zoom?: number;
  strokeTargets?: NonNullable<Extract<TestSpec, { kind: 'motion' }>['measure']['linearTravel']>;
  pathInstanceId?: string;
  captureRef?: MutableRefObject<(() => string | null) | null>;
}

const diagnosticOutlines = {
  failure: new THREE.MeshBasicMaterial({ color: diagnosticColors.failure.outline, side: THREE.BackSide }),
  change: new THREE.MeshBasicMaterial({ color: diagnosticColors.change.outline, side: THREE.BackSide }),
};
const ignoreRaycast = () => {};
const strokeColors = ['#6526d6', '#0e766e', '#a13453', '#1d58b8'];

const materialCache = new Map<string, THREE.MeshStandardMaterial>();
function material(color: string, role: string, blueprint: boolean, selected: boolean, changed: boolean, diagnostic?: DiagnosticTone) {
  const key = `${color}|${role}|${blueprint}|${selected}|${changed}|${diagnostic ?? ''}`;
  let m = materialCache.get(key);
  if (!m) {
    if (diagnostic) {
      const { surface } = diagnosticColors[diagnostic];
      m = new THREE.MeshStandardMaterial({ color: surface, emissive: surface, emissiveIntensity: selected ? 0.65 : 0.32, roughness: 0.5, wireframe: blueprint });
    } else if (blueprint) m = new THREE.MeshStandardMaterial({ color: selected ? '#f28c1d' : changed ? '#f28c1d' : '#4a90e2', wireframe: true, transparent: true, opacity: selected ? 1 : 0.55 });
    else m = new THREE.MeshStandardMaterial({ color: changed ? '#f28c1d' : color, metalness: role === 'motor' ? 0.2 : role === 'contact' ? 0 : 0.55, roughness: role === 'contact' ? 0.9 : role === 'shell' ? 0.6 : 0.35, emissive: selected ? new THREE.Color('#1d6ff2') : new THREE.Color('#000'), emissiveIntensity: selected ? 0.5 : 0 });
    materialCache.set(key, m);
  }
  return m;
}

function quat(q: Transform['rotation']) { return new THREE.Quaternion(q[0], q[1], q[2], q[3]); }
function vec(p: Transform['position']) { return new THREE.Vector3(p[0], p[1], p[2]); }

export function replayBounds(assembly: Assembly, test?: TestResult | null): THREE.Box3 {
  const bounds = new THREE.Box3();
  const partBounds = new Map<string, THREE.Box3>();
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  const box = new THREE.Box3();
  for (const part of assembly.parts) {
    const local = new THREE.Box3();
    for (const { shape, offset } of part.geometry) {
      // Include room for the diagnostic outline and poses between trace samples.
      const half = vec(halfExtents(shape)).multiplyScalar(1.12);
      matrix.compose(position.fromArray(offset.position), rotation.fromArray(offset.rotation), scale);
      local.union(box.set(half.clone().negate(), half).applyMatrix4(matrix));
    }
    if (!local.isEmpty()) partBounds.set(part.id, local);
  }
  const frames = test?.trace.frames ?? [];
  const fallback = new THREE.Box3(new THREE.Vector3(-.02, -.02, -.02), new THREE.Vector3(.02, .02, .02));
  for (const instance of assembly.instances) {
    const local = partBounds.get(instance.partId) ?? fallback;
    const addPose = (pose: Transform) => {
      matrix.compose(position.fromArray(pose.position), rotation.fromArray(pose.rotation), scale);
      bounds.union(box.copy(local).applyMatrix4(matrix));
    };
    addPose(instance.transform);
    for (const frame of frames) {
      const pose = frame.bodies[instance.id];
      if (pose) addPose(pose);
    }
  }
  return bounds;
}

/** Rotate a +Y-aligned geometry (cylinder, capsule, lathe) so its long axis follows `axis`. */
function alignY(g: THREE.BufferGeometry, axis: Axis) { if (axis === 'x') g.rotateZ(-Math.PI / 2); else if (axis === 'z') g.rotateX(Math.PI / 2); return g; }
// Extrusions are built in the (u, v, w) frame (profile in XY, depth along Z); these proper rotations match extrudePoint():
// axis x → (w, u, v); axis y → (u, −w, v) (w is symmetric so the sign is harmless).
const EXTRUDE_X = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0));
const EXTRUDE_Y = new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -1, 0));

function shapeGeometry(s: Shape): THREE.BufferGeometry {
  switch (s.kind) {
    case 'box': return new THREE.BoxGeometry(s.size[0], s.size[1], s.size[2]);
    case 'cylinder': return alignY(new THREE.CylinderGeometry(s.radius, s.radius, s.height, 24), s.axis);
    case 'sphere': return new THREE.SphereGeometry(s.radius, 20, 16);
    case 'capsule': return alignY(new THREE.CapsuleGeometry(s.radius, s.height, 4, 16), s.axis);
    case 'ellipsoid': return new THREE.SphereGeometry(1, 24, 16).scale(s.radii[0], s.radii[1], s.radii[2]);
    case 'extrude': {
      const g = new THREE.ExtrudeGeometry(new THREE.Shape(s.profile.map(([u, v]) => new THREE.Vector2(u, v))), { depth: s.depth, bevelEnabled: false });
      g.translate(0, 0, -s.depth / 2); // centre on the piece origin
      if (s.axis === 'x') g.applyMatrix4(EXTRUDE_X); else if (s.axis === 'y') g.applyMatrix4(EXTRUDE_Y);
      return g;
    }
    case 'revolve': {
      const pts = ensureCCW(s.profile).map(([r, h]) => new THREE.Vector2(r, h)); pts.push(pts[0]); // close the ring
      return alignY(new THREE.LatheGeometry(pts, s.segments), s.axis);
    }
  }
}

function PieceMesh({ piece, mat, outline, onClick }: { piece: Assembly['parts'][number]['geometry'][number]; mat: THREE.Material; outline?: THREE.Material; onClick?: (e: { stopPropagation: () => void }) => void }) {
  const geometry = useMemo(() => shapeGeometry(piece.shape), [piece.shape]);
  return (
    <mesh geometry={geometry} position={vec(piece.offset.position)} quaternion={quat(piece.offset.rotation)} material={mat} onClick={onClick} castShadow receiveShadow>
      {outline && <mesh geometry={geometry} material={outline} scale={1.1} raycast={ignoreRaycast} />}
    </mesh>
  );
}

interface Frame { t: number; bodies: Record<string, Transform> }
function sampleFrame(frames: Frame[], t: number): { a: Frame; b: Frame; k: number } {
  if (frames.length === 0) return { a: { t: 0, bodies: {} }, b: { t: 0, bodies: {} }, k: 0 };
  const dt = frames.length > 1 ? frames[1].t - frames[0].t : 1;
  const i = Math.max(0, Math.min(frames.length - 1, Math.floor(t / dt)));
  const a = frames[i], b = frames[Math.min(frames.length - 1, i + 1)];
  const k = b.t > a.t ? Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t))) : 0;
  return { a, b, k };
}

function Scene(props: ViewerProps) {
  const { assembly, visibleInstanceIds, enteringInstanceIds, test, playing, speed = 1, explode, blueprint, selectedId, changedIds, diagnosticHighlights, onSelect, follow = true, cameraLock, cameraBounds, playbackTime, timeRef, onTime, seekTo, autoRotate, mini } = props;
  const groups = useRef<Record<string, THREE.Group>>({});
  const strokeMarkers = useRef<Record<string, THREE.Mesh>>({});
  const pathMarker = useRef<THREE.Mesh>(null);
  const enteredAt = useRef(new Map<string, number>());
  const entering = useMemo(() => new Set(enteringInstanceIds), [enteringInstanceIds]);
  const tRef = useRef(0);
  const frames = test?.trace.frames ?? [];
  const duration = frames.length ? frames[frames.length - 1].t : 0;
  const controls = useRef<{ target: THREE.Vector3; update: () => void } | null>(null);
  const { gl } = useThree();
  useEffect(() => { if (props.captureRef) props.captureRef.current = () => { try { return gl.domElement.toDataURL('image/png'); } catch { return null; } }; }, [gl, props.captureRef]);

  const partById = useMemo(() => new Map(assembly.parts.map((p) => [p.id, p])), [assembly]);
  const followsBody = follow && assembly.instances.some((instance) => instance.id === 'body');
  const { center, halfSize, radius } = useMemo(() => {
    const bounds = cameraBounds ?? replayBounds(assembly, followsBody ? null : test);
    const halfSize = bounds.isEmpty() ? new THREE.Vector3(0.1, 0.1, 0.1) : bounds.getSize(new THREE.Vector3()).multiplyScalar(0.5);
    return {
      center: bounds.isEmpty() ? new THREE.Vector3(0, 0.1, 0) : bounds.getCenter(new THREE.Vector3()),
      halfSize,
      radius: Math.max(0.08, halfSize.length()),
    };
  }, [assembly, cameraBounds, followsBody, test]);
  const strokes = useMemo(() => {
    if (!test || !props.strokeTargets?.length || explode) return [];
    const offset = THREE.MathUtils.clamp(radius * 0.075, 0.012, 0.034);
    return props.strokeTargets.flatMap(({ instance, axis }, index) => {
      const coordinate = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
      let first: Transform['position'] | undefined;
      let min = Infinity, max = -Infinity;
      for (const frame of test.trace.frames) {
        const point = frame.bodies[instance]?.position;
        if (!point) continue;
        first ??= point;
        min = Math.min(min, point[coordinate]);
        max = Math.max(max, point[coordinate]);
      }
      if (!first) return [];
      const from = vec(first).setComponent(coordinate, min);
      from.setComponent(coordinate === 0 ? 2 : 0, from.getComponent(coordinate === 0 ? 2 : 0) + offset);
      const to = from.clone().setComponent(coordinate, max);
      const label = to.clone();
      label.y += offset * 0.45;
      return [{ key: `${instance}:${axis}:${index}`, instance, coordinate, from, to, label, number: index + 1, color: strokeColors[index % strokeColors.length] }];
    });
  }, [test, props.strokeTargets, radius, explode]);
  const path = useMemo(() => {
    if (!test || !props.pathInstanceId || explode) return [];
    const id = props.pathInstanceId;
    return test.trace.frames.flatMap((frame) => frame.bodies[id] ? [vec(frame.bodies[id].position)] : []);
  }, [test, props.pathInstanceId, explode]);
  const { camera, size } = useThree();
  const aspect = size.height > 0 ? size.width / size.height : 1;
  useEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return;
    camera.zoom = props.zoom ?? 1;
    camera.updateProjectionMatrix();
  }, [camera, props.zoom]);
  const framed = useRef<string>('');
  useEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera) || aspect <= 0) return;
    const key = `${cameraLock ?? assembly.instances.length}:${[...center.toArray(), ...halfSize.toArray(), aspect].map((value) => value.toFixed(3)).join(':')}`;
    if (framed.current === key) return;
    framed.current = key;
    // Fit all eight corners against the camera's horizontal and vertical frustum planes.
    const back = new THREE.Vector3(0.72, 0.5, 0.78).normalize();
    const right = new THREE.Vector3().crossVectors(camera.up, back).normalize();
    const up = new THREE.Vector3().crossVectors(back, right);
    const verticalSlope = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 0.88;
    const horizontalSlope = verticalSlope * aspect;
    const corner = new THREE.Vector3();
    let dist = 0.2;
    for (const x of [-halfSize.x, halfSize.x]) {
      for (const y of [-halfSize.y, halfSize.y]) {
        for (const z of [-halfSize.z, halfSize.z]) {
          corner.set(x, y, z);
          const depth = corner.dot(back);
          dist = Math.max(dist, depth + Math.max(Math.abs(corner.dot(right)) / horizontalSlope, Math.abs(corner.dot(up)) / verticalSlope));
        }
      }
    }
    camera.position.copy(center).addScaledVector(back, dist);
    camera.near = Math.max(0.005, dist / 100);
    camera.far = Math.max(20, dist * 20);
    camera.updateProjectionMatrix();
    camera.lookAt(center);
    if (controls.current) { controls.current.target.copy(center); controls.current.update(); }
  }, [assembly.instances.length, center, halfSize, camera, cameraLock, aspect]);
  const explodeDir = useMemo(() => {
    const m = new Map<string, THREE.Vector3>();
    for (const i of assembly.instances) {
      const d = vec(i.transform.position).sub(center);
      d.y *= 0.5; if (d.lengthSq() < 1e-8) d.set(0, 1, 0);
      const groupBias = i.group === 'body' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, -0.4, 0);
      m.set(i.id, d.normalize().multiplyScalar(0.9).add(groupBias.multiplyScalar(0.6)));
    }
    return m;
  }, [assembly, center]);

  useEffect(() => { if (seekTo != null) tRef.current = seekTo; }, [seekTo]);
  useEffect(() => { tRef.current = 0; }, [test?.testId]);

  useFrame(({ clock }, delta) => {
    if (playbackTime !== undefined) tRef.current = Math.min(playbackTime, duration);
    else if (playing && duration > 0) { tRef.current = (tRef.current + delta * speed) % duration; }
    if (timeRef) timeRef.current = tRef.current;
    onTime?.(tRef.current, duration);
    const { a, b, k } = sampleFrame(frames, tRef.current);
    const bodyPos = new THREE.Vector3();
    for (const inst of assembly.instances) {
      const g = groups.current[inst.id];
      if (!g) continue;
      const ta = a.bodies[inst.id] ?? inst.transform, tb = b.bodies[inst.id] ?? ta;
      const p = vec(ta.position).lerp(vec(tb.position), k);
      const q = quat(ta.rotation).slerp(quat(tb.rotation), k);
      if (entering.has(inst.id) && (!visibleInstanceIds || visibleInstanceIds.has(inst.id))) {
        const now = clock.elapsedTime;
        const start = enteredAt.current.get(inst.id) ?? now;
        enteredAt.current.set(inst.id, start);
        const remaining = Math.max(0, 1 - (now - start) / 0.26);
        p.y += remaining * remaining * Math.min(0.12, radius * 0.3);
      }
      if (explode > 0) p.add(explodeDir.get(inst.id)!.clone().multiplyScalar(explode * 0.12));
      g.position.copy(p); g.quaternion.copy(q);
      if (inst.id === 'body') bodyPos.copy(p);
    }
    for (const stroke of strokes) {
      const marker = strokeMarkers.current[stroke.key];
      const tracked = groups.current[stroke.instance];
      if (!marker || !tracked) continue;
      marker.position.copy(stroke.from).setComponent(stroke.coordinate, tracked.position.getComponent(stroke.coordinate));
    }
    const tracedPart = props.pathInstanceId && groups.current[props.pathInstanceId];
    if (pathMarker.current && tracedPart) pathMarker.current.position.copy(tracedPart.position);
    if (follow && controls.current && frames.length && assembly.instances.some((i) => i.id === 'body') && bodyPos.lengthSq() > 0) {
      controls.current.target.lerp(new THREE.Vector3(bodyPos.x, Math.max(bodyPos.y * 0.6, center.y * 0.5), bodyPos.z), 0.15);
      controls.current.update();
    }
  });

  const chassis = assembly.parts.find((p) => p.kind === 'body_frame');
  const body = assembly.instances.find((i) => i.id === 'body');
  const upper = assembly.parts.find((p) => p.kind === 'leg_segment');

  return (
    <>
      <color attach="background" args={[blueprint || mini ? '#15112c' : '#eee9fa']} />
      <hemisphereLight args={['#ffffff', '#b9c4d1', 0.9]} />
      <directionalLight position={[0.6, 1.2, 0.8]} intensity={1.6} castShadow shadow-mapSize={[1024, 1024]} shadow-camera-near={0.1} shadow-camera-far={5} shadow-camera-left={-1} shadow-camera-right={1} shadow-camera-top={1} shadow-camera-bottom={-1} />
      <directionalLight position={[-0.8, 0.5, -0.6]} intensity={0.5} />
      <Grid position={[0, -0.0005, 0]} args={[4, 4]} cellSize={radius > 0.35 ? 0.1 : 0.05} cellThickness={0.6} cellColor={blueprint ? '#1e3a5f' : mini ? '#352953' : '#cfc3e7'} sectionSize={radius > 0.35 ? 0.5 : 0.25} sectionThickness={1} sectionColor={blueprint ? '#2d5c99' : mini ? '#675384' : '#a293c6'} fadeDistance={2.5} infiniteGrid />
      {!blueprint && <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, 0]} receiveShadow><planeGeometry args={[6, 6]} /><shadowMaterial opacity={0.25} /></mesh>}
      <group onPointerMissed={() => onSelect?.(null)}>
        {assembly.instances.map((inst: Instance) => {
          const part = partById.get(inst.partId);
          if (!part) return null;
          const diagnostic = diagnosticHighlights?.get(inst.id);
          return (
            <group key={inst.id} ref={(g) => { if (g) groups.current[inst.id] = g; }} visible={!visibleInstanceIds || visibleInstanceIds.has(inst.id)} position={vec(inst.transform.position)} quaternion={quat(inst.transform.rotation)}>
              {part.geometry.map((piece, i) => (
                <PieceMesh key={i} piece={piece} mat={material(piece.color ?? '#aaa', piece.role, blueprint, selectedId === inst.id, !!changedIds?.has(inst.id), diagnostic)} outline={diagnostic && !blueprint ? diagnosticOutlines[diagnostic] : undefined} onClick={(e) => { e.stopPropagation(); onSelect?.(inst.id); }} />
              ))}
            </group>
          );
        })}
      </group>
      {strokes.map((stroke) => (
        <group key={stroke.key}>
          <Line points={[stroke.from, stroke.to]} color={stroke.color} lineWidth={3} depthTest={false} raycast={ignoreRaycast} />
          {[stroke.from, stroke.to].map((point, i) => (
            <mesh key={i} position={point} renderOrder={8} raycast={ignoreRaycast}>
              <sphereGeometry args={[radius * 0.008, 8, 8]} />
              <meshBasicMaterial color={stroke.color} depthTest={false} />
            </mesh>
          ))}
          <mesh ref={(node) => { if (node) strokeMarkers.current[stroke.key] = node; else delete strokeMarkers.current[stroke.key]; }} renderOrder={9} raycast={ignoreRaycast}>
            <sphereGeometry args={[radius * 0.016, 12, 12]} />
            <meshBasicMaterial color={stroke.color} depthTest={false} />
          </mesh>
          <Html position={stroke.label} center style={{ pointerEvents: 'none' }}>
            <span className="grid h-4 w-4 place-items-center rounded-full text-[10px] font-bold text-white shadow-sm" style={{ background: stroke.color }} aria-hidden="true">
              {stroke.number}
            </span>
          </Html>
        </group>
      ))}
      {path.length >= 2 && (
        <group>
          <Line points={path} color={blueprint ? '#facc15' : '#b45309'} lineWidth={3} depthTest={false} raycast={ignoreRaycast} />
          <mesh ref={pathMarker} renderOrder={9} raycast={ignoreRaycast}>
            <sphereGeometry args={[radius * 0.014, 12, 12]} />
            <meshBasicMaterial color="#f59e0b" depthTest={false} />
          </mesh>
        </group>
      )}
      {blueprint && chassis && body && !mini && (
        <group>
          <Dim from={[body.transform.position[0] - chassis.params.length / 2, body.transform.position[1] + chassis.params.height / 2 + 0.03, body.transform.position[2] + chassis.params.width / 2 + 0.02]} to={[body.transform.position[0] + chassis.params.length / 2, body.transform.position[1] + chassis.params.height / 2 + 0.03, body.transform.position[2] + chassis.params.width / 2 + 0.02]} label={`${(chassis.params.length * 1000).toFixed(0)} mm`} />
          <Dim from={[body.transform.position[0] + chassis.params.length / 2 + 0.03, body.transform.position[1] + chassis.params.height / 2 + 0.03, body.transform.position[2] - chassis.params.width / 2]} to={[body.transform.position[0] + chassis.params.length / 2 + 0.03, body.transform.position[1] + chassis.params.height / 2 + 0.03, body.transform.position[2] + chassis.params.width / 2]} label={`${(chassis.params.width * 1000).toFixed(0)} mm`} />
          <Dim from={[body.transform.position[0] - chassis.params.length / 2 - 0.03, 0, body.transform.position[2] + chassis.params.width / 2 + 0.02]} to={[body.transform.position[0] - chassis.params.length / 2 - 0.03, body.transform.position[1] + chassis.params.height / 2, body.transform.position[2] + chassis.params.width / 2 + 0.02]} label={`${((body.transform.position[1] + chassis.params.height / 2) * 1000).toFixed(0)} mm`} />
          {upper && <Html position={[body.transform.position[0], -0.02, body.transform.position[2] + chassis.params.width / 2 + 0.08]} center className="pointer-events-none whitespace-nowrap rounded bg-slate-900/80 px-1.5 py-0.5 text-[10px] text-sky-300">leg bars {(upper.params.length * 1000).toFixed(0)} mm</Html>}
        </group>
      )}
      <OrbitControls ref={controls as never} makeDefault enabled={!cameraBounds} enableDamping dampingFactor={0.12} minDistance={radius * 0.4} maxDistance={radius * Math.max(10, 4 / (aspect || 1))} autoRotate={autoRotate} autoRotateSpeed={1.2} enablePan={!mini} enableZoom={false} />
    </>
  );
}

function Dim({ from, to, label }: { from: [number, number, number]; to: [number, number, number]; label: string }) {
  const mid: [number, number, number] = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2];
  return (
    <group>
      <Line points={[from, to]} color="#60a5fa" lineWidth={1} />
      <Html position={mid} center className="pointer-events-none whitespace-nowrap rounded bg-slate-900/80 px-1.5 py-0.5 text-[10px] text-sky-300 mono">{label}</Html>
    </group>
  );
}

class ViewerBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export default function Viewer(props: ViewerProps) {
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(1);
  useEffect(() => setZoom(1), [props.assembly, props.test?.testId]);
  useEffect(() => {
    setReady(true);
    // Nudge the fiber resize observer: some embedded/emulated viewports miss the first measurement.
    const timers = [120, 600].map((ms) => setTimeout(() => window.dispatchEvent(new Event('resize')), ms));
    return () => timers.forEach(clearTimeout);
  }, []);
  if (!ready) return <div className={props.mini ? "h-full w-full" : "h-full w-full bg-slate-100"} />;
  const measuredStrokes = props.explode ? [] : props.strokeTargets?.flatMap(({ instance, axis, minTravel_m }, index) => {
    const travel = props.test?.metrics[`${instance}.travel_${axis}_m`];
    if (travel === undefined) return [];
    const part = instance.replace(/_/g, ' ');
    const label = part.charAt(0).toUpperCase() + part.slice(1);
    const axisLabel = props.strokeTargets?.some((other) => other.instance === instance && other.axis !== axis) ? ` · ${axis.toUpperCase()}` : '';
    return [{ number: index + 1, part: label + axisLabel, travel, target: minTravel_m, color: strokeColors[index % strokeColors.length] }];
  }) ?? [];
  const previewProps = { assembly: props.assembly, trace: props.test?.trace, playing: props.playing, speed: props.speed, seekTo: props.playbackTime ?? props.seekTo, onTime: props.onTime, diagnosticHighlights: props.diagnosticHighlights };
  const fallback = props.mini ? (
    <IsoPreview {...previewProps} className="h-full w-full" />
  ) : (
    <div className="workbench-stage-fallback">
      <IsoPreview {...previewProps} />
      <p role="status">Showing an isometric preview. Interactive 3D needs WebGL.</p>
    </div>
  );
  return (
    <ViewerBoundary fallback={fallback}>
      <Canvas className="prototype-canvas" shadows dpr={[1, 1.5]} camera={{ position: [0.42, 0.28, 0.46], fov: 35, near: 0.01, far: 20 }} gl={{ preserveDrawingBuffer: true, antialias: true }} frameloop={props.mini && !props.playing && !props.autoRotate ? 'demand' : 'always'}>
        <Scene {...props} zoom={zoom} />
      </Canvas>
      {measuredStrokes.length > 0 && (
        <ul className="pointer-events-none absolute bottom-3 left-3 right-3 flex flex-wrap gap-1.5" aria-label="Recorded stroke distances">
          {measuredStrokes.map(({ number, part, travel, target, color }) => (
            <li key={number} className="flex items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-800"
              aria-label={`${part}, ${Math.round(travel * 1000)} millimeters, minimum ${Math.round(target * 1000)} millimeters`}>
              <span className="grid h-4 w-4 place-items-center rounded-full text-white" style={{ background: color }} aria-hidden="true">{number}</span>
              {part} · {Math.round(travel * 1000)} mm
            </li>
          ))}
        </ul>
      )}
      {!props.mini && !props.cameraBounds && (
        <div className="workbench-zoom" role="group" aria-label="Zoom controls">
          <button type="button" className="btn-secondary" aria-label="Zoom out" disabled={zoom <= .6} onClick={() => setZoom((value) => Math.max(.6, value / 1.25))}>−</button>
          <button type="button" className="btn-secondary" aria-label="Zoom in" disabled={zoom >= 2.5} onClick={() => setZoom((value) => Math.min(2.5, value * 1.25))}>+</button>
        </div>
      )}
    </ViewerBoundary>
  );
}
