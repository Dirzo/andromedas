// Ranked play: Elo maths, the queue and result handling. Run with `node --test test/`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Queue, Ladder, eloDelta, expected, tierOf, cleanName, REPORT_GRACE, MATCH_TTL, START } from '../src/ranked.js';

/* node:sqlite dressed up as a Durable Object's storage.sql */
function memSql() { const db = new DatabaseSync(':memory:');
  return { exec(q, ...b) { const st = db.prepare(q); const rows = /^\s*(SELECT|WITH)/i.test(q) ? st.all(...b) : (st.run(...b), []); return { toArray: () => rows }; } }; }
const SECRET = 'x'.repeat(24);
async function two(L) { await L.auth('aaaaaaaaaaaa', SECRET, 'Ada'); await L.auth('bbbbbbbbbbbb', SECRET, 'Bo'); L.open('m1', 'aaaaaaaaaaaa', 'bbbbbbbbbbbb', 0); }

test('expected score and deltas', () => {
  assert.equal(expected(1200, 1200), 0.5);
  assert.ok(Math.abs(expected(1600, 1200) - 0.909) < 0.001);
  assert.deepEqual(eloDelta({ rating: 1200, games: 20 }, { rating: 1200, games: 20 }), { a: 16, b: -16 });
  assert.deepEqual(eloDelta({ rating: 1200, games: 0 }, { rating: 1200, games: 0 }), { a: 24, b: -24 });
  const upset = eloDelta({ rating: 1000, games: 30 }, { rating: 1400, games: 30 }); assert.equal(upset.a, 29);
  const fav = eloDelta({ rating: 1800, games: 30 }, { rating: 1000, games: 30 }); assert.equal(fav.a, 1); assert.equal(fav.b, -1);
  assert.equal(tierOf(START), 'Iron'); assert.equal(tierOf(2100), 'Andromeda'); assert.equal(tierOf(900), 'Rock');
  assert.equal(cleanName('  <b>Cam</b>  '), 'bCamb'); assert.equal(cleanName('x'), null);
});

test('queue pairs close ratings first and widens with time', () => {
  const q = new Queue();
  q.add({ id: 'a', rating: 1200, since: 0 }); q.add({ id: 'b', rating: 1500, since: 0 }); q.add({ id: 'c', rating: 1260, since: 0 });
  const p = q.pairs(0); assert.equal(p.length, 1); assert.deepEqual(p[0].map(e => e.id).sort(), ['a', 'c']);
  q.add({ id: 'd', rating: 1200, since: 0 });
  assert.equal(q.pairs(5000).length, 0, '300 apart is too far after 5s');
  assert.equal(q.pairs(10000).length, 1, '...but fine after 10s'); assert.equal(q.wait.size, 0);
});

test('agreeing reports move both ratings', async () => {
  const L = new Ladder(memSql()); await two(L);
  assert.equal(L.report('m1', 'aaaaaaaaaaaa', 'win', 10).status, 'live');
  const v = L.report('m1', 'bbbbbbbbbbbb', 'loss', 20);
  assert.equal(v.status, 'done'); assert.equal(v.winner, 'aaaaaaaaaaaa'); assert.equal(v.a.delta, 24); assert.equal(v.b.delta, -24);
  assert.equal(L.get('aaaaaaaaaaaa').rating, 1224); assert.equal(L.get('bbbbbbbbbbbb').losses, 1);
  assert.equal(L.report('m1', 'aaaaaaaaaaaa', 'win', 30).status, 'done', 'a second report changes nothing'); assert.equal(L.get('aaaaaaaaaaaa').rating, 1224);
  assert.deepEqual(L.board().map(p => p.name), ['Ada', 'Bo']); assert.equal(L.rank(L.get('bbbbbbbbbbbb')), 2);
});

test('conflicting reports change nothing; a lone report counts after the grace period', async () => {
  let L = new Ladder(memSql()); await two(L);
  L.report('m1', 'aaaaaaaaaaaa', 'win', 0); assert.equal(L.report('m1', 'bbbbbbbbbbbb', 'win', 1).status, 'disputed'); assert.equal(L.get('aaaaaaaaaaaa').rating, START);
  L = new Ladder(memSql()); await two(L);
  L.report('m1', 'bbbbbbbbbbbb', 'win', 100);
  assert.equal(L.sweep(100 + REPORT_GRACE - 1), 100 + REPORT_GRACE); assert.equal(L.match('m1').status, 'live');
  L.sweep(100 + REPORT_GRACE); assert.equal(L.match('m1').status, 'done'); assert.equal(L.match('m1').winner, 'bbbbbbbbbbbb');
  L = new Ladder(memSql()); await two(L); L.report('m1', 'aaaaaaaaaaaa', 'abort', 0); L.report('m1', 'bbbbbbbbbbbb', 'win', 1);
  assert.equal(L.match('m1').status, 'void');
  L = new Ladder(memSql()); await two(L); L.sweep(MATCH_TTL); assert.equal(L.match('m1').status, 'void');
});

test('a player keeps their id only with the right secret, and only players in the match can report', async () => {
  const L = new Ladder(memSql()); await two(L);
  assert.equal(await L.auth('aaaaaaaaaaaa', 'y'.repeat(24), 'Thief'), null);
  assert.equal((await L.auth('aaaaaaaaaaaa', SECRET, 'Ada L')).name, 'Ada L');
  assert.equal(await L.auth('short', SECRET), null);
  await L.auth('cccccccccccc', SECRET, 'Cy'); assert.ok(L.report('m1', 'cccccccccccc', 'win').error);
});
