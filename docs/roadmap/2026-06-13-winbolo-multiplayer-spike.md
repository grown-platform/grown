# WinBolo Multiplayer Spike — server build + WebSocket transport

**Date:** 2026-06-13
**Scope:** Bounded spike. Assess + prototype WinBolo *client/server* multiplayer
for the clean-art, public-safe Bolo. Determine the cleanest path and prove the
key unknowns. The single-player WASM client already links + renders (M1/M2);
networking is currently stubbed via `net_stub.c`.

## TL;DR — **server builds + runs; packets round-trip over WebSocket. PROVEN.**

1. The **native WinBolo dedicated server builds and runs** on macOS today (75
   objects, 0 link errors) after a tiny SDL1→SDL2 shim. It listens on **UDP**
   (port from `-port`), loads the inbuilt Everard Island map, and ticks.
2. I built a **WS↔UDP bridge sidecar** (shape (a): server stays unmodified) and
   a WebSocket probe that emulates the emscripten transport. **A real WinBolo
   packet round-tripped** `WS client → bridge → UDP → unmodified server → UDP →
   bridge → WS client`: the server received the 8-byte INFOREQUEST and replied
   with a 96-byte `INFO_PACKET` (`header="Bolo" ver=1.1.7`, map name **"Everard
   Island"**), delivered back intact over the WS frame. This is the riskiest
   unknown and it is closed.
3. The client seam is clean: replacing `net_stub.c` with a real WS transport
   uses Emscripten's built-in `emscripten/websocket.h` API. The **one genuine
   wall** is that WinBolo's *join handshake* uses **synchronous** send-then-recv
   (`netClientUdpPingServer`), which the browser can't do directly — it needs
   **ASYNCIFY** (or a join-path refactor). The *in-game* loop is already async
   and maps 1:1 to `ws.send` + an arrival queue.
4. **Recommendation: pursue WinBolo MP for the clean-art public build.** Orona
   MP already works but its **assets are IP-encumbered** (original Bolo
   graphics/sounds) — unsafe to ship publicly. WinBolo is the clean-art path,
   and this spike shows the server + transport are tractable, not a research
   rabbit hole. Estimate to playable 2-player WinBolo: **~4–7 sessions.**

All artifacts are under `~/workspace/_ports/winbolo/server-build/`. Nothing was
committed; the grown repo was not modified except this report.

---

## 1. Server build outcome + match/UDP model

### It compiles and runs

- **Source:** `~/workspace/_ports/winbolo/winbolo/src/server` (its own Makefile,
  separate from the client). The Makefile is SDL **1.x**-era (`sdl-config`,
  `SDL_SetTimer`, 2-arg `SDL_CreateThread`) and doesn't build as-is on a modern
  macOS clang + SDL2 toolchain.
- **Build script (new):** `~/workspace/_ports/winbolo/server-build/build-server.sh`
  — compiles 75 objects and links `linbolods`. Verified output:
  `compiled=75 failed=0` → `LINK OK -> .../server-build/linbolods`
  (`Mach-O 64-bit arm64`).

**Fixes required (all in `server-build/`, source kept unmodified except where
noted; no commits):**

| Issue | Why | Fix |
|-------|-----|-----|
| `SDL_SetTimer` (SDL1, removed in SDL2) | server tick timer | `sdl1timer_compat.h` — force-included into `servermain.c`; maps `SDL_SetTimer(iv,cb)` onto `SDL_AddTimer(iv,trampoline,0)`. |
| 2-arg `SDL_CreateThread` | SDL2 needs `(fn,name,data)` | same shim, `#define SDL_CreateThread(fn,data) …("wbn",…)`, force-included into `winbolonetthread.c`. |
| Modern clang errors on C99 implicit decls | clang 17 defaults to C23 | `-std=gnu99` + `-Wno-implicit-function-declaration` (these are real symbols defined in other TUs). |
| `backend.c` omitted | provides `winboloTimer`, `screenNumPills`, `soundDist`, … | added it to the object set. |
| `screenGetTankMapCoord` / `screenTankIsDead` unresolved | only defined in client `bolo/screen.c` (not in server set); referenced by `sounddist.c`/`scroll.c` on server-inert paths | `server_screen_stubs.c` — 2 harmless stubs. |
| 4 duplicate symbols (`screenTanksAddItem`, `screenLgmAddItem`, `clientSoundDist`, `clientMessageAdd`) | `serverfrontend.c` defines server versions that collide with the client `bolo/` copies; old GNU ld tolerated it, modern macOS ld hard-errors (no `-z muldefs`) | `weakserverfront.h` — marks serverfrontend's copies `__attribute__((weak))` so client strong defs win (serverfrontend's `screenTanksAddItem` is only a "should never be called" guard, so behaviour-neutral). |

