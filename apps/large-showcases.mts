export interface LargeShowcase {
  inventionId: string;
  versionId: string;
  testIds: readonly [string, ...string[]];
  baseline?: { versionId: string; testId: string };
  componentCount: number;
  detail: string;
  showStrokeGuidesInitially?: boolean;
}

// Add an entry after reviewing the exact saved Muse assembly and recorded tests.
export const largeShowcases: readonly LargeShowcase[] = [
  {
    inventionId: 'inv_a2b991c4bb614ee1',
    versionId: 'ver_cb8c608abe024f4c',
    testIds: ['skyline_show#3', 'skyline_extra_clear#3'],
    baseline: { versionId: 'ver_c4f812abf8f14568', testId: 'skyline_show#1' },
    componentCount: 60,
    detail: 'A 1.2 m Ferris wheel with eight colorful open cabins on passive pivots. Watch Muse repair the clearances, then complete 2.5 turns while the cabins stay upright.',
    showStrokeGuidesInitially: false,
  },
  {
    inventionId: 'inv_616e8b95ede04b8d',
    versionId: 'ver_52c54f258ec24abf',
    testIds: ['atlas_12s#1'],
    baseline: { versionId: 'ver_4bc3d25991af4466', testId: 'atlas_12s#1' },
    componentCount: 56,
    detail: 'A 1.42 m cutaway with one motor, six passive copper pistons and two large flywheels. Every piston travels about 11 cm in a staggered sequence.',
    showStrokeGuidesInitially: false,
  },
  {
    inventionId: 'inv_359fbaf0800a4c94',
    versionId: 'ver_0cb1ed656e1d43e7',
    testIds: ['lumen_full216#1'],
    baseline: { versionId: 'ver_10bbf56c86a44b5d', testId: 'lumen_wave#1' },
    componentCount: 78,
    detail: 'A 1.27 m flower with 24 powered petals. Two crowns send waves in opposite directions.',
    showStrokeGuidesInitially: false,
  },
  {
    inventionId: 'inv_a277ac7fde43455c',
    versionId: 'ver_9763f0e96fdf4549',
    testIds: ['phoenix-flap#1', 'phoenix-clearance#1', 'phoenix-extra-clearance#1', 'phoenix-tailfan-sec#1'],
    baseline: { versionId: 'ver_f0c51194a2f74db9', testId: 'phoenix-flap#1' },
    componentCount: 73,
    detail: 'A 1.26 m wingspan, 57 feathers and six powered joints. Watch the wings, copper head and fan tail move together.',
    showStrokeGuidesInitially: false,
  },
  {
    inventionId: 'inv_ece6826dc3414592',
    versionId: 'ver_127b6ecafb2d4d4b',
    testIds: ['wing_deploy#1', 'signed_walk#1', 'motion_all#1'],
    componentCount: 72,
    detail: 'A 1.13 m rover crosses a 45 mm ramp on eight driven wheels while its two blue solar wings unfold.',
    showStrokeGuidesInitially: false,
  },
  {
    inventionId: 'inv_5b8d9bc9fa68496b',
    versionId: 'ver_d6b56c3fa6a34853',
    testIds: ['octo_final#1', 'octo_clearance#1'],
    baseline: { versionId: 'ver_32b5f85f6bb0457d', testId: 'octo_wave#1' },
    componentCount: 54,
    detail: 'Eight ribbed arms curl through 24 powered joints. Every arm travels over 24 cm while clearing the camera and its neighbours.',
    showStrokeGuidesInitially: false,
  },
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
