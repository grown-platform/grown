# Orona Revival Spike — browser-native Bolo, modern toolchain

**Date:** 2026-06-13
**Scope:** Bounded feasibility spike. Goal was *not* a polished integration, but
to answer one question: **can Orona's CLIENT render a playable single-player
Bolo in a modern browser without reviving the ancient Node 0.6 server?**

**Verdict (TL;DR):** **YES — and it already does.** With a modern toolchain
(CoffeeScript 2.7 + esbuild) and a handful of mechanical CS1→CS2 / jQuery-3
fixes, the original Orona client **compiles, bundles, loads its assets, renders
the Everard Island map + tank + HUD to canvas, runs its simulation loop, and
responds to keyboard input** (verified headless: pressing accelerate moves the
tank). This is dramatically less work than the WinBolo WASM port. Total spike
effort to get to a rendering, input-responsive single-player game: ~2 hours.

All build artifacts live in `~/workspace/_ports/orona`. Nothing was committed.

---

## 1. What Orona is (tech inventory)

- **Repo:** `github.com/stephank/orona`, cloned to `~/workspace/_ports/orona`.
  Last commit `8ec9ea3` (2012-04-29). Archived/alpha. One git submodule:
  **`villain`** (`github.com/stephank/villain`, the author's own game/netcode
  micro-framework) checked out at `node_modules/villain`.
- **Language:** 100% CoffeeScript. 38 `.coffee` files in `src/` + 11 in
  `villain`. No hand-written JS except `js/jquery.cookie.js`.
- **Source layout** (clean client / server / shared split):
  - `src/client/**` — browser client: world bootstrap, renderers
    (`renderer/{base,common_2d,direct_2d,offscreen_2d,webgl}.coffee`), soundkit,
    progress, vignette, base64, and the embedded Everard Island map
    (`src/client/everard.coffee`, a base64 BMAP string).
  - `src/objects/**`, `src/map.coffee`, `src/world_*.coffee`, `src/constants.coffee`,
    `src/net.coffee`, `src/struct.coffee`, `src/helpers.coffee` — **shared game
    sim** used by both client and server.
  - `src/server/**` — Node 0.6 server (connect, faye-websocket, irc-js). **Not
    needed and not touched** for this spike.
  - `node_modules/villain/**` — shared base classes: `world/base`,
    `world/object`, `world/net/{local,client,server,object}`, `loop`, `struct`.
