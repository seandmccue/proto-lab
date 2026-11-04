export interface LargeShowcase {
  inventionId: string;
  versionId: string;
  testIds: readonly [string, ...string[]];
  baseline?: { versionId: string; testId: string };
  componentCount: number;
  detail: string;
}

// Add an entry after reviewing the exact saved Muse assembly and recorded tests.
export const largeShowcases: readonly LargeShowcase[] = [
  {
    inventionId: 'inv_6780a73a8a094f4d',
    versionId: 'ver_b928a3e12bff40ac',
    testIds: ['planets_12s#1', 'moons_12s#1'],
    componentCount: 40,
    detail: 'Four planets turn at different speeds while two moons orbit their moving planets. All six paths passed.',
  },
  {
    inventionId: 'inv_141c845eaee64843',
    versionId: 'ver_d0e0a7dc13b44bf6',
    testIds: ['wave12#1'],
    baseline: { versionId: 'ver_8a57e0f42a0a4e55', testId: 'wave12#1' },
    componentCount: 41,
    detail: 'One shaft moves nine jewels in sequence, with a 19.88 mm minimum stroke across four measured cycles.',
  },
  {
    inventionId: 'inv_e20b1b857e4743d6',
    versionId: 'ver_e9b217f022c24879',
    testIds: ['aurora_12s_color#1'],
    componentCount: 37,
    detail: 'Twelve passive cabins stay within 3.5° of upright through two full turns.',
  },
];
