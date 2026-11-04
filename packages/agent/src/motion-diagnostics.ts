import type { Assembly, Drive, TestResult, TestSpec, Trace, Vec3 } from '@protolab/schema';
import { invert, len, sub, transformPoint } from '@protolab/parts';
import { controlTargets, driveValue, MOTION_SETTLE_S, SIMULATION_STEP_S } from '@protolab/simulator';

const MAX_JOINTS = 8;
const MAX_SAMPLES = 12;
const MAX_BYTES = 24_000;
const finite = (value: number | undefined): number | null => value !== undefined && Number.isFinite(value) ? value : null;
const rounded = (value: number | undefined | null): number | null => value !== null && value !== undefined && Number.isFinite(value) ? +value.toFixed(5) : null;
const roundedPoint = (point: Vec3 | undefined): Vec3 | null => point?.every(Number.isFinite) ? point.map((value) => +value.toFixed(5)) as Vec3 : null;
const range = (values: Array<number | null>): [number, number] | null => {
  const valid = values.filter((value): value is number => value !== null);
  return valid.length ? [rounded(Math.min(...valid))!, rounded(Math.max(...valid))!] : null;
};

/** Select actual saved frames, never synthesize a pose at a command transition. */
function samples(frames: Trace['frames']) {
  const selected = new Map<number, string[]>();
  const add = (index: number, phase: string) => {
    if (index < 0 || index >= frames.length) return;
    if (selected.has(index)) selected.get(index)!.push(phase);
    else if (selected.size < MAX_SAMPLES) selected.set(index, [phase]);
  };
  const around = (time: number, phase: string) => {
    const after = frames.findIndex((frame) => frame.t >= time);
    if (after < 0) return;
    if (frames[after].t > time) add(after - 1, `${phase}:before`);
    add(after, `${phase}:at_or_after`);
  };
  add(0, 'start'); add(frames.length - 1, 'end');
  return { add, around, rows: () => [...selected].sort(([a], [b]) => a - b) };
}

function target(drive: Drive, time: number) {
  // Saved times are rounded to four decimals. Recover the native tick before
  // evaluating exactly the same profile, blend-in and settle behavior.
  const nativeTime = Math.round(time / SIMULATION_STEP_S) * SIMULATION_STEP_S;
  if (nativeTime <= MOTION_SETTLE_S) return 0;
  return controlTargets({ drives: [drive] }, nativeTime - MOTION_SETTLE_S)[drive.controlId].value;
}

