# Orona Multiplayer — Milestone 1: authoritative server + two-client sync

**Date:** 2026-06-13
**Result:** **SYNCS.** Two browser clients connect to one revived authoritative
Node server, both join the same Everard Island match, and **page B observes page
A's tank move in lockstep** when A drives input. M1's success bar is met.

All work lives in `~/workspace/_ports/orona/build/`. Nothing was committed; the
grown-workspace repo was not modified except for this report.

---

## TL;DR evidence

```
A joined: hasPlayer=true numTanks=1
B joined: hasPlayer=true numTanks=2
B sees tanks BEFORE: idx27 {x:27776, y:25728}   idx29 {x:44160, y:40064}
A sees tanks BEFORE: idx27 {x:27776, y:25728}   idx29 {x:44160, y:40064}   ← identical → one shared server state
  (A holds ArrowUp 1.5s; server moves A's tank; both clients get UPDATE frames)
B sees tanks AFTER:  idx27 {x:27776, y:26303}   idx29 {x:44160, y:40064}
>>> A's tank (idx 27) AS SEEN BY B moved: dx=0 dy=575 dist=575.0
>>> Both clients see >=2 tanks: true
=== RESULT: SYNCS ===
```

Server log during the run: `clients=2 tanks=2 objects=31`, cleanly returning to
`clients=0 tanks=0 objects=27` after both browsers closed. No server errors.

- Test harness: `~/workspace/_ports/orona/build/mp-sync-check.js`
- Screenshots: `~/workspace/_ports/orona/build/mp-pageA.png`,
  `~/workspace/_ports/orona/build/mp-pageB.png` (page B shows the networked Bolo
  client: Everard Island, HUD, "Joined as Bob (blue)").

---

## 1. What the server was (inventory)

Original launch path (Node 0.6 era):

- `bin/bolo-server` → `require('coffee-script'); require('../src/server/command').run()`.
- `src/server/command.coffee` — CLI: reads a `config.json`, calls
  `createBoloApp(config).listen(port)`, optionally wires IRC.
- `src/server/application.coffee` — the meat:
  - **`BoloServerWorld extends ServerWorld`** (villain) — the **authoritative game
    sim**: runs the shared `src/objects/**` + `src/map`/`src/world_map` simulation,
    serializes SYNC/CREATE/UPDATE/etc. frames per `src/net.coffee`, handles
    `onConnect`/`onMessage`/`onJoinMessage`. **This is the valuable part.**
  - **`Application`** — a `connect`-based HTTP server (static files + a
    `/match/<gid>` redirect) that owns a `MapIndex`, an IRC client list, a games
    map, the shared tick loop, and a `faye-websocket` upgrade handler. Lobby +
    matchmaking were all `FIXME` stubs even in 2012.
- `src/server/map_index.coffee` — filesystem map scanner.
- `src/server/irc.coffee` — IRC matchmaking bot (`irc-js`).

Dependencies (`package.json`, `"node": "0.6"`): `coffee-script@1`, `villain@0.2.0`,
`faye-websocket@0.4`, `connect@2`, `irc-js@2`, `browserify@1.10`.

Node-0.6-isms that break on modern Node:

