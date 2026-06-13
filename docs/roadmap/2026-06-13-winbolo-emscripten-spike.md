# WinBolo → Emscripten/WASM Feasibility Spike

**Date:** 2026-06-13
**Scope:** Bounded feasibility spike. Goal was *not* a playable build, but to
measure how far the portable core compiles under Emscripten and to leave a
reusable build scaffold + an honest effort estimate.

**Verdict (TL;DR):** A single-player WASM port is **feasible and worth
pursuing**. The game *core* is clean, portable C and already compiles to wasm
objects almost in its entirety (43/44 core files, plus both LZW files) with one
small compat shim. The real work is **not** the core — it's (a) rewriting the
SDL1 render layer to SDL2 and (b) replacing the native UDP transport with a
WebSocket shim. GTK is only needed for menu/dialog chrome and can be replaced
with HTML/DOM, so it is *not* a blocker for a single-player build.

---

## 1. Toolchain

- **emcc version:** `6.0.0 (afa15e0c56d1292e073c2c91bafc1d5e0cdf0dd3)`
  - clang `23.0.0git`, target `wasm32-unknown-emscripten`, posix thread model.
  - Activated via `source ~/workspace/_ports/emsdk/emsdk_env.sh`.
- Emscripten ships **SDL2** (`-sUSE_SDL=2`) and **SDL2_ttf/SDL2_mixer** ports,
  which matters for the GUI port (section 4).

---

## 2. GUI-vs-Core split (file counts)

Source root: `~/workspace/_ports/winbolo/winbolo/src/`

| Directory            | .c files | Portability                                                        |
|----------------------|---------:|--------------------------------------------------------------------|
| `bolo/`              |       44 | **Portable core.** Only `network.c` pulls in GUI headers.          |
| `lzw/`               |        2 | Portable. Compiles clean.                                          |
| `gui/linux/`         |       30 | Frontend. **22 pull in GTK/GDK, 11 pull in SDL** (overlap).        |
| `winbolonet/`        |        4 | WinBoloNet (HTTP/auth, RSA). Not needed for single-player.         |
| `server/`            |        7 | Standalone dedicated-server + RSA bigint. Not needed for SP.       |

Within `gui/linux/`:
- **15 of 30** are `dialog*.c` — pure GTK menu/setup chrome. Throwaway for a
  browser port (replace with HTML/DOM).
- Only **2** files are pure logic with no GTK *and* no SDL: `lang.c`,
  `preferences.c`.
- The SDL render/IO layer that must be ported is concentrated in:
  `draw.c` (the big one), `input.c`, `cursor.c`, `sound.c`, `main.c`,
  plus thin mutex/thread wrappers (`clientmutex.c`, `framemutex.c`).

**Key finding:** the GUI/core boundary is clean. `bolo/*.c` contains zero
`gtk`/`gdk`/`SDL` includes **except** `network.c`, and even there the coupling
is tiny — 6 references total (a couple of `messageBox`/`dialogAlliance` calls
behind `#include <gtk/gtk.h>` / `SDL.h`).

---

## 3. Core compile results (`emcc -c`, no final link)

Compiled each `bolo/*.c` and `lzw/*.c` to a wasm object. **No final binary
linked** (per spike scope). Flags: `-sUSE_SDL=2`, include paths for
`bolo gui gui/linux server lzw winbolonet`.

### Progression
| Attempt | Flags                                              | Pass | Fail |
|---------|----------------------------------------------------|-----:|-----:|
| 1       | baseline                                           |   14 |   30 |
| 2       | `-D_GNU_SOURCE`                                    |   14 |   30 |
| 3       | force-include u_* type shim                        |   38 |    6 |
| 4       | shim + `-Wno-implicit-function-declaration`        | **43** | **1** |

Plus both `lzw/*.c` compile clean in every attempt. **Final: 45/46 portable
files compile to wasm objects; the only hard failure is `network.c`.**

### Root causes (this is the actionable part)

1. **Missing BSD integer types — the dominant blocker (30→6 files).**
   `bolo/brain.h:122` and friends use `u_long`, `u_char`, `u_short`. Emscripten's
   musl libc does **not** expose these via the headers `brain.h` includes
   (`<sys/socket.h>`, `<netinet/in.h>`, `<arpa/inet.h>`). `-D_GNU_SOURCE` alone
   did **not** fix it (brain.h includes `<sys/socket.h>`, not `<sys/types.h>`).
   *Fix:* a 6-line force-included shim that pulls `<sys/types.h>` and typedefs
   the four `u_*` aliases. Representative error:
   ```
   bolo/brain.h:122:3: error: unknown type name 'u_long'; did you mean 'long'?
   bolo/brain.h:130:20: error: unknown type name 'u_char'
   bolo/brain.h:154:9: error: unknown type name 'u_short'
   ```

