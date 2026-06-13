# WinBolo → WASM — Milestone 1 status (2026-06-13)

**M1 = LINKS, render path wired, not yet visually verified.**

The full single-player WinBolo build links as wasm under SDL2 + the emscripten
main loop. Build is reproducible via `~/workspace/_ports/winbolo/build-emscripten.sh`
(idempotent; `clean` wipes). Artifacts: `Bolo.wasm` (1.9 MB), `Bolo.js`, `Bolo.html`,
`Bolo.data`. Node smoke-test: module instantiates, loads the asset package, runs
`main()`, reaches SDL2 window creation (fails only at `emscripten_get_screen_size`
— node has no browser `screen`; the expected headless ceiling). No missing-symbol /
abort / LinkError.

**How:** SDL1→SDL2 via a force-included compat shim (`gui/emscripten/sdl1compat.h`
+ `sdl2_video.c`) mapping the removed APIs onto one window+renderer+streaming
texture (so the ~27 `SDL_UpdateRect(s)` sites needed no hand-edits). `main_em.c`
boots `netSetup(netSingle)` → `screenLoadMap("/e.map")` → `screenNetSetupTankGo()`,
skipping dialogs. Stubbed: GTK/GDK/X11, UDP/net, sound, WinBolo.net+RSA, AI brains.

**Open risks for M2:**
1. No browser-rendered frame confirmed yet (no GUI in the build env).
2. The Linux source's single-player was itself unfinished
   (`screenLoadCompressedMap()` is a `return FALSE` stub; the `inStart`
   "downloading" gate isn't cleared on the netSingle path). Worked around with the
   real file-based `screenLoadMap` + a `screenSetInStart` helper, but whether the
   netSingle client simulation fully advances client-side is unverified.

**M2:** Playwright-verify `Bolo.html` paints a frame; if blank, fix the netSingle
sim-advance. **M3:** multiplayer — replace the stubbed UDP with a WebSocket shim
into the gamerooms relay (`netClientUdpCheck()` hook). Then integrate at
`/games/winbolo/`. See `2026-06-13-winbolo-emscripten-spike.md`.
