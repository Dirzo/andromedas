/* Andromedas on Cloudflare: the Worker serves the game files, /ws/<match> connects a player to that
   match's Durable Object, which relays player messages (see relay.js), and /ranked/... reaches the
   one Ladder Durable Object that runs the ranked queue and keeps everyone's rating (see ranked.js). */
import { Relay } from './relay.js';
import { Queue, Ladder as LadderStore, randCode } from './ranked.js';

export class Room {
  constructor(state, env) { this.relay = new Relay(8); }
  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const pair = new WebSocketPair(); const [client, server] = Object.values(pair);
    server.accept();
    const id = this.relay.open({ send: (t) => server.send(t), close: (c, r) => server.close(c, r) });
    server.addEventListener('message', (e) => this.relay.message(id, typeof e.data === 'string' ? e.data : ''));
    const bye = () => this.relay.close(id);
    server.addEventListener('close', bye); server.addEventListener('error', bye);
    return new Response(null, { status: 101, webSocket: client });
  }
}

const RACES = ['terran', 'fowl', 'ceph', 'void'];
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export class Ladder {
  constructor(state, env) {
    this.state = state; this.store = new LadderStore(state.storage.sql); this.queue = new Queue();
    this.socks = new Map(); this.timer = null;
  }
  async fetch(request) {
    const url = new URL(request.url), path = url.pathname;
    if (path === '/ranked/queue') return this.queueSocket(request);
    let body = {}; if (request.method === 'POST') { try { body = await request.json(); } catch (e) { return json({ error: 'bad request' }, 400); } }
    if (path === '/ranked/me') {
      const p = await this.store.auth(body.id, body.secret, body.name); if (!p) return json({ error: 'sign-in failed' }, 403);
      return json({ me: { ...this.store.pub(p), rank: p.games ? this.store.rank(p) : null } });
    }
    if (path === '/ranked/ladder') {
      const p = this.store.get(String(url.searchParams.get('id') || ''));
      return json({ top: this.store.board(50), me: p ? { ...this.store.pub(p), rank: p.games ? this.store.rank(p) : null } : null });
    }
    if (path === '/ranked/result') {
      const p = await this.store.auth(body.id, body.secret); if (!p) return json({ error: 'sign-in failed' }, 403);
      const r = this.store.report(String(body.mid || ''), p.id, body.outcome); await this.schedule(); return json(r, r.error ? 400 : 200);
    }
    if (path === '/ranked/match') {
      const m = this.store.match(String(url.searchParams.get('mid') || '')); if (!m) return json({ error: 'no such match' }, 404);
      return json(this.store.settle(m));
    }
    return json({ error: 'not found' }, 404);
  }
  async alarm() { await this.schedule(); }
  async schedule() { const next = this.store.sweep(); if (next) await this.state.storage.setAlarm(Math.max(next, Date.now() + 1000)); }
  queueSocket(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const pair = new WebSocketPair(); const [client, ws] = Object.values(pair); ws.accept();
    let me = null; const send = (o) => { try { ws.send(JSON.stringify(o)); } catch (e) {} };
    ws.addEventListener('message', async (e) => {
      let m; try { m = JSON.parse(e.data); } catch (err) { return; }
      if (m.t === 'queue' && !me) {
        const p = await this.store.auth(m.id, m.secret, m.name); if (!p) { send({ t: 'error', why: 'sign-in failed' }); ws.close(4003, 'auth'); return; }
        me = p.id; const old = this.socks.get(me); if (old) { old.send({ t: 'replaced' }); old.close(); }
        this.socks.set(me, { send, close: () => { try { ws.close(1000, 'done'); } catch (err) {} } });
        this.queue.add({ id: me, rating: p.rating, race: RACES.includes(m.race) ? m.race : 'terran', since: Date.now() });
        send({ t: 'queued', me: { ...this.store.pub(p), rank: p.games ? this.store.rank(p) : null }, waiting: this.queue.wait.size });
        this.pairUp();
      } else if (m.t === 'ping') send({ t: 'pong', waiting: this.queue.wait.size });
    });
    const bye = () => { if (me && this.socks.get(me)?.send === send) { this.socks.delete(me); this.queue.remove(me); } };
    ws.addEventListener('close', bye); ws.addEventListener('error', bye);
    return new Response(null, { status: 101, webSocket: client });
  }
  pairUp() {
    for (const [a, b] of this.queue.pairs(Date.now())) {
      const mid = randCode(10), code = 'r' + randCode(11), seed = (Math.random() * 2 ** 31) | 0;
      const [s0, s1] = Math.random() < 0.5 ? [a, b] : [b, a];
      this.store.open(mid, s0.id, s1.id);
      const races = [s0.race, s1.race], pa = this.store.pub(this.store.get(s0.id)), pb = this.store.pub(this.store.get(s1.id));
      for (const [e, side, foe] of [[s0, 0, pb], [s1, 1, pa]]) {
        const c = this.socks.get(e.id); if (!c) continue;
        c.send({ t: 'match', mid, code, side, seed, races, foe: { id: foe.id, name: foe.name, rating: foe.rating, tier: foe.tier } }); c.close(); this.socks.delete(e.id);
      }
    }
    if (this.queue.wait.size && !this.timer) this.timer = setInterval(() => { this.pairUp(); if (!this.queue.wait.size) { clearInterval(this.timer); this.timer = null; } }, 2000);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/ws\/([a-z0-9][a-z0-9-]{0,47})$/);
    if (m) { const stub = env.ROOMS.get(env.ROOMS.idFromName(m[1])); return stub.fetch(request); }
    if (url.pathname.startsWith('/ranked/')) return env.LADDER.get(env.LADDER.idFromName('ladder')).fetch(request);
    return env.ASSETS.fetch(request);
  }
};