`-fcommon` is also set (the original relied on it). None of these touch protocol
logic; they're toolchain-era papercuts.

> Note: a Linux/GitHub-CI server build would be even cleaner (the code targets
> Linux + SDL). On macOS the SDL1→SDL2 timer/thread shim is the only real edit.

### Run / listen confirmation

```
$ ./linbolods -inbuilt -port 50000 -gametype open -ai no -noinput -nowinbolonet
Server Transport Startup
Thread Manager Startup
Type "help" for help, "quit" to exit.

$ lsof -nP -p <pid> | grep UDP
linbolods … UDP *:50000
```

### Match / UDP model (how a client joins)

- **Transport:** one **UDP** socket, `socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP)` +
  `bind()` to `-port`, non-blocking. (`server/servertransport.c`.) No TCP for
  gameplay (TCP only appears in the optional WinBolo.net/tracker HTTP side).
- **Concurrency:** effectively single-threaded. An `SDL_AddTimer`
  (`SERVER_TICK_LENGTH = GAME_TICK_LENGTH*2 = 100ms`) fires `serverGameTimer`,
  which (a) advances `serverCoreGameTick()` and (b) calls
  `serverNetMakePosPackets()` → `serverTransportDoChecks()` →
  `serverTransportListenUDP()` to **drain all pending UDP** and dispatch via
  `serverNetUDPPacketArrive()`. `processKeys()` blocks on stdin for the console.
  A `SDL_mutex` guards core state between the timer and console.
- **Players:** up to `MAX_TANKS` (16); `-maxplayers N` caps it.
- **Map:** `-map <file>` or `-inbuilt` (embedded Everard Island,
  `serverCoreCreateCompressed(... 5097, "Everard Island", ...)`). Clients
  **download the map from the server** during join (`netStartDownload` state),
  so no client-side map asset is needed for MP.
- **Game types:** `open` / `tournament` / `strict`; flags for hidden mines, AI
  brains, start delay, time limit, password, tracker.
- **Packet format:** every datagram begins with an 8-byte header
  `'B','o','l','o', verMaj=0x01, verMin=0x01, verRev=0x07, <type>` (`netpacks.h`).
  Most in-game packets carry a trailing 2-byte CRC; discovery packets
  (INFOREQUEST) don't. Join responses include a player-number assignment and
  per-player data; gameplay then flows as position/data packets.

### Join handshake (the critical client-side detail)

`netJoinInit` (`bolo/network.c`) performs the join as a **serial, synchronous**
request/response sequence over `netClientUdpPingServer()` (send, then *blocking*
`recvfrom` with retries): server-key (if WBN) → player-number request
(`BOLOPACKET_PLAYERNUMRESPONSE`) → player-data request
(`BOLOPACKET_PLAYERDATARESPONSE`) → map download → enter the running loop. The
in-game loop afterward is **async**: `netClientSendUdpServer()` (fire-and-forget)
+ `netClientUdpCheck()` draining arrivals into `netUdpPacketArrive()`.

---

## 2. Transport design: `net_stub.c` → real WebSocket

### Why shape (a) — WS↔UDP bridge sidecar — is recommended

Two shapes were considered:

- **(a) WS↔UDP bridge sidecar** in front of the unmodified native server:
  `client WS → bridge → UDP → linbolods`. ✅ **Recommended.**
- **(b) native WS listener inside the server** (`servertransport.c`): would
  embed an RFC6455 server into the C process, replacing/augmenting the UDP
  socket.

Shape (a) wins decisively:
- **Server stays byte-for-byte unmodified** — no risk to the authoritative sim,
  no C WebSocket library to vendor, and the same `linbolods` binary also serves
  any future native UDP clients.
- The bridge is ~120 lines of dependency-free Node and trivially horizontally
  scalable / swappable.
- WinBolo's protocol is already datagram-oriented, so the WS↔UDP mapping is
  **1:1 with no reframing** — each binary WS frame is exactly one UDP datagram.
- Per-WS-connection ephemeral UDP socket → the server sees a distinct
  `(ip,port)` per client, exactly as with native clients. No protocol changes.

(b) only makes sense later if we want to drop the sidecar process for ops
simplicity; it's strictly more invasive and not worth it for bring-up.

### Client changes: `net_stub.c` → `net_ws.c` (file:function map)

All client UDP is isolated in **`gui/linux/netclient.c`**; the emscripten build
currently links the no-op **`gui/emscripten/net_stub.c`** instead. Replace it
with a `net_ws.c` implementing the same `netClient*` API over
`emscripten/websocket.h` (confirmed present in the SDK:
`emscripten_websocket_new`, `emscripten_websocket_send_binary`,
`emscripten_websocket_set_onmessage_callback`):

