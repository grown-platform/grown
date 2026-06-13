# Bolo → browser WASM port — source assessment & plan

We want a browser-playable, multiplayer Bolo wired into the grown gamerooms
relay. Four candidate sources were investigated. Summary up front:

| Source | What it is | Source available? | License | WASM-portable? |
|---|---|---|---|---|
| **WinBolo** (kippandrew) | Full reimpl of Cheshire's Bolo, *with networking* | ✅ full C | GPL v2 | ⚠️ yes, but heavy lift |
| **XBolo** (xbolo.org) | Cocoa reimpl, the game itself | ❌ binary only | closed | no |
| **XBolo Map Editor** (zirman/magma) | Just the *map editor* | ✅ ObjC | MIT (graphics © Cheshire) | n/a — not the game |
| **NuBolo** (nubolo.net) | Mac reimpl | ❌ **PPC binary only** | closed | no |
| **Original Bolo** (Cheshire '93) | The original Mac game | ❌ proprietary | closed | only via emulator |

## What each one actually is (verified)

- **NuBolo** (`nubolo_1p0b9a.dmg`, downloaded): the .app contains only a
  **PowerPC Mach-O binary** (`file` → "Mach-O executable ppc", 443 KB, 2007) and
  resources. No source ships in the dmg. A compiled PPC binary can't be ported —
  it could only be *run* under a PPC emulator (SheepShaver). Dead end for a port.
- **XBolo / magma** (`github.com/zirman/magma`): cloned — it is the **XBolo Map
  Editor only**, not the game. Its own README points at `xbolo.org` for the game,
  which is a **closed binary**. Its graphics/sounds are "captured from the
  original Bolo © 1993 Stuart Cheshire" — so even the editor's assets are
  IP-encumbered. Not a game source.
- **Original Bolo**: Cheshire kept the source **closed** (anti-cheat). The only
  way to run *the original* is a classic-Mac emulator (Mini vMac / Basilisk II /
  SheepShaver) booting the real game, and its multiplayer is **AppleTalk** — you'd
  need an AppleTalk-over-our-relay bridge. See "Emulator path" below.
- **WinBolo** (`github.com/kippandrew/WinBolo`, cloned to `~/workspace/_ports/winbolo`):
  the **only complete, open, buildable game** — full C, GPL v2, includes the
  game logic, the `src/server`, and `src/winbolonet` networking. This is the base.

## WinBolo WASM port — the real scope (why it's multi-session)

The Linux GUI (`winbolo/src/gui/linux`) is the closest-to-portable frontend, but
its Makefile shows two hard blockers for Emscripten:

1. **GTK** — dialogs (game setup, finder, key setup, tracker, alliance, etc.) are
   GTK (`gtk-config`; 22 of the .c files pull in GTK/GDK). GTK does **not** compile
   to WASM. The entire dialog layer must be **deleted and replaced** with an
   HTML/JS overlay UI (which actually fits grown better — reuse `game-multiplayer.js`
   for room/join/password, and an HTML control panel for game setup).
2. **SDL1** — it targets SDL1 (`sdl-config`, `SDL/SDL.h`). Must be migrated to
   **SDL2** (Emscripten ships SDL2). Mostly mechanical (cursor/surface/event API
   renames) but touches the whole render/input path.
3. **Networking** — transport is native **UDP** (`winbolonet` + `server`).
   Browsers can't do UDP. Replace the transport with **WebSocket → the gamerooms
   relay** (`/api/v1/gamerooms/ws`). Two shapes: (a) a thin packet shim that
   tunnels WinBolo datagrams through a WS room; or (b) a headless WinBolo `server`
   in-cluster with a WS↔UDP bridge in front. (a) is simpler and serverless.

`emsdk` is already on disk (`~/workspace/_ports/emsdk`, from the Mighty Mike port),
so the toolchain is ready. The work is the three rewrites above, in order:
SDL1→SDL2 compile-clean → strip GTK / stub dialogs → UDP→WS transport →
`--preload-file` assets → touch overlay (`gamepad-overlay.js`) → serve at
`web/app/public/games/bolo/`.

This is a **dedicated multi-session game port**, comparable to (and harder than)
Mighty Mike — Bolo is inherently networked real-time, and the GUI rewrite is real.
It is honestly *not* "just get the networking working."

## Emulator path (for the *original*, optional/experimental)

To play Cheshire's actual 1993 Bolo: run it in a WASM classic-Mac emulator
(Infinite Mac / Basilisk II-wasm) and bridge its **AppleTalk** networking to the
relay. This means implementing an AppleTalk (DDP/ATP) ⇄ WebSocket shim and feeding
it into the emulator's network layer. High effort, IP-gray (shipping the original
ROM + game), and fragile. Worth a spike only after WinBolo works — same relay can
back both. Documented so we don't lose the idea; not recommended as the first build.

## Recommendation
Build **WinBolo → WASM** as the canonical browser Bolo (GPL, complete, our relay
fits its networking model). Treat NuBolo/XBolo-game as un-portable (closed
binaries) and the original-via-emulator as a later experimental spike. GPL
compliance: keep the port's source available and preserve `gnu.txt`/attribution.
