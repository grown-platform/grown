# Local stack without Nix

`deploy/process-compose` needs the Nix dev shell (postgres, zitadel,
process-compose). `deploy/local` gives you the same stack on any machine with
Docker, Go and Node. Postgres, Zitadel and rustfs run in containers; the Go
backend and the vite build run natively, so redeploying a change takes seconds.

```sh
deploy/local/stack.sh up                 # first boot: deps + OIDC app + build + backend
deploy/local/stack.sh deploy ../other-wt # rebuild web + backend from another worktree
deploy/local/stack.sh backend            # Go-only change: skip the web build
deploy/local/stack.sh status | logs | down
deploy/local/stack.sh nuke               # delete all local state
```

- App: http://workspace.localtest.me:8080, login `admin` / `DevPassword!1`.
  Zitadel is at http://localhost:8081.
- State lives in `$GROWN_LOCAL_DATA` (default `~/.grown-local`), shared by
  every worktree, so one stack can serve whichever branch you deploy.
- A worktree needs `gen/` (generated protos; `nix run .#gen`, or symlink it
  from a checkout that has it) and `web/app/node_modules`.
- The containers restart with Docker (`restart: unless-stopped`). If Docker
  Desktop restarts, or the disk fills up, run `stack.sh up` again.

### Optional LibreOffice import

Legacy `.doc`/`.xls`/`.ppt` import runs LibreOffice headless on the server
and is off by default. `stack.sh` passes your environment through to the
backend, so enable it per deploy:

```sh
GROWN_LIBREOFFICE=1 deploy/local/stack.sh backend
# optional: GROWN_SOFFICE_PATH=/path/to/soffice (default: PATH, then
# /Applications/LibreOffice.app), GROWN_LIBREOFFICE_ODF=1 to also route
# .odt/.ods/.odp/.rtf through LibreOffice
```

`web/e2e/docs-legacy-doc.spec.ts` needs a backend started this way (it skips
otherwise).

Then run the e2e suite (`cd web/e2e && npx playwright test`). For screenshots,
run the visual tour: `GROWN_TOUR=1 npx playwright test tour.spec.ts`, which
writes `test-results/tour/*.png`.

## Testing a frontend branch without redeploying

Several people or agents can share one stack. Serve your worktree's frontend
from vite on its own port; it proxies `/api` (including the collab
WebSockets) to the backend on :8080:

```sh
cd web/app && npx vite --port 5181 --strictPort --host workspace.localtest.me
cd web/e2e && npx playwright test auth.setup.ts            # log in via :8080
GROWN_HTTP_URL=http://workspace.localtest.me:5181 npx playwright test sheets.spec.ts --no-deps
```

The OIDC callback always returns to :8080, so log in there first. The
session cookie is shared across ports. `--no-deps` skips re-running the
login against the vite port. Known gap: Docs' Yjs collab can misbehave under
the vite dev build, so check Docs persistence on a real deploy
(`stack.sh deploy`).
