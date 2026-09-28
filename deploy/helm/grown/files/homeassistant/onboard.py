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
  4. keep re-checking, so a wiped /config/.storage is re-onboarded too.

Idempotent: once onboarding is done every pass is a single GET.

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
"""

from __future__ import annotations

import json
import os
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


def exchange_code(code: str) -> str:
    tokens = request(
        "POST",
        "/auth/token",
        form={"grant_type": "authorization_code", "code": code, "client_id": CLIENT_ID},
    )
    return tokens["access_token"]


def login(username: str, password: str) -> str:
    """Owner access token via the username/password login flow."""
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
            "owner login failed (was the password changed in HA? the remaining "
            "onboarding steps need the owner's credentials)"
        )
    return exchange_code(result["result"])


def onboard_once(owner: dict[str, str]) -> bool:
    """One pass. True when the user step is done afterwards."""
    status = onboarding_status()
    if status is None:
        log("onboarding API not present; nothing to do")
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
            token = login(owner["username"], owner["password"])
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
    log(f"watching {HA_URL} onboarding")
    announced = False
    while True:
        try:
            done = onboard_once(owner)
            if done and not announced:
                log("owner account in place; onboarding page closed")
                announced = True
            if once:
                return 0 if done else 1
            time.sleep(recheck if done else 2)
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
