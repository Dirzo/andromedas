# Andromedas

A real-time strategy game on a small spherical asteroid with a diggable, layered crust. Four races (Humans, Space Fowl, Cephalopods and the Vessk), buried deposits to survey and mine, three path cards that decide your specialist, tech building and mega unit, and co-op or versus multiplayer for up to four players.

The game is a single page (`public/index.html`, built with three.js from a CDN). Multiplayer runs through a small Cloudflare Worker: each match code gets its own Durable Object that relays the players' commands. Both players' browsers run the same deterministic simulation (lockstep), so the server never simulates anything and stays tiny.

## Playing on a phone

Andromedas plays in landscape on phones and tablets, and opens with the Noobscrub Games studio intro (tap to skip).

- **Tap** a unit to select it; double-tap to grab every unit of that type on screen. **Tap the ground**, an enemy or a site to send the selection there.
- **Drag** to pan, **pinch** to zoom, **twist** two fingers to turn. **Hold, then drag** to box-select.
- The left bar grabs whole groups: **Workers**, **Army**, **Survey** and **Idle** workers (tap twice to jump to them). Tap unit icons in the bottom panel to keep just a few of them.
- **Build** picks a worker and opens the build menu; tap the ground to move the building, then **Build here**. **Cancel** backs out of anything.

On a phone the game goes fullscreen when a match starts, and it can be added to the home screen as an app (`public/manifest.webmanifest`).

## Files

- `public/index.html`: the whole game.
- `src/worker.js`: the Worker. Serves `public/` and connects `/ws/<match>` to that match's Durable Object.
- `src/relay.js`: the match relay itself (about 40 lines, no game logic).
- `src/ranked.js`: ranked play: Elo maths, the matchmaking queue and match results, stored in the Ladder Durable Object's SQLite.
- `test/ranked.test.mjs`: tests for the ranked logic (`node --test test/*.test.mjs`, Node 22 or newer).
- `wrangler.toml`: Cloudflare config (static assets, the two Durable Object bindings and their migrations).

## Deploy on Cloudflare (free plan works)

1. On GitHub, create a new empty repository, for example `Dirzo/andromedas`.
2. Upload everything in this folder to the root of that repository (**Add file → Upload files**, drag in `public`, `src`, `wrangler.toml`, `README.md` and `.gitignore`, then commit). Keep the folder structure.
3. In the Cloudflare dashboard go to **Workers & Pages → Create → Workers → Import a repository** (it may say **Connect to Git**), and pick the repository.
4. Leave the build command empty and the deploy command as `npx wrangler deploy`. Click **Deploy**.
5. The game is live at `https://andromedas.<your-subdomain>.workers.dev`. Every push to the main branch redeploys it.

Note: this has to be a **Worker**, not a Pages project, because multiplayer needs the Durable Object.

## Ranked 1v1

On the home screen, tap **Ranked multiplayer**, pick a crew and a name, and tap **Find a ranked match**. The queue pairs you with someone close to your rating; the allowed gap starts at 100 points and widens by 20 a second while you wait. **Ladder** on the home screen shows the top 50.

- Everyone starts at 1200 Elo. The K-factor is 48 for your first 10 games, 32 after that, and 24 from 2000 up. Beating an equal opponent is worth about 16 points once you are placed.
- Tiers: Rock (under 1000), Copper, Iron (1200), Titanium (1400), Platinum (1600), Iridium (1800) and Andromeda (2000+).
- Both screens report the result. Ratings move when the reports agree, or when only one report arrives within two minutes (the other player closed the game). If the reports disagree, nothing changes.
- Surrendering, or leaving a match in progress, counts as a loss. If your opponent never connects, the match is called off with no rating change.
- There are no accounts: the browser keeps a random player id and secret. Clearing the site's data starts a fresh ladder profile.

## Playing friends with a code

Open the site, tap **Ranked multiplayer**, pick a crew, and click **Host a match** under *Play friends with a code*. Send the 4-letter code to up to three friends; they open the same site, pick a crew, type the code and click **Join**. Everyone picks Blue or Red: players on the same side share one base and army, and an empty side is played by the computer. The host clicks **Start match**.

No accounts are needed. Players should use the same browser engine if possible (Chrome or Edge on all machines), because the simulation must match bit for bit; the game warns you if the screens ever drift out of sync.

## Run it locally

With Node installed: `npx wrangler dev`, then open http://localhost:8787. Opening `public/index.html` straight from disk works for single player only.
