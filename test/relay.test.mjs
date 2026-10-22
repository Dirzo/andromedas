import test from 'node:test';
import assert from 'node:assert/strict';
import { Relay } from '../src/relay.js';

const sock = () => { const c = { out: [], closed: false, send(t) { c.out.push(JSON.parse(t)); }, close() { c.closed = true; } }; return c; };
function connect(r, resume) { const c = sock(); const id = r.open(c); r.message(id, JSON.stringify({ t: 'hello', resume })); return { id, c }; }

test('presence is forwarded to the other players', () => {
  const r = new Relay(); const a = connect(r), b = connect(r);
  r.message(a.id, JSON.stringify({ t: 'p', patch: { lk: { p: 0 } } }));
  assert.deepEqual(b.c.out.at(-1), { t: 'upd', id: a.id, presence: { lk: { p: 0 } } });
});

test('a player who drops can resume with the command log, the start message and their last presence', () => {
  let now = 0; const r = new Relay(8, () => now); const a = connect(r), b = connect(r);
  r.message(a.id, JSON.stringify({ t: 'go', go: { seed: 7 } }));
  r.message(a.id, JSON.stringify({ t: 'log', k: 4, c: [[0, { t: 'mv' }]] }));
  r.message(b.id, JSON.stringify({ t: 'log', k: 4, c: [[0, { t: 'other' }]] }));
  r.message(a.id, JSON.stringify({ t: 'log', k: 90, c: [[1, { t: 'late' }]] }));
  r.message(b.id, JSON.stringify({ t: 'up', k: 40 }));
  r.message(b.id, JSON.stringify({ t: 'p', patch: { lk: { p: 1, h: 20 } } }));
  r.close(b.id);
  const c = connect(r, 1);
  const rlog = c.c.out.filter(m => m.t === 'rlog').flatMap(m => m.e), w = c.c.out.find(m => m.t === 'welcome');
  assert.deepEqual(rlog, [[4, [[0, { t: 'mv' }]]]]);
  assert.deepEqual(w.resume, { go: { seed: 7 }, upTo: 40, ghosts: [{ lk: { p: 1, h: 20 } }] });
  const fresh = connect(r, 0); assert.equal(fresh.c.out.find(m => m.t === 'welcome').resume, undefined);
});