- **Original build:** a `Cakefile` (CoffeeScript's `cake`) with one real task,
  `build:jsbundle`, that runs **browserify 1.10** over `src/client` to produce
  `js/bolo-bundle.js`. `index.html` loads jQuery 1.6 + jQuery UI 1.8 from the
  Google CDN, then the bundle, then `new (require('./src/client'))().start()`.
- **Default renderer:** `offscreen_2d` (Canvas 2D with cached map segments).
  A WebGL renderer also exists but is not the default. No exotic browser APIs.
- **Entry / mode select** (`src/client/index.coffee`): exports
  `BoloLocalWorld` when the URL is `?local` (or host is `*.github.*`), else the
  networked `BoloClientWorld`. **`?local` is the single-player path** — exactly
  what we want, no server.

### Node-only API usage in the client graph

Grepped the entire client+shared import graph: the **only** Node builtin
reachable from the client entry is `events` (`EventEmitter`), used by
`src/client/progress.coffee` and `villain/world/object.coffee`. esbuild
auto-shims this with the npm `events` polyfill. `fs`/`path` appear **only** in
`src/server/**`, which is never imported by the client. So the client is
genuinely browser-pure.

---

## 2. License / asset / IP notes  ⚠️

- **Code:** GPL v2 (inherited from WinBolo — the game logic was written with
  WinBolo as reference, making it a derived work). `villain` is the author's,
  same project. Bundled libs (jQuery/jQuery UI/Sizzle/cookie plugin) are MIT/GPL.
  GPL v2 is a real consideration if we integrate into grown-workspace.
- **Assets are IP-encumbered.** All graphics (`images/base.png`, `styled.png`,
  `overlay.png`, `hud.png`) and all sounds (`sounds/*.ogg`) are **"from Bolo,
  © 1993 Stuart Cheshire"** — the original proprietary Bolo art/audio, same
  encumbrance flagged in the WinBolo port plan. **They ship in the Orona repo**
  (no separate asset pack needed; loaded at runtime as `images/{base,styled,
  overlay}.png` and `sounds/{name}.ogg`). Fine for a local spike; **a public
  deploy needs original/cleared art**, identical to the WinBolo situation.
- **Map:** Everard Island is embedded base64 in `src/client/everard.coffee`
  (also `maps/Everard Island.map`), decoded by the shared BMAP parser.

---

## 3. How far the client build got — **fully rendering + input-responsive**

Modern toolchain used (installed under `~/workspace/_ports/orona/build`):
`node v25.6.1`, `coffeescript 2.7.0`, `esbuild 0.28.1`, `playwright 1.57` (for
headless verification). The original `cake`/browserify path was **bypassed**:
compile `.coffee → .js` with modern CoffeeScript, then bundle the CommonJS JS
with esbuild into an IIFE.

Pipeline (reproducible):
1. Patched sources copied to `build/patched/` (originals untouched apart from
   the fixes below).
2. `coffee --bare --compile` → `build/compiled/` (48/48 files compile).
3. `esbuild compiled/src/client/index.js --bundle --platform=browser
   --format=iife --global-name=BoloClient` → `js/bolo-bundle.js` (221 KB, zero
   unresolved imports; `villain/*` resolved from `compiled/node_modules`,
   `events` shimmed, server `fs`/`path` never pulled in).
4. `index-local.html` (new file, original `index.html` untouched) loads
   jQuery 3.7.1 + jQuery UI 1.13.2 + the bundle and starts the world.

**Headless verification** (`build/render-check.js` + `build/input-check.js`,
Playwright/Chromium, serving the dir and loading `index-local.html?local`):

```
started: true,  hasWorld: true,  hasMap: true,  hasPlayer: true,
hasRenderer: true,  loopRunning: true,  canvases: 1 (1000x700),
nonBlankPixels: 532912 / 700000   (map+tank+HUD actually drawn)
```

Input test — focus dummy input, hold ArrowUp 1.2 s:
```
BEFORE {x:19584, y:31872, speed:0}
AFTER  {x:20154, y:31872, speed:15}   → tank accelerated and moved 570 units
```

Screenshot (`~/workspace/_ports/orona/build/render.png`) shows the real Bolo
client: Everard Island (water/forest/road/swamp/buildings/pillboxes), the
player's red tank on a boat, the tool-select HUD, tank-status + pillbox/base
HUD panels, and the crosshair. **It is a playable single-player Bolo in
Chromium.**

---

## 4. Concrete blockers hit (all fixed; all mechanical)

The blockers were exactly the expected bitrot from a 2012 CoffeeScript-1 /
jQuery-1.6 codebase. None were architectural. In order encountered:

| # | Blocker | Files | Fix |
|---|---------|-------|-----|
| 1 | **Bare `super`** ("unexpected newline"). CS1 forwarded all args on bare `super`; CS2 forbids it. | 16 files (10 client/shared) | `super` → `super arguments...` (perl sweep). |
| 2 | **`@param` / `this` before `super`** in derived ctors. CS2 enforces ES6 ordering. | `villain/world/object`, `objects/{tank,builder,shell,world_base,world_pillbox}`, `client/progress` | Call `super(...)` first, assign `@x = x` after; convert `(@world)` params to `(world)`. |
| 3 | **Param-assign-before-super *semantic* regression** (the one that actually bites at runtime). CS1 assigned `@x,@y` *before* `super`; CS2 assigns *after*. `MapObject`'s base ctor reads `@map.cells[@y][@x]` → `cells[undefined][undefined]` crash. | `src/map.coffee` (`MapObject`/`Start`/`Pillbox`/`Base`) | Move `x,y` into the base `MapObject(@map,@x,@y)` ctor; subclasses `super(map,x,y)` first. |
| 4 | **jQuery 3 removed `.load(fn)`** event shorthand (now it's AJAX `.load(url)` → `e.indexOf` crash on image load). | `client/world/mixin.coffee` | `$(img).load(cb)` → `$(img).on('load', cb)`. |
| 5 | **jQuery UI 1.13 hijacks the `autocomplete` prop** in `$('<input/>', {autocomplete:'off'})` → "cannot call methods on autocomplete prior to initialization". | `client/world/mixin.coffee` | Set it via `.attr('autocomplete','off')` instead. |

Notes:
- The `applicationCache` / `.bind`/`.unbind` calls that *would* break under
  jQuery 3 are all in the **dead networked path** (`client/world/client.coffee`)
  or behind the `applicationCache` early-return — they never execute in
  single-player, so they didn't need fixing for this spike (they would for a
  full networked revival).
- `esbuild` replaced browserify cleanly; CommonJS `require` graph just works.
- **No sim logic, no renderer logic, no asset, and no module-system rewrite was
  needed.** Every fix is a syntax/jQuery-API adaptation.

---

## 5. Networking model — where a WebSocket shim attaches

The networked client lives in **`src/client/world/client.coffee`**
(`BoloClientWorld extends villain ClientWorld`). The single attach point:

- **`BoloClientWorld#loaded` — `src/client/world/client.coffee:60`:**
  `@ws = new WebSocket("ws://#{location.host}#{path}")`. This is the one line a
  future relay shim replaces (swap the URL/transport for our
  `/api/v1/gamerooms/ws` relay, or inject a fake `@ws` object).
- **Outbound (client→server):** all sends go through `@ws.send(...)` in the same
  file — input as 1-char ASCII codes from `src/net.coffee`
  (`START_TURNING_CCW='L'`, `START_ACCELERATING='A'`, etc.) at lines ~212–227,
  build orders at `:240`, join JSON at `:124`, heartbeat `''` at `:147`.
- **Inbound (server→client):** `$(@ws).bind 'message.bolo', handler`
  (`:78`) dispatches binary base64 frames by leading byte
  (`SYNC/WELCOME/CREATE/DESTROY/MAPCHANGE/UPDATE/SOUNDEFFECT`, see
  `src/net.coffee`).
- **Protocol is well-defined and small** (`src/net.coffee` is the shared
  contract). The *original* matchmaking is IRC-based and server-side; a relay
  shim ignores all of that and just needs to (a) feed the client SYNC/UPDATE
  frames and (b) forward the 1-char input bytes. **But note:** reviving
  *networked multiplayer* still requires a server that runs the **shared sim**
  authoritatively — that's the Node 0.6 `src/server/**` code (or a reimpl of it
  on top of the shared `src/objects`/`src/map` sim). That is a separate, larger
  effort and was explicitly out of scope here.