2. **Implicit function declarations treated as errors (6→1 files).**
   Modern clang errors on C99 implicit declarations. The 5 affected files
   (`backend.c`, `netmt.c`, `netpnb.c`, `screen.c`, `tank.c`) call functions
   declared only in *frontend/server* headers that aren't on the include path
   for a core-only build, e.g.:
   - `screen.c` → `moveMousePointer()` — declared in `gui/cursor.h` (GUI!)
   - `backend.c` → `serverCoreCenterTank()`, `clientSoundDist()`, `serverCoreSoundDist()`
   - `tank.c`/`netmt.c` → `serverNetGetNetPlayers()`, `serverCoreGetTankPlayer()`, `tankAddHit()`
   These are **real symbols defined elsewhere**, so the objects build fine with
   `-Wno-implicit-function-declaration` and become unresolved-symbol *link*
   dependencies — i.e. they define the exact core↔frontend API surface a port
   must provide. Representative error:
   ```
   bolo/screen.c:347:3: error: call to undeclared function 'moveMousePointer'
   ```

3. **`network.c` — the one true core failure.**
   ```
   bolo/network.c:37:12: fatal error: 'gtk/gtk.h' file not found
   ```
   `network.c` hard-includes `<gtk/gtk.h>` and `SDL.h` for ~6 message-box /
   alliance-dialog calls. The *protocol* logic is portable; only the UI
   callouts need gating behind a stub. Low effort to fix.

**Bottom line:** the WinBolo simulation core is essentially portable. No
endianness, RSA, or platform-assumption walls in the core itself (RSA/bigint
lives in `server/`, not needed for single-player).

---

## 4. SDL1 → SDL2 gap list

The render/IO layer (`gui/linux/draw.c`, `input.c`, `cursor.c`, `main.c`) is
SDL **1.2**. Emscripten only ships SDL2. Concrete API gaps to bridge:

| SDL1 API (used by WinBolo)                          | SDL2 replacement / action                                                                 |
|----------------------------------------------------|-------------------------------------------------------------------------------------------|
| `SDL_SetVideoMode(w,h,bpp,flags)` (draw.c:149,2559)| Removed. Use `SDL_CreateWindow` + `SDL_CreateRenderer`/`SDL_CreateRGBSurface`; keep a software back-buffer surface and blit to a streaming texture. |
| `SDL_Surface` software model + `SDL_HWSURFACE`     | Flags are no-ops/removed in SDL2. Keep surfaces as plain RGB software buffers.             |
| `SDL_UpdateRect` / `SDL_UpdateRects` (~30 call sites in draw.c) | Removed. Replace with texture update + `SDL_RenderCopy` + `SDL_RenderPresent`. This is the **single highest-volume edit** (~30 sites). |
| `SDL_SetColorKey(s, SDL_SRCCOLORKEY, key)`         | `SDL_SRCCOLORKEY` flag gone; call `SDL_SetColorKey(s, SDL_TRUE, key)`.                     |
| `SDL_DisplayFormat()`                              | Removed. Use `SDL_ConvertSurfaceFormat`.                                                   |
| `SDL_GetKeyState()` (input.c)                      | Renamed `SDL_GetKeyboardState`; keysym/scancode model changed.                            |
| `SDL_CreateCursor` / `SDL_GetCursor` / `SDL_SetCursor` (cursor.c) | Mostly compatible; cursor data format unchanged. Low risk.                  |
| `keysym.unicode` text input                        | Removed; use `SDL_TEXTINPUT` events. (WinBolo barely uses unicode input.)                 |
| `SDL_AddTimer` driving game/frame ticks (main.c:1065-67) | **Architectural:** in the browser, replace timer-driven loop with `emscripten_set_main_loop` at the frame rate; advance game ticks inside. |
| `SDL_CreateThread` (dnslookups.c, winbolonetthread.c) | Only used by networking/DNS — **not** on the single-player path. Defer.                 |
| `TTF_*` (SDL_ttf), `SDL_mixer`                     | Available as Emscripten ports (`-sUSE_SDL_TTF=2`, `-sUSE_SDL_MIXER=2`). Low risk.          |

The event loop is unusual: `input.c` uses `SDL_PumpEvents()` + `SDL_GetKeyState`
polling rather than `SDL_PollEvent`. That polling model maps **cleanly** onto an
`emscripten_set_main_loop` callback — arguably easier to port than an event-pump
loop.

---

## 5. Networking: UDP transport → WebSocket replacement points

Transport is **native UDP** (`SOCK_DGRAM`/`IPPROTO_UDP`), confirmed. All client
send/recv lives in **one file**: `gui/linux/netclient.c`. The `bolo/` core never
calls sockets directly — it calls the `netClient*` API, which is the clean seam
to swap.

**Exact replacement points (file:function:line):**

