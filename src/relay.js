/* The match relay: one instance per match code. It knows nothing about the game.
   Each player keeps a small "presence" object (the game puts its pending commands there);
   the relay stores the latest one per player and forwards every change to the others. */
export class Relay {
  constructor(maxPlayers = 8) { this.max = maxPlayers; this.players = new Map(); this.n = 0; }
  /* a socket connected; it is not in the match until it says hello */
  open(conn) { const id = (++this.n).toString(36) + Math.random().toString(36).slice(2, 6); this.pending = this.pending || new Map(); this.pending.set(id, conn); return id; }
  message(id, text) {
    if (typeof text !== 'string' || text.length > 16384) return;
    let m; try { m = JSON.parse(text); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'hello') {
      const conn = this.pending && this.pending.get(id); if (!conn || this.players.has(id)) return; this.pending.delete(id);
      if (this.players.size >= this.max) { try { conn.send('{"t":"full"}'); conn.close(4000, 'match full'); } catch (e) {} return; }
      conn.send(JSON.stringify({ t: 'welcome', id, peers: [...this.players.values()].map(p => ({ id: p.id, presence: p.presence })) }));
      this.players.set(id, { id, conn, presence: {} }); this.broadcast({ t: 'join', id, presence: {} }, id); return;
    }
    const me = this.players.get(id); if (!me) return;
    if (m.t === 'p' && m.patch && typeof m.patch === 'object' && !Array.isArray(m.patch)) {
      for (const k of Object.keys(m.patch)) { if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue; if (m.patch[k] === null) delete me.presence[k]; else me.presence[k] = m.patch[k]; }
      if (JSON.stringify(me.presence).length > 16384) me.presence = {};
      this.broadcast({ t: 'upd', id, presence: me.presence }, id);
    } else if (m.t === 'ping') { try { me.conn.send('{"t":"pong"}'); } catch (e) {} }
  }
  close(id) { if (this.pending) this.pending.delete(id); if (this.players.delete(id)) this.broadcast({ t: 'left', id }, null); }
  broadcast(msg, except) { const txt = JSON.stringify(msg); for (const p of this.players.values()) if (p.id !== except) { try { p.conn.send(txt); } catch (e) {} } }
}
