import type { Assembly, TestResult } from '@protolab/schema';

export function recordedPenPath(assembly: Assembly, test: TestResult | null | undefined) {
  if (test?.kind !== 'motion') return undefined;
  const markers = new Set(assembly.parts.filter((part) => part.kind === 'marker_tip').map((part) => part.id));
  return assembly.instances.find(({ id, partId }) =>
    (id === 'pen_tip' || markers.has(partId)) &&
    Object.keys(test.metrics).filter((key) => key.startsWith(`${id}.travel_`)).length >= 2 &&
    test.trace.frames.some((frame) => frame.bodies[id])
  )?.id;
}
