/* Ranked 1v1: Elo ratings, the matchmaking queue and match results. Nothing here touches the game
   itself; matches still run through the normal relay (relay.js) with deterministic lockstep.
   The Ladder Durable Object in worker.js wraps this with WebSockets and SQLite storage. */

export const START = 1200;
export const PROVISIONAL = 10;          // games before a rating settles
export const REPORT_GRACE = 120e3;      // after one player reports, how long to wait for the other
export const MATCH_TTL = 2 * 3600e3;    // a match nobody reported is dropped after this

export function kFactor(p) { return p.games < PROVISIONAL ? 48 : p.rating >= 2000 ? 24 : 32; }
export function expected(ra, rb) { return 1 / (1 + Math.pow(10, (rb - ra) / 400)); }
/* rating changes for a decided game: a beat b */
export function eloDelta(a, b) {
  const e = expected(a.rating, b.rating);
  return { a: Math.max(1, Math.round(kFactor(a) * (1 - e))), b: -Math.max(1, Math.round(kFactor(b) * (1 - e))) };
}
export const TIERS = [[2000, 'Andromeda'], [1800, 'Iridium'], [1600, 'Platinum'], [1400, 'Titanium'], [1200, 'Iron'], [1000, 'Copper'], [-1e9, 'Rock']];
export function tierOf(r) { for (const [min, n] of TIERS) if (r >= min) return n; return 'Rock'; }