| Function (`gui/linux/netclient.c`)        | Line | Syscall                | Role                                  |
|-------------------------------------------|-----:|------------------------|---------------------------------------|
| `netClientCreate`                         |  116 | `socket()` + `bind()` @132 | Opens the UDP socket. → open WS to relay. |
| `netClientSendUdpLast`                    |  178 | `sendto()` @179        | Send to last peer.                    |
| `netClientSendUdpServer`                  |  194 | `sendto()` @195        | Send to server.                       |
| `netClientUdpPingServer`                  |  369 | `sendto()`@391 / `recvfrom()`@394 | Sync ping (blocking recv).  |
| `netClientUdpPing`                        |  428 | `sendto()`@465 / `recvfrom()`@468 | Sync ping to arbitrary host. |
| `netClientSendUdpNoWait`                  |  501 | `sendto()` @507        | Fire-and-forget send.                 |
| **`netClientUdpCheck`**                   |  582 | `recvfrom()` loop @588,594 | **Main inbound pump** — drains the socket, calls `netUdpPacketArrive()`. This is *the* recv hook to feed from WS `onmessage`. |
| `netClientSendUdpTracker`                 |  673 | `sendto()` @674        | Tracker announce.                     |
| `netClientFindTracked/BroadcastGames`     | 950/1080 | extra `socket`/`recvfrom` | Lobby discovery — not needed for SP/relay. |

**WebSocket shim plan:** the relay is message-based and WinBolo's UDP is already
datagram-oriented, so the mapping is natural. Replace the socket with a WS to
`/api/v1/gamerooms/ws`; turn each `sendto` into `ws.send(buffer)`; feed
`ws.onmessage` into a queue that `netClientUdpCheck` drains (instead of
`recvfrom`). The synchronous ping/`recvfrom` calls (lines 394/468/1163) are the
awkward part — blocking recv doesn't exist in the browser — but they are used
for **lobby/discovery**, not the in-game loop, so a single-player build can stub
them out entirely.

**Single-player avoids all of this:** `bolo/network.h` defines a `netSingle`
(non-networked) `netType`. A first WASM milestone can target `netSingle` and
skip `netclient.c` completely.

---

## 6. Reusable build scaffold

**Path:** `~/workspace/_ports/winbolo/build-emscripten.sh` (committed to the
ports tree, not to grown-workspace).

It is idempotent and commented. On run it:
1. Sources emsdk and verifies `emcc`.
2. Generates the `u_*` BSD-types compat shim into `build-wasm/`.
3. Compiles all `bolo/*.c` (skipping `network.c`) + `lzw/*.c` to wasm objects
   with the correct include paths, `-sUSE_SDL=2`, the shim force-included, and
   `-Wno-implicit-function-declaration`.
4. Prints a pass/fail/skip summary and the documented next steps.
5. `build-emscripten.sh clean` wipes the build dir.

**Verified output of a clean run:** `compiled: 45  failed: 0  skipped: 1`
(43 bolo + 2 lzw objects; `network.c` intentionally skipped). Objects land in
`~/workspace/_ports/winbolo/build-wasm/`.

---

## 7. Effort estimate to first playable single-player WASM build

| Phase | Work | Est. |
|-------|------|------|
| Core link | Resolve the implicit-decl symbols into a real core↔frontend header set; stub `network.c`'s GUI callouts; link the SP object set. | 0.5–1 session |
| SDL1→SDL2 render | Rewrite `draw.c` blit/update pipeline (~30 `SDL_UpdateRect(s)` sites + `SetVideoMode`/`DisplayFormat`/colorkey). The bulk of the effort. | 1.5–2 sessions |
| Input + main loop | `SDL_GetKeyState`→`SDL_GetKeyboardState`; replace `SDL_AddTimer` loop with `emscripten_set_main_loop`. | 0.5–1 session |
| Asset loading | Pre-bundle tiles/sounds/`BoloSounds.bsd` via `--preload-file`; wire BMP/TTF/mixer ports. | 0.5 session |
| Single-player bring-up | Boot `netSingle`, load a map, drive a tick, render. Debug. | 0.5–1 session |
| **Total to first playable SP** | | **~3.5–5.5 sessions** |

Multiplayer (the WebSocket shim over `netclient.c` + GTK-free lobby UI) is a
**separate, later** effort of comparable size, dominated by the blocking
ping/recv rework and lobby/dialog replacement.

---

## 8. Recommendation

**Pursue it, single-player first.** The risk that killed naive expectations
(GTK won't compile to WASM) turns out **not** to gate a single-player build at
all — GTK is confined to dialog chrome and the lightly-coupled `network.c`. The
simulation core is clean portable C that *already* compiles to wasm objects
(43/44) behind a 6-line shim. The genuine effort is concentrated and well-bounded:
the SDL1→SDL2 render rewrite in `draw.c`. That is normal, estimable porting work,
not a research rabbit hole. Recommend a follow-up session to link the
`netSingle` core and start the `draw.c` SDL2 conversion, using the scaffold as
the starting point.

**Artifacts produced by this spike:**
- Build scaffold: `~/workspace/_ports/winbolo/build-emscripten.sh`
- Compiled objects: `~/workspace/_ports/winbolo/build-wasm/*.o` (45 files)
- This report.
