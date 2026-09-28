#!/usr/bin/env python3
"""Close Home Assistant's first-run onboarding window (grown Helm chart).

A fresh Home Assistant serves an onboarding page where the FIRST visitor
creates the owner account. On a public install that is a takeover risk, so the
chart runs this script as a sidecar in the HA pod, against HA on localhost:

  1. wait for HA's HTTP server;
  2. if onboarding's "user" step is open, create the owner from the
     <release>-homeassistant-owner Secret (POST /api/onboarding/users);
  3. finish the remaining steps (core_config, analytics, integration) with the
     owner's token - obtained from the user step's auth code, or by logging in
     with the Secret's credentials if an earlier run stopped half-way;
  4. keep re-checking, so a wiped /config/.storage is re-onboarded too;
  5. on every pass, reconcile HA's HTTP config (reverse-proxy settings) over
     the websocket API - see "HTTP config trial" below.

Idempotent: once everything is in place a pass is one GET plus one websocket
read (``http/config``).

HTTP config trial (HA 2026.9+): HA migrates configuration.yaml's ``http:``
block into .storage/http once, as a PENDING config. Unless an admin sends
``http/config/promote`` within 5 minutes, HA reverts to the STABLE (default)
config, restarts, and ignores the YAML forever after - behind a reverse proxy
that means HTTP 400 for every request. So the sidecar, logged in as the
owner, reads ``http/config`` and:
  * stable already matches the desired proxy settings  -> nothing;
  * pending matches, has no error and is the running config -> promote it;
  * otherwise -> ``http/config/configure`` with stable + the desired settings
    (HA restarts into it as pending); a later pass promotes it.
Desired = use_x_forwarded_for: true, trusted_proxies = HTTP_TRUSTED_PROXIES,
use_x_frame_options = HTTP_USE_X_FRAME_OPTIONS. A pending config that failed
to apply (``apply_failed``) is not retried, and configure is rate-limited, so
a bad value can't restart-loop HA.

``onboard.py --check`` is the HA container's readiness probe: it exits 0 only
when the "user" step is done. Until then the pod is NotReady, so the Service
(and therefore the Ingress/HTTPRoute) sends it no traffic - nobody outside
the pod can reach the onboarding page in the moment before this script
creates the owner.

Standard library only (runs on the Home Assistant image's python3).

Environment:
  HA_URL            default http://127.0.0.1:8123
  OWNER_USERNAME    owner login          (required unless --check)
  OWNER_PASSWORD    owner password       (required unless --check)
  OWNER_NAME        display name         default "Administrator"
  OWNER_LANGUAGE    UI language          default "en"
  RECHECK_SECONDS   pause between passes default 60
  HTTP_MANAGE       "false" disables the HTTP config reconcile  default true
  HTTP_TRUSTED_PROXIES      comma-separated CIDRs   (required to manage)
  HTTP_USE_X_FRAME_OPTIONS  "true"/"false"          default true
"""

from __future__ import annotations

import base64
import ipaddress
import json
import os
import socket
import struct
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HA_URL = os.environ.get("HA_URL", "http://127.0.0.1:8123").rstrip("/")
CLIENT_ID = f"{HA_URL}/"
REDIRECT_URI = f"{HA_URL}/?auth_callback=1"
TIMEOUT = 10

# Steps after "user", in the order HA's frontend completes them.
LATER_STEPS = ("core_config", "analytics", "integration")


def log(msg: str) -> None:
    print(f"[ha-onboard] {msg}", flush=True)


class HTTPError(Exception):
    def __init__(self, status: int, body: str) -> None:
        super().__init__(f"HTTP {status}: {body[:300]}")
        self.status = status