export function cleanName(s) {
  s = String(s || '').replace(/[^\p{L}\p{N} _.\-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  return s.length >= 2 ? s : null;
}
const ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789';
export function randCode(n, rand = Math.random) { let c = ''; for (let i = 0; i < n; i++) c += ALPHA[Math.floor(rand() * ALPHA.length)]; return c; }
export async function sha(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/* The queue: players wait here until someone close enough in rating is also waiting. The allowed
   gap starts at 100 and widens by 20 a second, so nobody waits forever on a quiet night. */
export class Queue {
  constructor() { this.wait = new Map(); }
  add(e) { this.wait.set(e.id, e); }
  remove(id) { this.wait.delete(id); }
  has(id) { return this.wait.has(id); }
  window(e, now) { return Math.min(800, 100 + 20 * (now - e.since) / 1000); }
  /* pair up everyone who can be paired, longest wait first; returns [[a,b],...] */
  pairs(now) {
    const out = [], list = [...this.wait.values()].sort((x, y) => x.since - y.since), used = new Set();
    for (const a of list) {
      if (used.has(a.id)) continue; let best = null, gap = Infinity;
      for (const b of list) {
        if (b === a || used.has(b.id) || b.avoid === a.id || a.avoid === b.id) continue;
        const g = Math.abs(a.rating - b.rating);
        if (g <= Math.max(this.window(a, now), this.window(b, now)) && g < gap) { best = b; gap = g; }
      }
      if (best) { used.add(a.id); used.add(best.id); out.push([a, best]); }
    }
    for (const [a, b] of out) { this.wait.delete(a.id); this.wait.delete(b.id); }
    return out;
  }
}

/* Ratings and matches in SQLite. `sql` is a Durable Object storage.sql (or anything with the same
   exec(query, ...binds).toArray() shape, which the tests use). */
export class Ladder {
  constructor(sql) {
    this.sql = sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS players(id TEXT PRIMARY KEY, sh TEXT, name TEXT, rating INTEGER, games INTEGER, wins INTEGER, losses INTEGER, seen INTEGER)`);
    sql.exec(`CREATE INDEX IF NOT EXISTS players_rating ON players(rating)`);
    sql.exec(`CREATE TABLE IF NOT EXISTS matches(mid TEXT PRIMARY KEY, a TEXT, b TEXT, created INTEGER, status TEXT, rep_a TEXT, rep_b TEXT, first_rep INTEGER, winner TEXT, da INTEGER, db INTEGER, ra INTEGER, rb INTEGER)`);
    sql.exec(`CREATE INDEX IF NOT EXISTS matches_status ON matches(status)`);
  }
  q(query, ...b) { return this.sql.exec(query, ...b).toArray(); }
  get(id) { return this.q(`SELECT * FROM players WHERE id=?`, id)[0] || null; }
  /* sign in with the id and secret this device keeps; the first visit creates the player */
  async auth(id, secret, name, now = Date.now()) {
    if (typeof id !== 'string' || !/^[a-z0-9]{12,32}$/.test(id) || typeof secret !== 'string' || secret.length < 16 || secret.length > 128) return null;
    const sh = await sha(secret), p = this.get(id), nm = cleanName(name);
    if (!p) { this.q(`INSERT INTO players VALUES(?,?,?,?,0,0,0,?)`, id, sh, nm || 'Miner ' + id.slice(0, 4), START, now); return this.get(id); }
    if (p.sh !== sh) return null;
    if (nm && nm !== p.name) this.q(`UPDATE players SET name=?, seen=? WHERE id=?`, nm, now, id); else this.q(`UPDATE players SET seen=? WHERE id=?`, now, id);
    return this.get(id);
  }
  open(mid, a, b, now = Date.now()) { this.q(`INSERT INTO matches(mid,a,b,created,status) VALUES(?,?,?,?, 'live')`, mid, a, b, now); }
  match(mid) { return this.q(`SELECT * FROM matches WHERE mid=?`, mid)[0] || null; }
  /* a player says how their game ended: 'win', 'loss' or 'abort' (the match never got going) */
  report(mid, id, outcome, now = Date.now()) {
    const m = this.match(mid); if (!m || (m.a !== id && m.b !== id)) return { error: 'not your match' };
    if (!['win', 'loss', 'abort'].includes(outcome)) return { error: 'bad outcome' };
    if (m.status !== 'live') return this.view(m);
    const col = m.a === id ? 'rep_a' : 'rep_b';
    if (!m[col]) this.q(`UPDATE matches SET ${col}=?, first_rep=COALESCE(first_rep,?) WHERE mid=?`, outcome, now, mid);
    return this.settle(this.match(mid), now);
  }
  /* decide a match once both reports are in, or one is in and the grace period has run out */
  settle(m, now = Date.now()) {
    if (m.status !== 'live') return this.view(m);
    const A = m.rep_a, B = m.rep_b, late = m.first_rep != null && now - m.first_rep >= REPORT_GRACE;
    let winner = null, status = null;
    if (A && B) {
      if (A === 'win' && B === 'loss') winner = m.a; else if (A === 'loss' && B === 'win') winner = m.b;
      else status = A === 'abort' || B === 'abort' ? 'void' : 'disputed';
    } else if (late) {
      const r = A || B, who = A ? m.a : m.b, other = A ? m.b : m.a;
      if (r === 'win') winner = who; else if (r === 'loss') winner = other; else status = 'void';
    } else if (now - m.created >= MATCH_TTL) status = 'void';
    if (winner) {
      const loser = winner === m.a ? m.b : m.a, w = this.get(winner), l = this.get(loser), d = eloDelta(w, l);
      this.q(`UPDATE players SET rating=rating+?, games=games+1, wins=wins+1 WHERE id=?`, d.a, winner);
      this.q(`UPDATE players SET rating=MAX(100,rating+?), games=games+1, losses=losses+1 WHERE id=?`, d.b, loser);
      const da = winner === m.a ? d.a : d.b, db = winner === m.a ? d.b : d.a;
      this.q(`UPDATE matches SET status='done', winner=?, da=?, db=?, ra=?, rb=? WHERE mid=?`, winner, da, db, this.get(m.a).rating, this.get(m.b).rating, m.mid);
    } else if (status) this.q(`UPDATE matches SET status=? WHERE mid=?`, status, m.mid);
    return this.view(this.match(m.mid));
  }
  /* settle everything whose wait is over; returns when the next one will be due */
  sweep(now = Date.now()) {
    for (const m of this.q(`SELECT * FROM matches WHERE status='live' AND (first_rep<=? OR created<=?)`, now - REPORT_GRACE, now - MATCH_TTL)) this.settle(m, now);
    const n = this.q(`SELECT MIN(first_rep) t FROM matches WHERE status='live' AND first_rep IS NOT NULL`)[0];
    return n && n.t != null ? n.t + REPORT_GRACE : null;
  }
  view(m) {
    const side = (id, d, r) => { const p = this.get(id); return p && { id, name: p.name, delta: d, rating: r != null ? r : p.rating }; };
    return { mid: m.mid, status: m.status, winner: m.winner, a: side(m.a, m.da, m.ra), b: side(m.b, m.db, m.rb) };
  }
  pub(p) { return p && { id: p.id, name: p.name, rating: p.rating, tier: tierOf(p.rating), games: p.games, wins: p.wins, losses: p.losses, provisional: p.games < PROVISIONAL }; }
  rank(p) { return 1 + this.q(`SELECT COUNT(*) n FROM players WHERE games>0 AND rating>?`, p.rating)[0].n; }
  board(limit = 50) {
    return this.q(`SELECT * FROM players WHERE games>0 ORDER BY rating DESC, wins DESC, id LIMIT ?`, limit).map((p, i, all) => ({ rank: 0, ...this.pub(p) }))
      .map((p, i, all) => { p.rank = i && all[i - 1].rating === p.rating ? all[i - 1].rank : i + 1; return p; });
  }
}
