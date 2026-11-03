import { runAgent } from './index.ts';
let n = 0;
const out = await runAgent({ prompt: process.argv[2] ?? 'Design a small walking robot inspired by my Muse character, test its walking, then make it dance.', inventionId: 'x', model: null, newVersionId: () => `v${++n}` }, (e) => {
  if (e.type === 'tool') console.log(`[${e.entry.ok ? 'ok' : 'ERR'}] ${e.entry.tool}: ${e.entry.summary}`);
  if (e.type === 'test') console.log('   metrics', JSON.stringify(e.result.metrics));
});
console.log(out.status, out.summary);