| `netClient*` function | UDP today | WebSocket replacement |
|-----------------------|-----------|------------------------|
| `netClientCreate(port)` | `socket()`+`bind()` | `emscripten_websocket_new()` to `wss://…/bolo` (the bridge); store the socket handle. Return TRUE on create (connection completes async — see ASYNCIFY note). |
| `netClientSendUdpServer(buff,len)` | `sendto(addrServer)` | `emscripten_websocket_send_binary(sock, buff, len)`. |
| `netClientSendUdpLast(buff,len)` | `sendto(addrLast)` | same `send_binary` (single server peer in the bridge model). |
| `netClientUdpCheck()` (**main inbound pump**) | `recvfrom` loop → `netUdpPacketArrive()` | drain an in-memory arrival queue (filled by the WS `onmessage` callback) → `netUdpPacketArrive(buf,len,port)`. |
| WS `onmessage` callback (**new**) | — | push the received bytes onto the arrival queue (and, if blocked in a sync ping, satisfy it). |
| `netClientUdpPingServer(buff,&len,…)` (**sync, join-only**) | `sendto`+blocking `recvfrom` | `send_binary` then **`emscripten_sleep`/yield until the queue has a reply** — requires **ASYNCIFY** (see §3). |
| `netClientUdpPing(...)`, `netClientSendUdpNoWait`, tracker, `netClientFind*Games` | discovery/LAN | stub for MP-via-bridge (server is selected out-of-band by URL, not LAN broadcast). |

The `bolo/` core never touches sockets — it only calls this `netClient*` API —
so no core edits are needed for transport. The existing `net_stub.c` already
proves the link surface; `net_ws.c` just fills in real bodies.

---

## 3. Prototype: how far it got (with evidence)

**Goal:** prove a WinBolo packet can round-trip over WebSocket to the
unmodified native server. **Achieved.**

Artifacts (`~/workspace/_ports/winbolo/server-build/`):
- `ws-udp-bridge.mjs` — dependency-free RFC6455 WS server; one ephemeral UDP
  socket per WS client toward `linbolods`; binary WS frame ⇄ UDP datagram 1:1.
- `ws-probe.mjs` — emulates the emscripten transport using Node's **built-in
  global `WebSocket`** (same API the browser/WASM client uses). Sends the 8-byte
  INFOREQUEST and verifies the framed reply.

**Run (server → bridge → probe):**
```
./linbolods -inbuilt -port 50000 -gametype open -ai no -noinput -nowinbolonet &
WS_PORT=9000 UDP_PORT=50000 node ws-udp-bridge.mjs &
node ws-probe.mjs
```
**Output:**
```
[bridge] WS listening :9000  ->  UDP 127.0.0.1:50000
[bridge] client connected; opened UDP relay -> 127.0.0.1:50000
[probe]  WS open; sending 8-byte INFOREQUEST through bridge...
[probe]  REPLY 96 bytes  header="Bolo" ver=1.1.7 type=14
[probe]  map name field: "Everard Island"
PASS: WinBolo INFO_PACKET round-tripped browser<->WS<->bridge<->UDP<->server.
```
Server-side, simultaneously: `Info packet request from 127.0.0.1`.

**What this proves:** the full transport chain works end to end with the server
**unmodified** — the bytes the server emits arrive back at a WebSocket client
intact, and the server treats the bridged client as an ordinary UDP peer. The
INFOREQUEST/`INFO_PACKET` exchange is the stateless server-discovery handshake;
it's not the full join, but it exercises the identical send/receive plumbing the
join uses.

**What it does NOT yet prove (the documented next step):** the full *join*
handshake from the WASM client. That requires `net_ws.c` + **ASYNCIFY**, because
`netJoinInit` calls the **synchronous** `netClientUdpPingServer` (blocking recv)
several times. The exact next step:
1. Build the WASM client with `-sASYNCIFY` and `-sASYNCIFY_IMPORTS` covering the
   WS wait, plus `-lwebsocket.js`.
2. Implement `net_ws.c` per the §2 table; in `netClientUdpPingServer`, after
   `send_binary`, call `emscripten_sleep()` in a retry loop until the arrival
   queue yields a reply or `MAX_RETRIES` is hit.
3. Boot `netSetup(netClient, …)` + `netStart` against the bridge URL instead of
   `netSingle`; drive the existing `netStart`/`netClientUdpCheck` loop from
   `main_em.c`'s frame callback.
4. Verify the player-number + player-data + map-download sequence completes and
   the client enters `netRunning`. Getting the first `BOLOPACKET_PLAYERNUMRESPONSE`
   back is the next strong signal; a second client seeing the first is "playable".

---

## 4. Hosting shape (cluster service / sidecar)

- **`linbolods`** — one process **per game room** (each binds its own UDP port;
  match config via args: map, gametype, maxplayers). Stateful, authoritative,
  cheap. A room-manager spawns/reaps these (mirrors the Orona room model).
