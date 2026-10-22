# Andromedas

A real-time strategy game on a small spherical asteroid with a diggable, layered crust. Four races (Humans, Space Fowl, Cephalopods and the Vessk), buried deposits to survey and mine, three path cards that decide your specialist, tech building and mega unit, and co-op or versus multiplayer for up to four players.

The game is a single page (`public/index.html`, built with three.js from a CDN). Multiplayer runs through a small Cloudflare Worker: each match code gets its own Durable Object that relays the players' commands. Both players' browsers run the same deterministic simulation (lockstep), so the server never simulates anything and stays tiny.

## Playing on a phone

Andromedas plays in landscape on phones and tablets, and opens with the Noobscrub Games studio intro (tap to skip).

- **Tap** a unit to select it; double-tap to grab every unit of that type on screen. **Tap the ground**, an enemy or a site to send the selection there.
- **Drag** to pan, **pinch** to zoom, **twist** two fingers to turn. **Hold, then drag** to box-select.
- The left bar grabs whole groups: **Workers**, **Army**, **Survey** and **Idle** workers (tap twice to jump to them). Tap unit icons in the bottom panel to keep just a few of them.
- **Build** picks a worker and opens the build menu; tap the ground to move the building, then **Build here**. **Cancel** backs out of anything.

- The numbered **squad** buttons on the right: hold one to save the selection as that squad, tap to select it, tap again to jump to it.
- The **production tray** above the command card shows every building that trains or researches, with its progress. Tap one to select it, tap again to jump to it.

On a phone the game goes fullscreen when a match starts, and it can be added to the home screen as an app (`public/manifest.webmanifest`). On iPhone and iPad, use Safari's **Share → Add to Home Screen**; Settings shows the same hint.

## Match options

- **Classic** is the full game: level every enemy structure. **Rapid** is about 10 minutes: closer sites, a faster freighter and faster building, and the enemy command hub is the target. When the clock runs out, a side that leads clearly on kills (by cost) wins; otherwise it is sudden death, where the next structure to fall decides it, and after four more minutes the side with more structure left standing wins. Ranked matches are Rapid.
- **Asteroids:** Standard, Ice field (cryo pockets everywhere), Deep core (seams and impact cores), Rich crust (metals near the surface) and Rough (twice the craters and spires). The rock is the same size on all of them.
- **Opponent:** Easy, Normal, Hard (faster, bigger attacks, uses its powers and mega abilities) and Brutal (Hard, and its crews haul 30% more).
- **Neutral objectives:** two relay beacons sit halfway between the bases. Hold one with combat units for 8 seconds to own it: you see around it and the freighter pays 10% more for each one you hold. Four wrecks pay gold, ore and titanium to the first unit that stands by one, alone, for 8 seconds.
- **Mega abilities** (F): each of the nine mega units has one active ability, such as War cry, Shield dome or Carpet bomb. **Space Command powers** live on the command hub: Orbital strike (Z), Seismic charge (X) and Priority freight (C).
- **Veterancy:** combat units are promoted at 3, 7 and 15 kills (Veteran, Elite, Hero), each rank adding 10% health and 5% damage. **Patrol** (Q) walks a unit back and forth, fighting on the way.

## Replays, missions and your profile

- Every match is saved on the device as a replay (the seed, the settings and every command; the simulation is deterministic, so it plays back exactly). **Replays** on the home screen lists the last 15: watch one with the fog lifted, at up to 8x, seek, switch sides, or copy its code to share. Ranked replays are uploaded, and the best ones this season are listed under **Top ladder games**.
- The end screen has army and income graphs, **Rematch** (single player and missions) and **Watch replay**.
- **Missions:** six short challenges on fixed asteroids, each worth up to three stars.
- **Profile:** levels from experience, three daily quests (new each day at midnight UTC), and unlockable selection-ring colours and titles. It lives on the device. Matches where the playtest tools were used do not count.
- **Friends:** add a friend by their ladder name and invite them; the match code waits in their inbox for half an hour.
- **Online matches:** emotes (Say…) and map pings for your teammates (Ping, or G). If your connection drops, the match waits up to 60 seconds; reopen the game and tap **Rejoin** on the home screen, and it catches up from the server's copy of the match.

## Settings

Graphics, music, the studio intro, a colour-blind safe palette (blue against amber), interface size, a left-handed layout (minimap and command card swap sides), vibration on phones, and a 30 fps battery saver.

## Files

- `public/index.html`: the whole game.
- `src/worker.js`: the Worker. Serves `public/` and connects `/ws/<match>` to that match's Durable Object.
- `src/relay.js`: the match relay itself (no game logic). It also keeps each running match's command log, so a player who drops can rejoin and catch up.
- `src/ranked.js`: ranked play: Elo maths, the matchmaking queue and match results, stored in the Ladder Durable Object's SQLite.
- `test/ranked.test.mjs`, `test/relay.test.mjs`: tests for the ranked logic, seasons, replays, invites and the relay (`node --test test/*.test.mjs`, Node 22 or newer).
- `android/`: the Android app (see below). `.github/workflows/android.yml` builds it.
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
- **Seasons** last four weeks, counted from 1 October 2026. At the start of a season ratings move halfway back to 1200 and records start over; your best tier from the last season stays as a badge. Each season has its own pool of three asteroids.
- The ladder can be filtered by crew: it then lists players who played that crew this season, with their record on it.

## Android app

`android/` is the Android app: a Trusted Web Activity that opens the live site full screen, landscape, with no browser bar. Website deploys update the app too, with no new store release.

**Ladder position.** The app runs inside the phone's Chrome, so it shares Chrome's storage for the site: if you already play ranked in Chrome on that phone, the app keeps your rating and name. To move a profile anywhere else (another phone, a computer, a different browser), open **Settings → Ladder profile**, tap **Copy my code** and use it on the other device. Using a code replaces that device's own profile.

**Build it.** GitHub Actions builds it on every change to `android/` (**Actions → Android app**, artifact `andromedas-android`).

1. Set the repository variable `ANDROID_HOST` to the site address (for example `andromedas.<your-subdomain>.workers.dev`), or type it when you run the workflow by hand. The debug APK can be sideloaded straight away.
2. For Google Play, make an upload key once (`keytool -genkeypair -v -keystore upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000`) and add the secrets `ANDROID_KEYSTORE_BASE64` (`base64 -w0 upload.jks`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`. The workflow then also builds the signed `.aab` to upload to the Play Console.
3. Put the signing fingerprints in `wrangler.toml` as `ANDROID_CERT_SHA256` (comma-separated): the Play Console's **App signing key** SHA-256 (Setup → App integrity), plus your upload key's, which the workflow prints. Deploy, and the site serves them at `/.well-known/assetlinks.json`. Until that matches, Android shows a small address bar above the game.

## Playing friends with a code

Open the site, tap **Ranked multiplayer**, pick a crew, and click **Host a match** under *Play friends with a code*. Send the 4-letter code to up to three friends; they open the same site, pick a crew, type the code and click **Join**. Everyone picks Blue or Red: players on the same side share one base and army, and an empty side is played by the computer. The host clicks **Start match**.

No accounts are needed. Players should use the same browser engine if possible (Chrome or Edge on all machines), because the simulation must match bit for bit; the game warns you if the screens ever drift out of sync.

## Run it locally

With Node installed: `npx wrangler dev`, then open http://localhost:8787. Opening `public/index.html` straight from disk works for single player only.
