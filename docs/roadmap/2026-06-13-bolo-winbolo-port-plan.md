# Bolo (WinBolo) → browser WASM port — plan

## The source situation (important)
- `github.com/natdudley/Bolo` is **not source** — it's a MAME/MESS emulator
  bundle of the **1982 Apple II** Bolo (a different, single-player game). Nothing
  to port.
- The macintoshgarden Bolo is **Stuart Cheshire's** 1987/1993 networked Mac tank
  game — its original source was kept **closed** (anti-cheat). Not portable.
- **WinBolo** (John Morrison) is an **open-source, GPL** faithful reimplementation
  of Cheshire's Bolo, *with the networking*. This is the only legitimate base.
  Cloned to `~/workspace/_ports/winbolo` (`github.com/kippandrew/WinBolo`, GPL).

## Scope reality
This is **not "just the networking."** It's a full port of a ~200-file C game.
Comparable to (and harder than) the Mighty Mike port, because Bolo is inherently
networked real-time multiplayer. Realistically a dedicated multi-session effort,
not a one-shot.

## Port architecture (mirrors the Mighty Mike approach)
1. **Build target:** the existing `winbolo/src/gui/linux` (SDL) build is the WASM
   target. Compile with **Emscripten** (SDL2, single-threaded, ASYNCIFY for the
   game loop), `--preload-file` for assets (sounds/, brains/, tiles), GLRENDER
   off (SDL 2D renderer). Use the `disable-rsa-check` branch (or disable the RSA
   key check) so a self-hosted build can run without the original key server.
2. **Networking — the real work.** WinBolo's transport is native UDP
   (`winbolo/src/winbolonet` + `src/server`). Browsers can't do raw UDP, so
   replace the transport with **WebSocket → the gamerooms relay** we already
   built (`/api/v1/gamerooms/ws`). Two options:
   - thin shim: reimplement WinBolo's packet send/recv over a WS to a room, with
     the grown `gamerooms` hub relaying datagrams between players; or
   - run a headless WinBolo **server** in-cluster (the `src/server` Makefile
     builds it) and have browser clients connect to it via a WS↔UDP bridge.
   The room/join/password layer (and share link) reuses `game-multiplayer.js`.
3. **Serving:** same as Mighty Mike — `web/app/public/games/bolo/` with a
   `play.html` shell + `Bolo.js/.wasm/.data`, a touch control overlay
   (`gamepad-overlay.js`), and a PWA manifest. Tag it Port + Multiplayer.

## Status
Source identified + cloned + license verified (GPL). Build/port not started —
this is the next dedicated game-port effort. GPL compliance: keep the port's
source available and preserve `gnu.txt`/attribution if we ship it.