export function motionDiagnostics(assembly: Assembly, spec: TestSpec, result: TestResult) {
  if (spec.kind !== 'motion' || !result.trace.frames.length) return undefined;
  const frames = result.trace.frames;
  // Last drive for a control wins in the simulator as well.
  const drives = new Map(assembly.controller.drives.map((drive) => [drive.controlId, drive]));
  const controlCounts = new Map<string, number>();
  for (const joint of assembly.joints) if (joint.motor && joint.type !== 'fixed') {
    const id = joint.motor.controlId; controlCounts.set(id, (controlCounts.get(id) ?? 0) + 1);
  }
  const positionJoints = assembly.joints.flatMap((joint) => {
    const motor = joint.motor;
    const drive = motor && drives.get(motor.controlId);
    if (!motor || !drive || drive.mode !== 'position' || !['revolute', 'prismatic'].includes(joint.type)) return [];
    const commands = frames.map(({ t }) => target(drive, t));
    // The native trace has one slot per control ID. Multiple joints sharing it
    // overwrite that slot, so its reading cannot be assigned to either joint.
    const ambiguousControlId = controlCounts.get(motor.controlId)! > 1;
    const actual = frames.map((frame) => ambiguousControlId ? null : finite(frame.joints[motor.controlId]));
    const errors = actual.map((value, index) => value === null ? null : commands[index] - value);
    let peak = -1;
    errors.forEach((value, index) => { if (value !== null && (peak < 0 || Math.abs(value) > Math.abs(errors[peak]!))) peak = index; });
    const first = commands.findIndex((value) => Math.abs(value) > 1e-8);
    const selection = samples(frames);
    selection.around(MOTION_SETTLE_S, 'settle_end');
    selection.add(first - 1, 'before_first_nonzero_command');
    selection.add(first, 'first_nonzero_command');
    selection.add(peak, 'peak_tracking_error');
    if (drive.profile.kind === 'ramp') {
      selection.around(MOTION_SETTLE_S + drive.profile.start_s, 'ramp_start');
      selection.around(MOTION_SETTLE_S + drive.profile.start_s + drive.profile.duration_s, 'ramp_end');
    } else if (drive.profile.kind === 'step') selection.around(MOTION_SETTLE_S + drive.profile.at_s, 'command_step');
    if (drive.profile.kind !== 'ramp' && drive.profile.kind !== 'step') {
      const blendDuration = Math.max(drive.rampIn_s, Math.abs(driveValue(drive.profile, 0, 1)) / 0.6);
      selection.around(MOTION_SETTLE_S + blendDuration, 'blend_in_end');
    }
    const unit = joint.type === 'revolute' ? 'rad' as const : 'm' as const;
    return [{
      controlId: motor.controlId, jointId: joint.id, unit, ambiguousControlId,
      drive: structuredClone(drive),
      firstNonzeroCommand_s: first < 0 ? null : frames[first].t,
      commandRange: range(commands)!, actualRange: range(actual),
      peakAbsoluteError: peak < 0 ? null : rounded(Math.abs(errors[peak]!)),
      peakErrorAt_s: peak < 0 ? null : frames[peak].t,
      motor: { stiffness: motor.stiffness, damping: motor.damping,
        rating: finite(joint.type === 'revolute' ? motor.maxTorque_Nm : motor.maxForce_N),
        peakDemand: ambiguousControlId ? null : finite(result.metrics[`${motor.controlId}.peak${joint.type === 'revolute' ? 'Torque_Nm' : 'Force_N'}`]),
        // Only an all-motor maximum saturation fraction exists in native metrics.
        saturationFraction: null,
      },
      samples: selection.rows().map(([index, phases]) => ({
        time_s: frames[index].t, phases,
        command: rounded(commands[index])!, actual: rounded(actual[index]), error: rounded(errors[index]),
      })),
    }];
  });
  const payloadMeasure = spec.measure.payload;
  const failedPayloadCriteria = [
    ['minPayloadLift_m', 'payloadLift_m', 'minimum'],
    ['maxPayloadSeparation_m', 'payloadSeparation_m', 'maximum'],
    ['maxPayloadReturnError_m', 'payloadReturnError_m', 'maximum'],
  ].flatMap(([criterion, metric, comparison]) => {
    const limit = spec.criteria[criterion as keyof typeof spec.criteria];
    const observed = finite(result.metrics[metric]);
    if (typeof limit !== 'number') return [];
    const failed = observed !== null && (comparison === 'minimum' ? observed < limit : observed > limit);
    // Native all-step metrics are rounded; an exact boundary failure can round to its target.
    const reason = criterion === 'minPayloadLift_m' ? 'Payload lifted ' : criterion === 'maxPayloadSeparation_m' ? 'Payload reached ' : 'Payload ended ';
    return failed || result.failureReasons.some((message) => message.startsWith(reason)) ? [{ criterion, metric, target: limit, observed }] : [];
  });
  let payload;
  if (payloadMeasure && failedPayloadCriteria.length) {
    const initial = frames[0].bodies[payloadMeasure.instance];
    const initialHolder = payloadMeasure.holder ? frames[0].bodies[payloadMeasure.holder] : undefined;
    const initialRelative = initial && initialHolder ? transformPoint(invert(initialHolder), initial.position) : undefined;
    const observations = frames.map((frame) => {
      const body = frame.bodies[payloadMeasure.instance];
      const holder = payloadMeasure.holder ? frame.bodies[payloadMeasure.holder] : undefined;
      const relative = body && holder ? transformPoint(invert(holder), body.position) : undefined;
      return {
        time_s: frame.t,
        payloadDeltaY_m: body && initial ? rounded(body.position[1] - initial.position[1]) : null,
        holderDeltaY_m: holder && initialHolder ? rounded(holder.position[1] - initialHolder.position[1]) : null,
        // Track the material point initially under the payload, not merely a holder's pivot/origin.
        holderReferenceDeltaY_m: holder && initialRelative && initial ? rounded(transformPoint(holder, initialRelative)[1] - initial.position[1]) : null,
        relativePosition_m: roundedPoint(relative),
        relativeDisplacement_m: relative && initialRelative ? rounded(len(sub(relative, initialRelative))) : null,
      };
    });
    const selection = samples(frames);
    selection.around(MOTION_SETTLE_S, 'settle_end');
    const extremum = (field: 'payloadDeltaY_m' | 'holderReferenceDeltaY_m', direction: -1 | 1) => {
      let best = -1;
      observations.forEach((row, index) => { const value = row[field]; if (value !== null && (best < 0 || value * direction > observations[best][field]! * direction)) best = index; });
      return best;
    };
    selection.add(extremum('payloadDeltaY_m', -1), 'lowest_payload');
    selection.add(extremum('holderReferenceDeltaY_m', -1), 'lowest_holder_reference');
    selection.add(extremum('payloadDeltaY_m', 1), 'highest_payload');
    let fastestFall = 0, fallIndex = -1;
    observations.forEach((row, index) => {
      const before = observations[index - 1];
      if (!before || row.payloadDeltaY_m === null || before.payloadDeltaY_m === null || row.time_s <= before.time_s) return;
      const speed = (row.payloadDeltaY_m - before.payloadDeltaY_m) / (row.time_s - before.time_s);
      if (speed < fastestFall) { fastestFall = speed; fallIndex = index; }
    });
    selection.add(fallIndex - 1, 'fastest_payload_fall:before'); selection.add(fallIndex, 'fastest_payload_fall:after');
    const firstCommand = Math.min(...positionJoints.flatMap((joint) => joint.firstNonzeroCommand_s === null ? [] : [joint.firstNonzeroCommand_s]));
    if (Number.isFinite(firstCommand)) {
      const index = frames.findIndex(({ t }) => t === firstCommand);
      selection.add(index - 1, 'before_first_nonzero_position_command'); selection.add(index, 'first_nonzero_position_command');
    }
    payload = {
      instance: payloadMeasure.instance, ...(payloadMeasure.holder ? { holder: payloadMeasure.holder } : {}),
      failedCriteria: failedPayloadCriteria,
      sampledPayloadDeltaYRange_m: range(observations.map(({ payloadDeltaY_m }) => payloadDeltaY_m)),
      sampledHolderReferenceDeltaYRange_m: range(observations.map(({ holderReferenceDeltaY_m }) => holderReferenceDeltaY_m)),
      samples: selection.rows().map(([index, phases]) => ({ ...observations[index], phases })),
      note: 'Holder reference follows the point occupied by the payload at t=0. Relative displacement is in the moving holder frame; it does not establish containment or contact. Sampled ranges may miss peaks captured by native all-step metrics.',
    };
  }
  if (!positionJoints.length && !payload) return undefined;
  // Prioritize the largest observed position errors when a complex machine exceeds the output budget.
  positionJoints.sort((a, b) => (b.peakAbsoluteError ?? -1) - (a.peakAbsoluteError ?? -1));
  const report = {
    diagnosticOnly: true as const, testId: result.testId.length <= 128 ? result.testId : '',
    omittedTestId: result.testId.length > 128,
    settleUntil_s: MOTION_SETTLE_S, sampleInterval_s: result.trace.dt,
    allMotorSaturationFraction: finite(result.metrics.motorSaturation_fraction),
    totalPositionJoints: positionJoints.length,
    omittedPositionJoints: Math.max(0, positionJoints.length - MAX_JOINTS),
    skippedVelocityDrives: [...drives.values()].filter(({ mode }) => mode === 'velocity').length,
    positionJoints: positionJoints.slice(0, MAX_JOINTS),
    omittedPayload: false,
    ...(payload ? { payload } : {}),
    note: 'Selected recorded samples, not continuous tracking. Joint coordinates are signed from the assembled pose (rad for revolute, m for prismatic); error is command minus actual. Commands use the exact recorded drive program and native settle/profile/ramp rules. First nonzero command means first sampled nonzero position target, not first motor effort. Recorded joint readings precede body poses by one native step (1/240 s). Missing or ambiguous shared-control readings stay null. Velocity drives are excluded from position error. Saturation is the maximum across all motors, not per joint; low demand or zero saturation does not prove adequate tracking. These observations never change native pass/fail.',
  };
  while (Buffer.byteLength(JSON.stringify(report), 'utf8') > MAX_BYTES && report.positionJoints.length) {
    report.positionJoints.pop(); report.omittedPositionJoints++;
  }
  if (Buffer.byteLength(JSON.stringify(report), 'utf8') > MAX_BYTES && report.payload) {
    delete report.payload; report.omittedPayload = true;
  }
  return report;
}

export type MotionDiagnostics = NonNullable<ReturnType<typeof motionDiagnostics>>;

export interface MotionObservations {
  diagnosticOnly: true;
  requestedTestCount: number;
  notApplicableTestCount: number;
  unavailableTestCount: number;
  omittedTestCount: number;
  omittedTestIds: string[];
  omittedTestIdCount: number;
  reports: MotionDiagnostics[];
}

/** Review context has one shared budget, rather than one full allowance per test. */
export function boundMotionObservations(input: MotionObservations, maxBytes = MAX_BYTES): MotionObservations | undefined {
  const report = structuredClone(input);
  while (Buffer.byteLength(JSON.stringify(report), 'utf8') > maxBytes && report.reports.length) {
    const omitted = report.reports.pop()!;
    report.omittedTestCount++;
    if (omitted.testId && report.omittedTestIds.length < 14) report.omittedTestIds.push(omitted.testId);
    else report.omittedTestIdCount++;
  }
  while (Buffer.byteLength(JSON.stringify(report), 'utf8') > maxBytes && report.omittedTestIds.length) {
    report.omittedTestIds.pop(); report.omittedTestIdCount++;
  }
  return Buffer.byteLength(JSON.stringify(report), 'utf8') <= maxBytes ? report : undefined;
}
