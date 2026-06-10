# PDF (editor & sign) integration — pdf → grown-workspace

**Status:** In progress (foundation landed)
**Date:** 2026-06-09
**Decision:** Co-locate with **shared infra**, **copy** the tree (no upstream git history).

## Goal

Bring the **pdf** document-signing platform (module `code.pick.haus/grown/pdf`)
into the grown-workspace suite as the **PDF** app — a full PDF **editor + importer + signer**
surfaced under the dashboard "PDF" tile and Drive's PDF-open route.

## What was copied

`pdf/` → `grown-workspace/pdf/` (1.9 MB, excludes `.git`/`node_modules`/build artifacts):

- `pdf/backend/` — Go (`pdf`): `internal/{auth,crypto,database,email,handler,mtls,pdf,sig,sqlc,storage}`,
  gRPC+HTTP, PAdES signatures, X.509, PKCS#11, mTLS. sqlc + Postgres.
- `pdf/frontend/` — React 19 + Vite 6 (`react-pdf`/`pdf-lib`/`jspdf`): documents (PdfTextEditor,
  Create/Edit/Prepare/Detail pages), signing pages, admin.
- `pdf/{native-signer,extension,nginx,nix,certs,scripts}`, `pdf/flake.nix`, `pdf/process-compose.yaml`.

## Architecture (shared infra)

pdf and grown share the **same stack** (grown org, Go+gRPC+grpc-gateway, Zitadel, RustFS,
Postgres, process-compose, flake) — pdf just used different ports to avoid sibling conflicts.
We reconcile it to share grown's single instances:

| Concern  | pdf default                    | grown shared target                              |
| -------- | ---------------------------------- | ------------------------------------------------ |
| Postgres | `:5433` db `pdf`               | grown `:5533`, **own db** `pdf`            |
| RustFS   | `:9020` bucket `pdf-documents` | grown `:9100`, **own bucket** `pdf-docs`   |
| Zitadel  | `:8094`                            | grown `:8081`, **own OIDC app** (SSO)            |
| Backend  | `:8085` HTTP / `:50053` gRPC       | keep `:8085`/`:50053` (no grown conflict)        |
| Frontend | `:5173` (Vite)                     | served + **reverse-proxied** under grown `/pdf/` |

## Plan / status

1. ✅ Copy tree → `pdf/`.
2. ✅ Dashboard **PDF** tile (single tile, `externalUrl` → `/pdf/`).
3. ✅ **process-compose**: added `pdf-createdb` (db `pdf`), `pdf-bucket-init`
   (bucket `pdf-docs`), `pdf-zitadel-app` (own OIDC app), `pdf-backend`
   (shared Postgres/RustFS/Zitadel), `pdf-frontend` (Vite under `/pdf/`).
4. ✅ **Reverse proxy**: grown backend proxies `/pdf/*` → pdf-frontend and
   `/pdf-api/*` (prefix stripped) → pdf-backend (`httputil.ReverseProxy`), bypassing
   grown's auth middleware. Env: `GROWN_PDF_FRONTEND_URL` / `GROWN_PDF_BACKEND_URL`.
5. ✅ **SSO**: `create-pdf-oidc-app.sh` provisions a pdf OIDC app in
   grown's Zitadel; pdf-backend authenticates against the same issuer. The OAuth
   callback/frontend URLs come back through grown's origin (`/pdf-api/auth/*`, `/pdf/`).
6. ⏳ Verify end-to-end through the proxy: open `/pdf/` → login (grown Zitadel) →
   import → edit → sign. **Backend boot verified** against shared infra (migrations,
   storage, OIDC, OAuth routes, `/health` ok); proxy + frontend pending a stack reload.

### Verified (2026-06-09)

- pdf backend boots against grown's Postgres (db `pdf`, goose migrations
  applied), RustFS (bucket `pdf-docs`), and OIDC against grown's Zitadel
  (issuer `:8081`, dedicated client). `/health` → `ok`; OAuth routes registered.
- **Fix:** `PDF_MTLS_PROXY_MODE=false` in dev (true requires a proxy shared secret).
- Frontend deps install (`tibui` tarball resolves), Vite present.

## Notes / risks

- React **19** (pdf frontend) vs **18** (grown web/app) — they stay **separate SPAs**; the PDF
  app is proxied, not merged into web/app. Acceptable: it's its own surface under `/pdf/`.
- The pdf-backend needs its KEK + (optional) signing certs; dev defaults exist in its config.
- mTLS/nginx (HTTPS 8443) is for production cert-based signing; dev can run proxy-mode without it.
- Full "feels like one product" SSO + proxy is the substantial remaining work (steps 3–6).