def request(method: str, path: str, *, json_body=None, form=None, token: str | None = None):
    headers = {"Accept": "application/json"}
    data = None
    if json_body is not None:
        data = json.dumps(json_body).encode()
        headers["Content-Type"] = "application/json"
    elif form is not None:
        data = urllib.parse.urlencode(form).encode()
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(f"{HA_URL}{path}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            raw = resp.read().decode() or "null"
    except urllib.error.HTTPError as err:
        raise HTTPError(err.code, err.read().decode(errors="replace")) from None
    return json.loads(raw)


def onboarding_status() -> dict[str, bool] | None:
    """{step: done}; None when HA has no onboarding API (nothing to do)."""
    try:
        steps = request("GET", "/api/onboarding")
    except HTTPError as err:
        if err.status == 404:
            return None
        raise
    return {s["step"]: bool(s["done"]) for s in steps}


class Tokens:
    """The owner's HA tokens, reused across passes.

    Logging in on every pass would add a refresh token to HA's auth store
    each time, so keep one refresh token and renew the access token with it.
    """

    def __init__(self) -> None:
        self.access: str | None = None
        self.refresh: str | None = None
        self.expires = 0.0

    def store(self, tokens: dict) -> str:
        self.access = tokens["access_token"]
        self.refresh = tokens.get("refresh_token") or self.refresh
        self.expires = time.monotonic() + float(tokens.get("expires_in", 1800)) - 60
        return self.access

    def get(self, owner: dict[str, str]) -> str:
        if self.access and time.monotonic() < self.expires:
            return self.access
        if self.refresh:
            try:
                return self.store(
                    request(
                        "POST",
                        "/auth/token",
                        form={
                            "grant_type": "refresh_token",
                            "refresh_token": self.refresh,
                            "client_id": CLIENT_ID,
                        },
                    )
                )
            except HTTPError:
                self.refresh = None  # revoked / HA storage reset: log in again
        return self.store(login_tokens(owner["username"], owner["password"]))

    def reset(self) -> None:
        self.access, self.refresh, self.expires = None, None, 0.0


TOKENS = Tokens()
_SAID_NO_ONBOARDING = False


def exchange_code(code: str) -> str:
    return TOKENS.store(
        request(
            "POST",
            "/auth/token",
            form={"grant_type": "authorization_code", "code": code, "client_id": CLIENT_ID},
        )
    )


def login_tokens(username: str, password: str) -> dict:
    """Owner tokens via the username/password login flow."""
    flow = request(
        "POST",
        "/auth/login_flow",
        json_body={
            "client_id": CLIENT_ID,
            "handler": ["homeassistant", None],
            "redirect_uri": REDIRECT_URI,
        },
    )
    result = request(
        "POST",
        f"/auth/login_flow/{flow['flow_id']}",
        json_body={"client_id": CLIENT_ID, "username": username, "password": password},
    )
    if result.get("type") != "create_entry":
        raise RuntimeError(
            "owner login failed (was the owner's password changed in HA? "
            "finishing onboarding and managing the HTTP config need the "
            "credentials in the owner Secret)"
        )
    return request(
        "POST",
        "/auth/token",
        form={"grant_type": "authorization_code", "code": result["result"], "client_id": CLIENT_ID},
    )


# ----- minimal websocket client (stdlib; HA's /api/websocket) ---------------


class WebSocket:
    """Just enough RFC 6455 for HA's JSON API over plain ws:// on localhost."""

    def __init__(self, url: str, timeout: float = TIMEOUT) -> None:
        parsed = urllib.parse.urlsplit(url)
        host, port = parsed.hostname or "127.0.0.1", parsed.port or 80
        self.sock = socket.create_connection((host, port), timeout=timeout)
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall(
            (
                f"GET {parsed.path or '/'} HTTP/1.1\r\nHost: {host}:{port}\r\n"
                "Upgrade: websocket\r\nConnection: Upgrade\r\n"
                f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
            ).encode()
        )
        head = b""
        while b"\r\n\r\n" not in head:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise ConnectionError("websocket handshake: connection closed")
            head += chunk
        head, self.buf = head.split(b"\r\n\r\n", 1)
        if not head.startswith(b"HTTP/1.1 101"):
            raise ConnectionError(f"websocket handshake refused: {head.splitlines()[0]!r}")
        self.next_id = 1

    def _read(self, n: int) -> bytes:
        while len(self.buf) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise ConnectionError("websocket closed")
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def _send_frame(self, opcode: int, payload: bytes) -> None:
        mask = os.urandom(4)
        n = len(payload)
        if n < 126:
            header = struct.pack("!BB", 0x80 | opcode, 0x80 | n)
        elif n < 65536:
            header = struct.pack("!BBH", 0x80 | opcode, 0x80 | 126, n)
        else:
            header = struct.pack("!BBQ", 0x80 | opcode, 0x80 | 127, n)
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        self.sock.sendall(header + mask + masked)

    def send(self, obj: dict) -> None:
        self._send_frame(0x1, json.dumps(obj).encode())

    def recv(self) -> dict:
        message = b""
        while True:
            b1, b2 = self._read(2)
            opcode, n = b1 & 0x0F, b2 & 0x7F
            if n == 126:
                n = struct.unpack("!H", self._read(2))[0]
            elif n == 127:
                n = struct.unpack("!Q", self._read(8))[0]
            mask = self._read(4) if b2 & 0x80 else None
            payload = self._read(n)
            if mask:
                payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
            if opcode == 0x8:
                raise ConnectionError("websocket closed by HA")
            if opcode == 0x9:
                self._send_frame(0xA, payload)
                continue
            if opcode in (0x1, 0x2, 0x0):
                message += payload
                if b1 & 0x80:
                    return json.loads(message)

    def call(self, msg_type: str, **fields) -> dict:
        """Send one command; return its result message (skipping events)."""
        msg_id = self.next_id
        self.next_id += 1
        self.send({"id": msg_id, "type": msg_type, **fields})
        while True:
            reply = self.recv()
            if reply.get("id") == msg_id and reply.get("type") == "result":
                return reply

    def close(self) -> None:
        try:
            self._send_frame(0x8, b"")
        except OSError:
            pass
        self.sock.close()


def ws_connect(access_token: str) -> WebSocket:
    ws = WebSocket(HA_URL.replace("http://", "ws://", 1) + "/api/websocket")
    try:
        if ws.recv().get("type") != "auth_required":
            raise ConnectionError("unexpected websocket greeting")
        ws.send({"type": "auth", "access_token": access_token})
        reply = ws.recv()
        if reply.get("type") != "auth_ok":
            raise PermissionError(f"websocket auth failed: {reply.get('message', reply)}")
    except Exception:
        ws.close()
        raise
    return ws


# ----- HTTP config reconcile --------------------------------------------------

HTTP_META_KEYS = ("created_at", "error", "error_message")
# Configure (= restart HA) at most this often, so nothing can restart-loop HA.
CONFIGURE_MIN_INTERVAL = 600.0


def desired_http_config() -> dict | None:
    """The proxy settings the chart wants, or None when not managed."""
    if os.environ.get("HTTP_MANAGE", "true").lower() == "false":
        return None
    proxies = [p.strip() for p in os.environ.get("HTTP_TRUSTED_PROXIES", "").split(",") if p.strip()]
    if not proxies:
        return None
    return {
        "use_x_forwarded_for": True,
        "trusted_proxies": [str(ipaddress.ip_network(p)) for p in proxies],
        "use_x_frame_options": os.environ.get("HTTP_USE_X_FRAME_OPTIONS", "true").lower() != "false",
    }


def http_matches(conf: dict | None, desired: dict) -> bool:
    if not conf:
        return False
    if bool(conf.get("use_x_forwarded_for")) != desired["use_x_forwarded_for"]:
        return False
    if bool(conf.get("use_x_frame_options", True)) != desired["use_x_frame_options"]:
        return False
    try:
        have = {str(ipaddress.ip_network(p)) for p in conf.get("trusted_proxies") or []}
    except ValueError:
        return False
    return have == set(desired["trusted_proxies"])


def plan_http(state: dict, desired: dict) -> tuple[str, dict | None]:
    """Decide what to do with an ``http/config`` result.

    Returns (action, config): "ok", "promote", "configure" (with the config
    to send), "wait" (HA is about to restart into the pending config) or
    "stuck" (the desired config failed to apply; needs a human).
    """
    stable, pending = state.get("stable"), state.get("pending")
    if http_matches(stable, desired):
        return "ok", None
    if http_matches(pending, desired):
        error = pending.get("error")
        if error is None:
            if state.get("active_config_type") == "pending":
                return "promote", None
            return "wait", None
        if error == "apply_failed":
            return "stuck", None
        # "not_promoted" (the trial timed out): configure the same config
        # again, which clears the error and restarts into it.
    base = {k: v for k, v in (stable or {}).items() if k not in HTTP_META_KEYS}
    return "configure", {**base, **desired}


class HttpReconciler:
    def __init__(self) -> None:
        self.last_configure = -CONFIGURE_MIN_INTERVAL
        self.last_note = ""

    def note(self, msg: str) -> None:
        if msg != self.last_note:  # don't repeat the same line every pass
            log(msg)
            self.last_note = msg

    def reconcile(self, owner: dict[str, str], desired: dict) -> bool:
        """One pass. True when HA's stable HTTP config matches ``desired``."""
        try:
            ws = ws_connect(TOKENS.get(owner))
        except PermissionError:
            TOKENS.reset()
            raise
        try:
            reply = ws.call("http/config")
            if not reply.get("success"):
                raise RuntimeError(f"http/config failed: {reply.get('error')}")
            action, config = plan_http(reply["result"], desired)
            if action == "ok":
                self.note("http config: stable matches (reverse proxy trusted)")
                return True
            if action == "promote":
                result = ws.call("http/config/promote")
                if not result.get("success"):
                    raise RuntimeError(f"http/config/promote failed: {result.get('error')}")
                self.note("http config: promoted the pending config to stable")
                return True
            if action == "wait":
                self.note("http config: pending config not running yet; waiting for HA to restart")
                return False
            if action == "stuck":
                self.note(
                    "http config: the desired config FAILED to apply (apply_failed); "
                    "not retrying - check homeAssistant.trustedProxies / HA logs"
                )
                return False
            if time.monotonic() - self.last_configure < CONFIGURE_MIN_INTERVAL:
                self.note("http config: configured recently; not restarting HA again yet")
                return False
            result = ws.call("http/config/configure", config=config)
            if not result.get("success"):
                err = result.get("error") or {}
                if err.get("code") == "not_running":
                    self.note("http config: HA still starting; will configure when running")
                    return False
                raise RuntimeError(f"http/config/configure failed: {err}")
            self.last_configure = time.monotonic()
            log(
                "http config: stored the reverse-proxy settings as pending "
                f"(restart={result['result'].get('restart')}); promoting after HA restarts"
            )
            return False
        finally:
            ws.close()


def onboard_once(owner: dict[str, str]) -> bool:
    """One pass. True when the user step is done afterwards."""
    status = onboarding_status()
    if status is None:
        # HA drops the onboarding views once onboarding is complete (after a
        # restart), so this is the normal steady state: say it once.
        global _SAID_NO_ONBOARDING
        if not _SAID_NO_ONBOARDING:
            log("onboarding API not present (HA already onboarded); nothing to do")
            _SAID_NO_ONBOARDING = True
        return True
    if all(status.values()):
        return True

    token = None
    if not status.get("user", True):
        log(f"onboarding open: creating owner {owner['username']!r}")
        try:
            result = request(
                "POST",
                "/api/onboarding/users",
                json_body={
                    "client_id": CLIENT_ID,
                    "name": owner["name"],
                    "username": owner["username"],
                    "password": owner["password"],
                    "language": owner["language"],
                },
            )
        except HTTPError as err:
            if err.status != 403:  # 403 = someone/something finished it first
                raise
            log("user step already done (HTTP 403)")
        else:
            token = exchange_code(result["auth_code"])
            log("owner created")

    remaining = [s for s in LATER_STEPS if status.get(s) is False]
    if remaining:
        if token is None:
            token = TOKENS.get(owner)
        for step in remaining:
            body = {"client_id": CLIENT_ID, "redirect_uri": REDIRECT_URI} if step == "integration" else {}
            try:
                request("POST", f"/api/onboarding/{step}", json_body=body, token=token)
                log(f"completed step {step}")
            except HTTPError as err:
                if err.status != 403:
                    raise
                log(f"step {step} already done")

    after = onboarding_status()
    done = after is None or after.get("user", True)
    if after is not None and all(after.values()):
        log("onboarding complete")
    return done


def check() -> int:
    """Readiness: 0 only if HA answers and its onboarding user step is done."""
    try:
        status = onboarding_status()
    except Exception as err:  # noqa: BLE001 - any failure means not ready
        print(f"not ready: {err}", file=sys.stderr)
        return 1
    if status is not None and not status.get("user", True):
        print("not ready: onboarding user step still open", file=sys.stderr)
        return 1
    return 0


def main(argv: list[str]) -> int:
    if "--check" in argv:
        return check()
    once = "--once" in argv
    owner = {
        "username": os.environ.get("OWNER_USERNAME", ""),
        "password": os.environ.get("OWNER_PASSWORD", ""),
        "name": os.environ.get("OWNER_NAME") or "Administrator",
        "language": os.environ.get("OWNER_LANGUAGE") or "en",
    }
    if not owner["username"] or not owner["password"]:
        log("OWNER_USERNAME and OWNER_PASSWORD are required")
        return 2
    recheck = max(5, int(os.environ.get("RECHECK_SECONDS", "60")))
    desired = desired_http_config()
    http = HttpReconciler()
    log(f"watching {HA_URL} onboarding" + (" and http config" if desired else ""))
    announced = False
    while True:
        try:
            done = onboard_once(owner)
            if done and not announced:
                log("owner account in place; onboarding page closed")
                announced = True
            http_ok = True
            if done and desired is not None:
                try:
                    http_ok = http.reconcile(owner, desired)
                except (urllib.error.URLError, ConnectionError, TimeoutError, OSError):
                    raise
                except Exception as err:  # noqa: BLE001 - report, keep going
                    http.note(f"http config: {err}")
                    http_ok = False
            if once:
                return 0 if done and http_ok else 1
            # Pending work (e.g. promote after HA's restart) must finish well
            # inside HA's 5-minute trial window: re-check quickly until done.
            time.sleep(recheck if done and http_ok else min(recheck, 10) if done else 2)
        except (urllib.error.URLError, ConnectionError, TimeoutError, OSError) as err:
            # HA not listening yet (first boot installs deps) or restarting.
            if once:
                log(f"HA not reachable: {err}")
                return 1
            time.sleep(1)
        except Exception as err:  # noqa: BLE001 - keep the sidecar alive
            log(f"error: {err}")
            if once:
                return 1
            time.sleep(10)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
