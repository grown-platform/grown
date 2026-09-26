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

Then run the e2e suite (`cd web/e2e && npx playwright test`). For screenshots,
run the visual tour: `GROWN_TOUR=1 npx playwright test tour.spec.ts`, which
writes `test-results/tour/*.png`.