- **WS↔UDP bridge** — stateless sidecar that terminates `wss://` from browsers
  and relays to the room's UDP port. Co-locate one bridge with each server pod
  (sidecar container) or run a small bridge fleet that routes by room → UDP
  `(host,port)`. TLS terminates at the ingress; the bridge can be plain `ws`
  behind it.
- **Map download** is in-protocol (server → client), so the browser client needs
  **no** map asset for MP — simpler than the SP bundle.
- The bridge is the natural place for per-room routing, rate-limiting, and
  connection auth (a signed room token in the WS URL/subprotocol), keeping the C
  server unmodified.

Compared to Orona (a single Node sim server), WinBolo's shape is "native C sim
process + thin WS sidecar" — one extra moving part (the bridge), but the bridge
is trivial and the sim is the original, battle-tested authoritative server.

---

## 5. Honest effort estimate to playable 2+ player WinBolo

| Phase | Work | Est. |
|-------|------|------|
| Server productionization | Wrap `build-server.sh` into a clean Linux/CI build (drops the macOS SDL shims); containerize `linbolods`; room-spawn manager. | 0.5–1 session |
| WS bridge hardening | Promote the prototype bridge: per-room routing, TLS/ingress, token auth, backpressure, reconnect. | 0.5–1 session |
| `net_ws.c` (client transport) | Implement the `netClient*` API over `emscripten/websocket.h` per §2; arrival queue + onmessage. | 1 session |
| **ASYNCIFY join** (the real risk) | Rebuild WASM with ASYNCIFY; make the synchronous `netClientUdpPingServer` yield-and-resume; complete the join state machine (player-num → player-data → map download → `netRunning`). Debug. | 1.5–2.5 sessions |
| Lobby / join UX | GTK-free join screen (server URL / room pick); the SP build already proved the GTK-free path. | 0.5–1 session |
| Two-client bring-up + polish | Two browsers in one match, position sync, leave/rejoin, message bar. | 0.5–1 session |
| **Total to playable 2-player** | | **~4.5–7.5 sessions** |

Risk is concentrated in the **ASYNCIFY join** phase (blocking-recv in a browser).
Everything else is now de-risked: server builds + runs, transport round-trips,
the client seam is a single well-defined API, and Emscripten has a first-class
WebSocket API. ASYNCIFY is a known, supported Emscripten feature — moderate, not
research-grade, risk. (Fallback if ASYNCIFY is painful: refactor the ~4
`netClientUdpPingServer` join calls into the async `netStart` state machine —
more C work but no ASYNCIFY.)

---

## 6. Compare to Orona — and recommendation

| | **WinBolo MP (this spike)** | **Orona MP (already proven)** |
|--|--|--|
| Status | Server builds+runs; WS round-trip proven; join (ASYNCIFY) TODO | **Working** — two browsers sync in one match (`orona-multiplayer-m1.md`) |
| Server | Native C authoritative `linbolods` (original, battle-tested) + thin WS sidecar | Revived Node authoritative sim server |
| Art / IP | **Clean-art, public-safe** (WinBolo's own graphics/sounds) | **IP-encumbered** — ships original Bolo (Bungie) graphics/sounds; *"a public release would need clean-room asset replacement"* (orona-revival-spike §2) |
| Remaining work | ~4.5–7.5 sessions (ASYNCIFY join is the crux) | Mostly polish/join-UX; MP core already syncs |
| Extra moving parts | server + WS bridge sidecar | single Node server |

**Recommendation: pursue WinBolo MP as the clean-art *public* path.** Orona MP is
further along and is the right choice for an **internal/demo** build *today*, but
its assets are IP-encumbered and **cannot be shipped publicly** without
clean-room replacement. WinBolo is the public-safe option by construction, and
this spike removes the two biggest doubts: the server builds + runs unmodified,
and WinBolo's packet stream round-trips over WebSocket. The remaining cost is
real but bounded and well-understood (ASYNCIFY join + bridge/transport plumbing),
not open-ended research.

Suggested sequencing: ship **Orona MP for internal demos now**; invest the
~5–7 sessions to bring **WinBolo MP** to playable for the **public** launch, so
the public build is clean-art end to end (client render is already done in M1/M2;
this completes the networking).

---

## Artifacts (all under `~/workspace/_ports/winbolo/server-build/`, not committed)

- `build-server.sh` — native server build (75 objects → `linbolods`).
- `sdl1timer_compat.h`, `weakserverfront.h`, `server_screen_stubs.c` — the build shims.
- `linbolods` — the built dedicated server (Mach-O arm64).
- `ws-udp-bridge.mjs` — WS↔UDP bridge sidecar (dependency-free RFC6455).
- `ws-probe.mjs` — emscripten-transport-emulating WS probe (PASS evidence above).
- This report.
