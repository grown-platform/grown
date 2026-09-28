#!/usr/bin/env python3
"""Install the grown HA custom integration from the Grown server (grown chart).

Runs as an initContainer on every Home Assistant pod start: downloads
GROWN_ZIP_URL (Grown's /integrations/homeassistant/grown.zip) and replaces
/config/custom_components/grown with it, so HA always runs the integration
that matches the deployed Grown version.

Grown may still be starting (first install waits for Zitadel/OIDC), so it
retries until FETCH_TIMEOUT_SECONDS, then gives up WITHOUT failing: HA starts
anyway, keeping any previously installed copy (or none). The next pod start
tries again.

Standard library only (runs on the Home Assistant image's python3).

Environment:
  GROWN_ZIP_URL          required
  CONFIG_DIR             default /config
  FETCH_TIMEOUT_SECONDS  default 180
"""

from __future__ import annotations

import io
import json
import os
import shutil
import sys
import time
import urllib.error
import urllib.request
import zipfile

PREFIX = "custom_components/grown/"
MAX_BYTES = 20 * 1024 * 1024


def log(msg: str) -> None:
    print(f"[grown-integration] {msg}", flush=True)


def download(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"Accept": "application/zip"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = resp.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError("bundle larger than 20 MiB")
    return data


def install(data: bytes, config_dir: str) -> str:
    """Validate the zip and atomically swap it into custom_components/grown."""
    zf = zipfile.ZipFile(io.BytesIO(data))
    names = [n for n in zf.namelist() if not n.endswith("/")]
    if PREFIX + "manifest.json" not in names:
        raise ValueError("bundle has no custom_components/grown/manifest.json")
    for name in names:
        # Only plain relative paths inside custom_components/grown/.
        if not name.startswith(PREFIX) or ".." in name.split("/") or name.startswith("/"):
            raise ValueError(f"unexpected path in bundle: {name!r}")
    manifest = json.loads(zf.read(PREFIX + "manifest.json"))
    if manifest.get("domain") != "grown":
        raise ValueError("bundle manifest is not the grown integration")

    target_parent = os.path.join(config_dir, "custom_components")
    os.makedirs(target_parent, exist_ok=True)
    staging = os.path.join(target_parent, ".grown.new")
    old = os.path.join(target_parent, ".grown.old")
    target = os.path.join(target_parent, "grown")
    for path in (staging, old):
        shutil.rmtree(path, ignore_errors=True)
    os.makedirs(staging)
    for name in names:
        dest = os.path.join(staging, name[len(PREFIX) :])
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "wb") as fh:
            fh.write(zf.read(name))
    if os.path.exists(target):
        os.rename(target, old)
    os.rename(staging, target)
    shutil.rmtree(old, ignore_errors=True)
    return str(manifest.get("version", "?"))


def main() -> int:
    url = os.environ.get("GROWN_ZIP_URL", "")
    if not url:
        log("GROWN_ZIP_URL not set; skipping")
        return 0
    config_dir = os.environ.get("CONFIG_DIR", "/config")
    timeout = int(os.environ.get("FETCH_TIMEOUT_SECONDS", "180"))
    deadline = time.monotonic() + timeout
    delay = 2.0
    attempt = 0
    while True:
        attempt += 1
        try:
            version = install(download(url), config_dir)
            log(f"installed grown integration {version} from {url}")
            return 0
        except urllib.error.HTTPError as err:
            if err.code == 404:
                log(f"{url} returned 404 (Grown older than 0.4?); starting HA without updating it")
                return 0
            reason = err
        except (urllib.error.URLError, OSError, TimeoutError) as err:
            reason = err
        except (ValueError, zipfile.BadZipFile) as err:
            # A bad bundle won't fix itself by retrying.
            log(f"invalid bundle from {url}: {err}; starting HA without updating it")
            return 0
        if time.monotonic() + delay > deadline:
            existing = os.path.exists(os.path.join(config_dir, "custom_components", "grown"))
            log(
                f"Grown not reachable at {url} after {attempt} attempts / {timeout}s ({reason}); "
                + ("starting HA with the previously installed integration"
                   if existing else "starting HA WITHOUT the grown integration")
                + " - it is fetched again on the next pod start"
            )
            return 0
        if attempt == 1 or attempt % 10 == 0:
            log(f"waiting for Grown ({reason})")
        time.sleep(delay)
        delay = min(delay * 1.5, 10.0)


if __name__ == "__main__":
    sys.exit(main())