---

## 6. Effort estimate — Orona single-player vs WinBolo WASM

**To a polished, browser-playable single-player Orona we control:**
- **~0.5–1 day.** The hard part (compile+render+input) is already done in this
  spike. Remaining: fold the ~6 fixes into a small repeatable build script,
  swap CDN jQuery for vendored/pinned copies (offline), wire a clean
  `index.html` + mode UI, add map selection (the BMAP parser already exists),
  smoke-test across browsers, and tidy the GPL/asset story. It is JS/CoffeeScript
  glue, not systems work.

**To a polished single-player WinBolo WASM build** (per
`2026-06-13-winbolo-emscripten-spike.md`): the core compiles, but you must
**rewrite the SDL1 render/input/sound layer to SDL2/Emscripten** (`draw.c` is
large), replace GTK dialog chrome with HTML/DOM, and build the
emscripten/asset/main-loop scaffold. That spike honestly scoped it as a
**multi-session effort** (several days+), even before networking.

**Multiplayer (either path)** is the real, separate cost — for Orona it means
running the shared sim authoritatively on our backend and bridging to our relay;
for WinBolo it means replacing native UDP with a WebSocket shim *and* the
SDL/GTK rewrite first.

| | Orona (CoffeeScript→JS) | WinBolo (C→WASM) |
|---|---|---|
| Single-player in browser, *today* | **Done in this spike** (renders + input) | Core compiles only; no frame drawn |
| Remaining to polished SP | ~0.5–1 day, JS glue | Multi-day SDL2/DOM rewrite |
| Renderer | Canvas 2D, **already working** | Must port SDL1→SDL2 (`draw.c`) |
| Language familiarity | JS-adjacent (CoffeeScript) | C + Emscripten toolchain |
| Assets/IP | Same © 1993 Cheshire encumbrance | Same encumbrance |
| License | GPL v2 | GPL v2 |
| Multiplayer to our relay | Needs server-side shared sim + WS shim (`client.coffee:60`) | Needs UDP→WS shim + the SDL/GTK rewrite first |
| Code maturity / completeness | "alpha", but sim+render proven working | Full, mature game incl. server |

---

## 7. Recommendation

**For a browser-playable *single-player* Bolo: revive Orona.** This spike took
it from "archived 2012 CoffeeScript" to "renders Everard Island and drives a
tank in headless Chromium" in ~2 hours, with only mechanical fixes. It is by a
wide margin the fastest route to a playable canvas in our gamerooms, and it's
already JS-stack-native.

**Caveats that temper a full "switch to Orona" call:**
- **Multiplayer is not free on either path.** Orona's networked mode needs an
  authoritative server running the shared sim (the abandoned Node 0.6 server, or
  a reimpl). If the product goal is *networked* Bolo on our relay, WinBolo (which
  ships a complete, battle-tested server and net protocol) may still be the
  better long-term base despite the heavier client port.
- **IP/asset encumbrance is identical** for both and blocks any public deploy
  until art/audio is cleared or replaced.
- **GPL v2** applies to both.

**Suggested plan:** Use **Orona for a single-player MVP now** (cheap, proven by
this spike) to get Bolo visibly running in gamerooms. Keep the **WinBolo WASM
port as the candidate for networked multiplayer** if/when that's prioritized.
Re-clearing assets is a prerequisite for shipping either publicly.

---

## Appendix — reproduce

```sh
cd ~/workspace/_ports/orona
# build (patched sources already in build/patched):
npx --prefix build coffee --bare --compile --output build/compiled/src build/patched/src
npx --prefix build coffee --bare --compile --output build/compiled/node_modules/villain build/patched/node_modules/villain
cd build && npx esbuild compiled/src/client/index.js --bundle --platform=browser \
  --format=iife --global-name=BoloClient --outfile=../js/bolo-bundle.js
# verify headless (renders + screenshot to build/render.png):
node render-check.js
node input-check.js
# or open in a browser:  serve the orona dir and visit  index-local.html?local
```

Artifacts: `build/patched/` (fixed sources), `build/compiled/` (JS),
`js/bolo-bundle.js` (bundle), `index-local.html` (entry),
`build/render.png` (proof screenshot), `build/{render,input}-check.js` (tests).
