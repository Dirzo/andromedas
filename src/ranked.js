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

/* Seasons: four weeks each, counted from 1 October 2026. When a player first shows up in a new season their
   rating moves halfway back to the start, their season record starts over, and last season's best tier
   stays on their profile as a badge. Ranked matches are Rapid, on a pool of asteroids that changes each season. */
export const SEASON0 = Date.UTC(2026, 9, 1), SEASON_LEN = 28 * 86400e3;
export function seasonOf(now = Date.now()) { return Math.max(1, Math.floor((now - SEASON0) / SEASON_LEN) + 1); }
export function seasonEnds(season) { return SEASON0 + season * SEASON_LEN; }
export function softReset(r) { return Math.round(START + (r - START) * 0.5); }
const POOLS = [['standard', 'rich', 'ice'], ['standard', 'deep', 'rough'], ['rich', 'ice', 'rough'], ['standard', 'deep', 'ice']];
export function mapPool(season) { return POOLS[(season - 1) % POOLS.length]; }
export function mapFor(season, mid) { const pool = mapPool(season); let h = 0; for (const c of String(mid)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return pool[h % pool.length]; }
export const RACES = ['terran', 'fowl', 'ceph', 'void'];

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
    /* columns added after launch: older ladders get them here */
    const cols = (t) => new Set(this.q(`PRAGMA table_info(${t})`).map(c => c.name));
    const pc = cols('players'); for (const [c, d] of [['season', 'INTEGER DEFAULT 0'], ['peak', 'INTEGER DEFAULT 0'], ['badges', "TEXT DEFAULT '[]'"]]) if (!pc.has(c)) sql.exec(`ALTER TABLE players ADD COLUMN ${c} ${d}`);
    const mc = cols('matches'); for (const [c, d] of [['race_a', 'TEXT'], ['race_b', 'TEXT'], ['season', 'INTEGER'], ['map', 'TEXT']]) if (!mc.has(c)) sql.exec(`ALTER TABLE matches ADD COLUMN ${c} ${d}`);
    sql.exec(`CREATE TABLE IF NOT EXISTS race_stats(id TEXT, season INTEGER, race TEXT, games INTEGER, wins INTEGER, PRIMARY KEY(id, season, race))`);
    sql.exec(`CREATE TABLE IF NOT EXISTS replays(mid TEXT PRIMARY KEY, code TEXT, dur INTEGER, at INTEGER, season INTEGER)`);
    sql.exec(`CREATE TABLE IF NOT EXISTS invites(to_id TEXT, from_id TEXT, code TEXT, at INTEGER)`);
  }
  q(query, ...b) { return this.sql.exec(query, ...b).toArray(); }
  get(id, now = Date.now()) { const p = this.q(`SELECT * FROM players WHERE id=?`, id)[0] || null; return p ? this.roll(p, now) : null; }
  /* move a player into the current season the first time they are seen in it */
  roll(p, now = Date.now()) {
    const s = seasonOf(now); if (p.season === s) return p;
    let badges = []; try { badges = JSON.parse(p.badges || '[]'); } catch (e) {}
    if (p.season && p.games > 0) badges.push({ season: p.season, tier: tierOf(Math.max(p.peak || 0, p.rating)), rating: p.rating });
    const r = p.season ? softReset(p.rating) : p.rating;
    this.q(`UPDATE players SET season=?, rating=?, peak=?, games=0, wins=0, losses=0, badges=? WHERE id=?`, s, r, r, JSON.stringify(badges.slice(-12)), p.id);
    return this.q(`SELECT * FROM players WHERE id=?`, p.id)[0];
  }
  /* sign in with the id and secret this device keeps; the first visit creates the player */
  async auth(id, secret, name, now = Date.now()) {
    if (typeof id !== 'string' || !/^[a-z0-9]{12,32}$/.test(id) || typeof secret !== 'string' || secret.length < 16 || secret.length > 128) return null;
    const sh = await sha(secret), p = this.get(id), nm = cleanName(name);
    if (!p) { this.q(`INSERT INTO players(id,sh,name,rating,games,wins,losses,seen,season,peak,badges) VALUES(?,?,?,?,0,0,0,?,?,?,'[]')`, id, sh, nm || 'Miner ' + id.slice(0, 4), START, now, seasonOf(now), START); return this.get(id, now); }
    if (p.sh !== sh) return null;
    if (nm && nm !== p.name) this.q(`UPDATE players SET name=?, seen=? WHERE id=?`, nm, now, id); else this.q(`UPDATE players SET seen=? WHERE id=?`, now, id);
    return this.get(id, now);
  }
  open(mid, a, b, now = Date.now(), races = [], map = 'standard') { this.q(`INSERT INTO matches(mid,a,b,created,status,race_a,race_b,season,map) VALUES(?,?,?,?, 'live',?,?,?,?)`, mid, a, b, now, races[0] || null, races[1] || null, seasonOf(now), map); }
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
      this.q(`UPDATE players SET rating=rating+?, games=games+1, wins=wins+1, peak=MAX(COALESCE(peak,0),rating+?) WHERE id=?`, d.a, d.a, winner);
      this.q(`UPDATE players SET rating=MAX(100,rating+?), games=games+1, losses=losses+1 WHERE id=?`, d.b, loser);
      const season = m.season || seasonOf(now);
      for (const [pid, race, won] of [[m.a, m.race_a, winner === m.a], [m.b, m.race_b, winner === m.b]]) if (race)
        this.q(`INSERT INTO race_stats VALUES(?,?,?,1,?) ON CONFLICT(id,season,race) DO UPDATE SET games=games+1, wins=wins+?`, pid, season, race, won ? 1 : 0, won ? 1 : 0);
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
  pub(p) { if (!p) return p; let badges = []; try { badges = JSON.parse(p.badges || '[]'); } catch (e) {}
    return { id: p.id, name: p.name, rating: p.rating, tier: tierOf(p.rating), games: p.games, wins: p.wins, losses: p.losses, provisional: p.games < PROVISIONAL, season: p.season, badges }; }
  races(id, season = seasonOf()) { const o = {}; for (const r of this.q(`SELECT race, games, wins FROM race_stats WHERE id=? AND season=?`, id, season)) o[r.race] = { games: r.games, wins: r.wins }; return o; }
  /* a race's ladder: players who played it this season, by rating, with their record on that race */
  raceBoard(race, limit = 50, now = Date.now()) {
    const s = seasonOf(now);
    return this.q(`SELECT p.*, r.games rg, r.wins rw FROM players p JOIN race_stats r ON r.id=p.id AND r.season=? AND r.race=? WHERE p.season=? AND p.games>0 ORDER BY p.rating DESC, p.id LIMIT ?`, s, race, s, limit)
      .map((p, i) => ({ ...this.pub(p), rank: i + 1, wins: p.rw, losses: p.rg - p.rw }));
  }
  season(now = Date.now()) { const s = seasonOf(now); return { n: s, ends: seasonEnds(s), maps: mapPool(s) }; }
  /* replays of ranked matches, shared by either player once the match is over */
  saveReplay(mid, id, code, dur, now = Date.now()) {
    const m = this.match(mid); if (!m || (m.a !== id && m.b !== id)) return { error: 'not your match' };
    if (typeof code !== 'string' || !code.startsWith('ANDROREPLAY1:') || code.length > 400000) return { error: 'bad replay' };
    this.q(`INSERT OR IGNORE INTO replays VALUES(?,?,?,?,?)`, mid, code, Math.max(0, Math.min(36000, dur | 0)), now, m.season || seasonOf(now));
    const old = this.q(`SELECT mid FROM replays ORDER BY at DESC LIMIT -1 OFFSET 300`); for (const o of old) this.q(`DELETE FROM replays WHERE mid=?`, o.mid);
    return { ok: true };
  }
  topReplays(limit = 20, now = Date.now()) {
    return this.q(`SELECT r.mid, r.dur, r.at, m.a, m.b, m.ra, m.rb FROM replays r JOIN matches m ON m.mid=r.mid WHERE m.status='done' AND r.season=? ORDER BY (COALESCE(m.ra,0)+COALESCE(m.rb,0)) DESC, r.at DESC LIMIT ?`, seasonOf(now), limit)
      .map(r => ({ mid: r.mid, dur: r.dur, at: r.at, a: (this.get(r.a) || {}).name, b: (this.get(r.b) || {}).name, ra: r.ra, rb: r.rb }));
  }
  replay(mid) { const r = this.q(`SELECT code FROM replays WHERE mid=?`, mid)[0]; return r ? r.code : null; }
  /* friends: find by name, and match invites that wait in an inbox for half an hour */
  findByName(name) { const n = cleanName(name); if (!n) return null; return this.q(`SELECT * FROM players WHERE name=? COLLATE NOCASE ORDER BY seen DESC LIMIT 1`, n)[0] || null; }
  invite(from, to, code, now = Date.now()) {
    if (!/^[a-z0-9]{4}$/.test(String(code)) || !this.q(`SELECT id FROM players WHERE id=?`, to)[0] || from === to) return { error: 'bad invite' };
    if (this.q(`SELECT COUNT(*) n FROM invites WHERE to_id=?`, to)[0].n >= 20) return { error: 'inbox full' };
    this.q(`INSERT INTO invites VALUES(?,?,?,?)`, to, from, code, now); return { ok: true };
  }
  inbox(id, now = Date.now()) {
    const L = this.q(`SELECT * FROM invites WHERE to_id=? AND at>? ORDER BY at DESC`, id, now - 30 * 60e3); this.q(`DELETE FROM invites WHERE to_id=? OR at<=?`, id, now - 30 * 60e3);
    return L.map(i => ({ code: i.code, at: i.at, name: (this.get(i.from_id) || {}).name || 'A friend' }));
  }
  rank(p) { return 1 + this.q(`SELECT COUNT(*) n FROM players WHERE games>0 AND season=? AND rating>?`, p.season, p.rating)[0].n; }
  board(limit = 50, now = Date.now()) {
    return this.q(`SELECT * FROM players WHERE games>0 AND season=? ORDER BY rating DESC, wins DESC, id LIMIT ?`, seasonOf(now), limit).map((p, i, all) => ({ rank: 0, ...this.pub(p) }))
      .map((p, i, all) => { p.rank = i && all[i - 1].rating === p.rating ? all[i - 1].rank : i + 1; return p; });
  }
}