| Issue | Where | Status for M1 |
|---|---|---|
| `require('sys')` (removed in Node) | `command.coffee` | sidestepped — M1 doesn't use `command.coffee` |
| `connect@2` HTTP/static middleware | `Application` | **replaced** with a 30-line `http` static server |
| `faye-websocket@0.4` transport | `Application`/`BoloServerWorld` | **replaced** with modern `ws@8` |
| `irc-js@2` matchmaking | `irc.coffee` | **dropped** (not needed for M1) |
| `connect` `'upgrade'` wiring (FIXME issue #61) | `Application#listen` | **dropped** — `ws` handles the upgrade |
| `new Buffer(...)` ctor (deprecated) | `application.coffee` ×8 | left as-is — still functional on Node 25 (warns only) |
| Bare `super` (CS1→CS2) | `BoloServerWorld` ctor + `tick` | already fixed in `build/patched` by the spike's sweep |
| **`this.onError` referenced but never defined** | `onSimpleMessage`/`onJsonMessage`/`onJoinMessage` | **fixed** — a latent crash bug in the *original* (see below) |

CoffeeScript itself compiles all of `src/server` cleanly under coffeescript 2.7
(the spike already proved the shared sim + villain compile).

---

## 2. The revival — exact fixes

The strategy was **keep the authoritative sim, throw away the dead HTTP/lobby/IRC
scaffolding.** The `connect`/`faye`/`irc` layer is fragile bitrot that M1 doesn't
need; the `BoloServerWorld` sim is the asset, and it runs unmodified on Node 25.

### a) Extract the sim into a standalone module
`build/patched/src/server/m1_server.coffee` is `BoloServerWorld` lifted verbatim
out of `application.coffee` (lines 31–276), with the `connect`/`faye`/`MapIndex`/
`irc`/`Application` imports and the whole `Application` class dropped. It keeps the
same `require`s for the shared sim (`villain/loop`, `villain/world/net/server`,
`villain/struct`, `../helpers`, `../world_mixin`, `../objects/all`, `../objects/tank`,
`../world_map`, `../net`, `../constants`) and exports
`{ BoloServerWorld, WorldMap, createLoop, TICK_LENGTH_MS, net }`.

Compiles with the same pipeline as the client:
```sh
npx --prefix build coffee --bare --compile --output build/compiled/src build/patched/src
```
`require('./compiled/src/server/m1_server.js')` loads with zero missing modules
(villain resolves from `build/compiled/node_modules`). Instantiating
`new BoloServerWorld(WorldMap.load(everardMapBytes))` yields a world with 27 map
objects that ticks cleanly. **The authoritative shared sim runs on modern Node
unchanged.**

### b) Fix the latent `onError` crash  ← the one real code bug
`onError(ws, err)` is *called* in `onSimpleMessage`, `onJsonMessage`, and
`onJoinMessage`, but is **defined nowhere** in Orona or villain. Any validation
failure (e.g. a duplicate join) hit `this.onError is not a function` and would
have crashed the Node-0.6 server too — it just rarely fired on the happy demo
path. M1 adds a safe implementation to `BoloServerWorld`: log the error, null the
tank, drop the client from `@clients`, close the socket — never kill the sim.

### c) Modern transport + static server (`build/m1-server.js`)
A ~150-line Node harness replacing the `Application` class:
- **`ws@8`** WebSocketServer attached to a Node `http` server.
- A tiny static file server rooted at the integrated game dir
  (`web/app/public/games/bolo`) so the client bundle, assets, and vendored jQuery
  are served from the **same origin** as the WebSocket. `/` and `/mp.html` serve
  the M1 multiplayer entry from `build/`.
- The authoritative tick loop via villain `createLoop({rate: 20ms})` (villain's
  loop already has a Node branch using `setTimeout`/`process.nextTick` — works
  as-is on Node 25).
- A single hard-coded demo game (`gid="demo"`), reachable at `ws://host/demo`,
  `ws://host/match/demo`, or `ws://host/match/<20-lowercase-letters>`.

### d) The `ws` dual-API gotcha (worth recording)
The sim expects a **faye-websocket-style** object: `ws.send(str)`,
`ws.onmessage = fn`, `ws.onclose = fn`, `ws.close()`, `ws.end()`. Modern `ws`
implements **both** the EventEmitter API *and* the W3C `.onmessage=` property API.
If you set `sock.onmessage` directly, `ws` *also* dispatches to it — so every
frame is processed **twice** (observed as spurious "join twice" errors and
duplicate/stale tanks). Fix: hand the sim a **plain adapter object** whose
`onmessage`/`onclose` are only ever invoked by our own `sock.on('message'|'close')`
handlers, fully decoupling the W3C interface from `ws`'s emitter. After this,
join→close correctly goes `tanks 0→1→0`.

### e) Client side: NO changes needed
The networked client (`BoloClientWorld`, `src/client/world/client.coffee`) works
**as-is** from the existing 221 KB bundle. The spike flagged the networked path's
`$(@ws).bind 'message.bolo'` / `ws.one 'open.bolo'` jQuery-WebSocket wrapping as
untested under jQuery 3 — **it works**: jQuery 3 attaches a native
`addEventListener('message'|'open'|'close')` on the WebSocket object, so native WS
events flow through `.bind`/`.one` exactly as in 2012. No `applicationCache` or
`.bind/.unbind` breakage surfaced on the live networked path. The only new file is
`build/mp.html`, a minimal entry that loads the same bundle WITHOUT `?local` (so
`index.coffee` exports the networked world) and auto-fills the join dialog from a
`#nick=…&team=…` URL hash.

---

## 3. Two-client sync — verification

`build/mp-sync-check.js` (Playwright/Chromium):
1. Opens page A at `/mp.html#nick=Alice&team=red`, waits for `world.player`.
2. Opens page B at `/mp.html#nick=Bob&team=blue`, waits for `world.player`.
3. Snapshots every tank's `{x,y}` as each page sees it (`world.tanks`).
4. Dispatches a real `ArrowUp` keydown in A (→ `client.handleKeydown` →
   `ws.send('A')` START_ACCELERATING), holds 1.5s, keyup.
5. Re-snapshots and diffs.

Outcome (see TL;DR): both pages list the **same two tanks at identical
coordinates** before input (proof of a single shared server state, not two
independent local sims), and A's tank moves **dy=575** as seen by **both** A and
B. **SYNCS.**

Run it:
```sh
cd ~/workspace/_ports/orona/build
node m1-server.js &              # listens on :6173
node mp-sync-check.js            # prints RESULT: SYNCS + writes mp-page{A,B}.png
```

---

## 4. Room / join protocol sketch (for a future grown integration)

The wire protocol already supports multi-room; only matchmaking was stubbed. The
minimal model a grown UI would drive:

**Room addressing — already in the protocol.** The WS resource path selects the
game: `ws://host/match/<gid>` where `<gid>` is 20 lowercase letters
(`getSocketPathHandler` / the client's `loaded()` regex `^\?([a-z]{20})$`). The
client derives its WS path from `location.search`: visiting `/mp.html?<gid>`
connects to `/match/<gid>`. So a **share link is just `…/play?<gid>`** — no new
protocol needed. (M1 hard-codes one `demo` game; productionizing = a `games` map
keyed by gid, as the original `Application.createGame` already did.)

**Join handshake — already implemented.** Per connection:
1. Client connects to `/match/<gid>`.
2. Server pushes: base64 **map dump** → **CREATE**(all objects)+**UPDATE** →
   JSON **nick** list → **SYNC**(`s`).
3. Client sends `{"command":"join","nick":<≤20 chars>,"team":0|1,"name":…}`.
4. Server spawns the tank, broadcasts CREATE + a `nick` message, and replies
   **WELCOME**(tank idx) to the joiner.
5. Steady state: client streams 1-char input bytes (`A`/`a`/`L`/`l`/…,
   `src/net.coffee`) + `''` heartbeats every 400ms; server broadcasts
   SYNC/UPDATE/TINY_UPDATE every tick (critical) / every other tick (full).

**Minimal grown protocol additions for share-link UX (none are wire changes):**
- A tiny **create-room** REST call → returns a fresh `gid` → share link
  `…/games/bolo/play?<gid>`. Reuse the `game-multiplayer.js` room/share pattern.
- Optional **roster/`gamefull`** affordance (the server already tracks
  `@clients`/`@tanks`; expose a count). Everything else (join, teams, chat via
  `msg`/`teamMsg`, leave-cleanup) is already wired in `BoloServerWorld`.

---

## 5. Hosting requirement — what deploying into grown takes

This is a **stateful, authoritative Node sim server**, not a static asset or a
stateless relay:

- **It runs the game.** A 20ms (50 Hz) tick loop advances the shared simulation
  and broadcasts deltas. CPU and memory scale with active games × objects. It
  **cannot** be a serverless/edge function or a CDN object — it's a long-lived
  process holding in-RAM game state.
- **Sticky, stateful WebSockets.** All players in a match must land on the **same
  process** that owns that game's state. In-cluster that means a Deployment +
  Service with **session affinity / consistent routing by `gid`** (or a single
  replica per match). A naive multi-replica load balancer will split a room across
  processes and break sync. The original `Application` already supported many games
  per process, so one pod can host many rooms; scaling out means routing a `gid`
  to its owning pod (hash-on-`gid` ingress, or a thin lobby that assigns rooms to
  pods).
- **Ingress must pass WebSocket upgrades** to the pod (and ideally terminate TLS →
  `wss://`). The client builds `ws://#{location.host}…`; behind HTTPS this must
  become `wss://` — a one-line client tweak (use `location.protocol`-derived
  scheme) when integrating.
- **No external deps to run:** just Node + `ws`. No DB, no IRC, no Redis for the
  MVP (room→pod mapping can start in-memory in a single pod). Persistence/
  reconnection/lobby are future concerns.
- **Asset/IP + license unchanged:** GPL v2; all graphics/sounds are © 1993 Stuart
  Cheshire — fine for a private instance, **blocks any public deploy** until art
  is cleared/replaced (same as the single-player integration's NOTICE).

So: package `build/compiled` + `build/m1-server.js` + `ws` into a small Node image,
serve the existing `/games/bolo` assets (or let grown's web tier serve them and
point the client's WS at the sim service), expose a WS-upgrade ingress with
gid-sticky routing, and switch `ws://`→`wss://` on the client.

---

## 6. Honest remaining work to shippable in-app multiplayer

M1 proves the hard part (revived authoritative server + verified cross-client
sync). To ship real in-app multiplayer:

1. **Client WS URL is hard-wired to `location.host` + `ws://`.** Integration needs
   (a) `wss://` when the page is HTTPS, and (b) pointing at the sim service's host
   if it's a separate origin from the asset host (CORS/origin + the URL build in
   `client.coffee#loaded`). Small, but required.
2. **Room lifecycle:** create-room endpoint → gid, share-link UI (reuse
   `game-multiplayer.js`), room TTL / empty-room GC (the M1 server keeps the demo
   game forever), max-games / room-full handling (the original had
   `haveOpenSlots`/`maxgames` — re-add).
3. **Join UX for grown:** replace Orona's jQuery-UI join dialog (or pre-fill it)
   with grown's own nick/team picker; carry the player's grown identity.
4. **Reconnect & resilience:** today a dropped socket = lost tank, no rejoin/state
   resume. Heartbeat timeout handling exists; reconnection does not.
5. **Hosting:** the Deployment + gid-sticky WS ingress described in §5; pick
   single-replica-per-room vs hash-routing.
6. **Cheat/validation hardening:** the server already validates build orders and
   command bytes and now has a real `onError`; review the remaining
   spectator/`team` edge cases before exposing publicly.
7. **Asset/IP clearance** before any non-private deploy (GPL v2 + © 1993 Cheshire
   art/audio).
8. **Map selection / game modes:** M1 hard-codes Everard Island; the BMAP parser
   and `MapIndex` already exist to generalize.

Rough estimate to a private, in-cluster, share-a-link multiplayer Bolo: the
server is **done** for M1; the remaining is **client WS-URL/scheme tweak + a
room/create/share UI + a Node Deployment with sticky WS ingress** — on the order
of a few days of integration, not a research effort. Public launch additionally
needs asset clearance.

---

## Appendix — files & reproduce

In `~/workspace/_ports/orona/build/`:
- `patched/src/server/m1_server.coffee` — standalone authoritative sim (extracted
  `BoloServerWorld` + the new `onError`).
- `compiled/src/server/m1_server.js` — compiled output.
- `m1-server.js` — modern Node harness (`ws` transport + http static + tick loop).
- `mp.html` — multiplayer client entry (no `?local`; auto-join via `#nick=…&team=…`).
- `mp-sync-check.js` — two-client Playwright sync test.
- `ws-probe.js` / `probe2.js` — raw-protocol probes (no browser).
- `mp-pageA.png` / `mp-pageB.png` — proof screenshots.

```sh
cd ~/workspace/_ports/orona
# (re)compile the server sim:
npx --prefix build coffee --bare --compile --output build/compiled/src build/patched/src
cd build && npm install ws@8       # one-time
# run:
node m1-server.js &                # http+ws on :6173, serves /mp.html
node mp-sync-check.js              # → RESULT: SYNCS, writes mp-page{A,B}.png
# or open two browser tabs at  http://localhost:6173/mp.html  and play.
```
