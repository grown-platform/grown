# Grown Workspace — end-to-end tests

Playwright tests that drive the real app (browser + backend + auth + collab)
against a locally-running dev stack.

## What's covered

| Spec | Project | Covers |
| --- | --- | --- |
| `health.spec.ts` | standalone | `/healthz` shape |
| `auth.spec.ts` | standalone | full OIDC login → whoami → logout |
| `auth.setup.ts` | setup | logs in once, saves `storageState` for the rest |
| `dashboard.spec.ts` | authed | sign-in screen + tile catalog |
| `drive.spec.ts` | authed | upload → preview → trash |
| `docs.spec.ts` | authed | **collab reload-persistence**, footnotes, headers/footers persistence, suggesting mode |
| `sheets.spec.ts` | authed | server-side formula engine (SUM/LAMBDA/array/text) + UI reopen |

The **authed** project reuses a shared signed-in session (`storageState`), so
specs start authenticated and the collaboration WebSocket connects normally —
that's what makes reload-persistence genuinely testable.

## Running

1. Bring up the dev stack (Postgres, Zitadel + provisioned `admin` user, rustfs,
   the Go backend on `:8080`, and a vite build):

   ```sh
   cd deploy/process-compose
   process-compose up        # wait until the `backend` service is healthy
   ```

   The stack serves the app at `http://workspace.localtest.me:8080` and Zitadel
   at `http://localhost:8081`. The seeded login is `admin` / `DevPassword!1`.

2. Install and run the tests:

   ```sh
   cd web/e2e
   npm install
   npx playwright install chromium     # one-time browser download
   npm test                            # or: npx playwright test
   ```

   Override the target with `GROWN_HTTP_URL` (e.g. to point at a staging URL
   that also has the seeded user).

## Notes

- `npx playwright test --list` validates the specs and config without a running
  stack — useful in CI lint steps.
- Failures retain a trace (`trace: retain-on-failure`); open with
  `npx playwright show-trace <trace.zip>`.
- Specs create their fixtures (docs/sheets) via the JSON API and trash them in a
  `finally`, so they're self-cleaning and safe to re-run.
- Adding a new app's spec: name it `<app>.spec.ts`; it runs in the **authed**
  project automatically and can use the helpers in `helpers.ts`.
