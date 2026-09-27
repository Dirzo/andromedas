# Andromedas

A real-time strategy game on a small spherical asteroid with a diggable, layered crust. Four races (Humans, Space Fowl, Cephalopods and the Vessk), buried deposits to survey and mine, three path cards that decide your specialist, tech building and mega unit, and co-op or versus multiplayer for up to four players.

The game is a single page (`public/index.html`, built with three.js from a CDN). Multiplayer runs through a small Cloudflare Worker: each match code gets its own Durable Object that relays the players' commands. Both players' browsers run the same deterministic simulation (lockstep), so the server never simulates anything and stays tiny.

## Files

- `public/index.html`: the whole game.
- `src/worker.js`: the Worker. Serves `public/` and connects `/ws/<match>` to that match's Durable Object.
- `src/relay.js`: the match relay itself (about 40 lines, no game logic).
- `wrangler.toml`: Cloudflare config (static assets, the Durable Object binding and its migration).

## Deploy on Cloudflare (free plan works)

1. On GitHub, create a new empty repository, for example `Dirzo/andromedas`.
2. Upload everything in this folder to the root of that repository (**Add file → Upload files**, drag in `public`, `src`, `wrangler.toml`, `README.md` and `.gitignore`, then commit). Keep the folder structure.
3. In the Cloudflare dashboard go to **Workers & Pages → Create → Workers → Import a repository** (it may say **Connect to Git**), and pick the repository.
4. Leave the build command empty and the deploy command as `npx wrangler deploy`. Click **Deploy**.
5. The game is live at `https://andromedas.<your-subdomain>.workers.dev`. Every push to the main branch redeploys it.

Note: this has to be a **Worker**, not a Pages project, because multiplayer needs the Durable Object.

## Playing together

Open the site, pick a crew, and click **Host a match**. Send the 4-letter code to up to three friends; they open the same site, pick a crew, type the code and click **Join**. Everyone picks Blue or Red: players on the same side share one base and army, and an empty side is played by the computer. The host clicks **Start match**.

No accounts are needed. Players should use the same browser engine if possible (Chrome or Edge on all machines), because the simulation must match bit for bit; the game warns you if the screens ever drift out of sync.

## Run it locally

With Node installed: `npx wrangler dev`, then open http://localhost:8787. Opening `public/index.html` straight from disk works for single player only.
