/* Andromedas on Cloudflare: the Worker serves the game files, and /ws/<match> connects a player
   to that match's Durable Object, which relays player messages (see relay.js). */
import { Relay } from './relay.js';

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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/ws\/([a-z0-9][a-z0-9-]{0,47})$/);
    if (m) { const stub = env.ROOMS.get(env.ROOMS.idFromName(m[1])); return stub.fetch(request); }
    return env.ASSETS.fetch(request);
  }
};
