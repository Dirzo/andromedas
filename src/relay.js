/* The match relay: one instance per match code. It knows nothing about the game.
   Each player keeps a small "presence" object (the game puts its pending commands there);
   the relay stores the latest one per player and forwards every change to the others. */
export class Relay {
  constructor(maxPlayers = 8, now = () => Date.now()) { this.max = maxPlayers; this.players = new Map(); this.n = 0; this.now = now;
    /* for rejoining a running match: the commands each tick ran (every screen sends the same ones; the first copy is kept),
       the last tick any screen reported running, the match's start message, and the last presence of players who left */
    this.log = new Map(); this.logSize = 0; this.upTo = -1; this.go = null; this.ghosts = new Map(); }
  /* a socket connected; it is not in the match until it says hello */
  open(conn) { const id = (++this.n).toString(36) + Math.random().toString(36).slice(2, 6); this.pending = this.pending || new Map(); this.pending.set(id, conn); return id; }
  message(id, text) {
    if (typeof text !== 'string' || text.length > 16384) return;
    let m; try { m = JSON.parse(text); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'hello') {
      const conn = this.pending && this.pending.get(id); if (!conn || this.players.has(id)) return; this.pending.delete(id);
      if (this.players.size >= this.max) { try { conn.send('{"t":"full"}'); conn.close(4000, 'match full'); } catch (e) {} return; }
      const w = { t: 'welcome', id, peers: [...this.players.values()].map(p => ({ id: p.id, presence: p.presence })) };
      if (m.resume && this.go) { this.sendLog(conn); w.resume = { go: this.go, upTo: this.upTo, ghosts: [...this.ghosts.values()].map(g => g.presence) }; }
      conn.send(JSON.stringify(w));
      this.players.set(id, { id, conn, presence: {} }); this.broadcast({ t: 'join', id, presence: {} }, id); return;
    }
    const me = this.players.get(id); if (!me) return;
    if (m.t === 'p' && m.patch && typeof m.patch === 'object' && !Array.isArray(m.patch)) {
      for (const k of Object.keys(m.patch)) { if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue; if (m.patch[k] === null) delete me.presence[k]; else me.presence[k] = m.patch[k]; }
      if (JSON.stringify(me.presence).length > 16384) me.presence = {};
      this.broadcast({ t: 'upd', id, presence: me.presence }, id);
    } else if (m.t === 'log' && Number.isInteger(m.k) && m.k >= 0 && Array.isArray(m.c)) {
      if (!this.log.has(m.k) && this.logSize < 4e6) { const j = JSON.stringify(m.c); this.log.set(m.k, j); this.logSize += j.length + 12; }
    } else if (m.t === 'up' && Number.isInteger(m.k)) { if (m.k > this.upTo) this.upTo = m.k;
    } else if (m.t === 'go' && m.go && typeof m.go === 'object') { if (!this.go) this.go = m.go;
    } else if (m.t === 'ping') { try { me.conn.send('{"t":"pong"}'); } catch (e) {} }
  }
  close(id) { if (this.pending) this.pending.delete(id); const p = this.players.get(id);
    if (p) { this.players.delete(id); if (this.go) { this.ghosts.set(id, { presence: p.presence, at: this.now() }); this.prune(); } this.broadcast({ t: 'left', id }, null); } }
  prune() { const old = this.now() - 15 * 60e3; for (const [k, g] of this.ghosts) if (g.at < old || this.ghosts.size > 16) this.ghosts.delete(k); }
  /* the log goes out in pieces under the 1 MB WebSocket message limit, before the welcome that ends it */
  sendLog(conn) { let part = [], size = 0; const flush = () => { if (part.length) { try { conn.send('{"t":"rlog","e":[' + part.join(',') + ']}'); } catch (e) {} } part = []; size = 0; };
    for (const [k, j] of this.log) { if (k > this.upTo) continue; const e = '[' + k + ',' + j + ']'; part.push(e); size += e.length; if (size > 500e3) flush(); } flush(); }
  broadcast(msg, except) { const txt = JSON.stringify(msg); for (const p of this.players.values()) if (p.id !== except) { try { p.conn.send(txt); } catch (e) {} } }
}
