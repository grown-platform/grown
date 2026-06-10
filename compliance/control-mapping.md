# grown-workspace → NIST SP 800-53 Rev 5 (FedRAMP Moderate) Control Mapping

Human-readable companion to `oscal/component-definition.json`. Maps 800-53
control families to grown features, with file references and an honest status.

**Status legend:** ✅ implemented · 🟡 partial · ⛔ gap (see POA&M) · 🔵 inherited
(from the pick-gitops platform; not implemented in grown code)

> grown is **NOT authorized**. This table documents posture and gaps only.

---

## AC — Access Control

| Control                   | grown feature                                                                                            | Files                                                                                               | Status                        |
| ------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------- |
| AC-2 Account management   | User lifecycle delegated to Zitadel; grown mirrors identities                                            | `internal/auth/service.go` (UpsertByOIDC), `internal/users`                                         | 🟡 (no role model)            |
| AC-3 Access enforcement   | Every request carries resolved user+org; all repos scope by `org_id`                                     | `internal/auth/middleware.go`, `internal/audit/repository.go` (List scopes org), migrations `0002`+ | ✅                            |
| AC-4 Information flow     | Zitadel proxy restricts paths to `/v2/users/{self}/...`, strips caller cookie, swaps in PAT, bounds body | `internal/zitadelproxy/proxy.go`                                                                    | ✅                            |
| AC-6 Least privilege      | Privileged ops gated on `GROWN_ADMIN_EMAILS`; read-only admin open to members                            | `internal/admin/service.go` (`requireAdmin`), `internal/audit/handler.go`                           | 🟡 (open-when-empty fallback) |
| AC-7 Unsuccessful logon   | Lockout enforced upstream by Zitadel; grown returns generic errors                                       | Zitadel (upstream)                                                                                  | 🟡                            |
| AC-12 Session termination | Opaque sessions with `expires_at`/`revoked_at`; Lookup rejects expired/revoked; Logout revokes           | `internal/auth/session.go`, `internal/auth/service.go`                                              | ✅                            |
| AC-14 Actions w/o auth    | Only OIDC discovery + login handshake reachable unauthenticated                                          | `internal/server/server.go`                                                                         | ✅                            |

## AU — Audit & Accountability _(grown's strongest family)_

| Control                    | grown feature                                                                                                      | Files                                                                         | Status                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ---------------------------------------- |
| AU-2 Event logging         | Interceptor records every mutating RPC across all services; HTTP middleware wraps all binary routes                | `internal/audit/interceptor.go`, `middleware.go`, `internal/server/server.go` | ✅                                       |
| AU-3 Record content        | Each row: timestamp, actor id/email, service+action+method, resource type/id, status, ip, user-agent, JSONB detail | `internal/audit/repository.go`, migration `0037`                              | ✅                                       |
| AU-3(1) Additional content | gRPC code / HTTP status in `detail`; full method path                                                              | `internal/audit/interceptor.go`, `middleware.go`                              | ✅                                       |
| AU-4 Storage capacity      | Indexed Postgres storage; **no** retention/rotation/forwarding/alerting                                            | migration `0037`                                                              | 🟡 ⛔ `poam-retention`                   |
| AU-6 Review/analysis       | Admin-gated viewer with filters; manual/on-demand only, no alerting                                                | `internal/audit/handler.go`, web `app/admin`                                  | 🟡 ⛔ `poam-siem`                        |
| AU-9 Protect audit info    | Append-only by code convention (no Update/Delete path); admin-gated read                                           | `internal/audit/repository.go`                                                | 🟡 ⛔ `poam-retention` (not DB-enforced) |
| AU-11 Retention            | Events persist indefinitely; no defined retention period                                                           | migration `0037`                                                              | 🟡 ⛔ `poam-retention`                   |
| AU-12 Audit generation     | One central capability covers all services; cannot drift per-service                                               | `internal/server/server.go`, `internal/audit/interceptor.go`                  | ✅                                       |

## IA — Identification & Authentication

| Control                         | grown feature                                                               | Files                                                         | Status           |
| ------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------- |
| IA-2 User identification & auth | OIDC session required before any mutation                                   | `internal/auth/middleware.go`, `service.go`                   | ✅               |
| IA-2(1) MFA to privileged accts | TOTP/passkey **available** via proxy, **not enforced**                      | `internal/zitadelproxy/proxy.go`, web `components/security/*` | 🟡 ⛔ `poam-mfa` |
| IA-2(2) MFA to non-privileged   | Same — capable, not enforced                                                | same                                                          | 🟡 ⛔ `poam-mfa` |
| IA-4 Identifier management      | OIDC `sub` mirrored to `grown.users` w/ unique constraint                   | `internal/users`, migration `0002`                            | ✅               |
| IA-5 Authenticator management   | Self-scoped Zitadel User API v2 proxy; user manages only own authenticators | `internal/zitadelproxy/proxy.go` (`authorizeUserAccess`)      | ✅               |
| IA-5(1) Password-based auth     | Complexity/hashing/lockout enforced by Zitadel; grown stores no passwords   | Zitadel (upstream), `internal/auth/session.go`                | ✅               |
| IA-5(11) Hardware tokens        | FIDO2/WebAuthn passkeys; RP id forced to request host                       | `internal/zitadelproxy/proxy.go` (`injectPasskeyDomain`)      | ✅               |
| IA-8 Non-org users              | All identity federated to external OIDC IdP                                 | `internal/auth/oidc.go`                                       | ✅               |

## SC — System & Communications Protection

| Control                           | grown feature                                                              | Files                                                  | Status                               |
| --------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------ |
| SC-5 DoS protection               | Proxy bounds body + upstream timeout; no rate limiting/WAF in app          | `internal/zitadelproxy/proxy.go`                       | 🟡 ⛔ `poam-contingency`             |
| SC-7 Boundary protection          | No documented FW/NetworkPolicy/WAF for grown workload                      | —                                                      | ⛔ `poam-contingency`                |
| SC-8 Transmission confidentiality | TLS terminated at Gateway (cert-manager + Let's Encrypt); cookies `Secure` | pick-gitops (cert-manager), `internal/auth/config.go` | 🟡 🔵 (intra-cluster hop unverified) |
| SC-12 Key establishment/mgmt      | cert lifecycle automated via ACME                                          | pick-gitops (cert-manager)                            | ✅ 🔵                                |
| SC-13 Cryptographic protection    | AES-256-GCM KEK (PDF) + TLS, but **none FIPS-validated**                   | `pdf/backend/internal/crypto/keystore.go`              | 🟡 ⛔ `poam-fips`                    |
| SC-23 Session authenticity        | HttpOnly+Secure+SameSite cookies; 256-bit opaque token; CSRF state on OIDC | `internal/auth/session.go`, `service.go`               | ✅                                   |
| SC-28 Protection at rest          | No app-level encryption; depends on unattested disk encryption             | `internal/drive/blobs.go`, Postgres                    | 🟡 ⛔ `poam-rest`                    |

## CM — Configuration Management

| Control                  | grown feature                                                                   | Files                                                            | Status |
| ------------------------ | ------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------ |
| CM-2 Baseline config     | Declarative state in git + pinned image, reconciled by Flux; ordered migrations | `Dockerfile`, `internal/storage/migrate.go`, pick-gitops (Flux) | ✅     |
| CM-3 Change control      | Changes via git PR + Flux; no formal CCB                                        | pick-gitops                                                     | 🟡     |
| CM-6 Config settings     | Env config validated at startup, fails closed                                   | `internal/auth/config.go` (`Validate`)                           | ✅     |
| CM-7 Least functionality | Minimal alpine image, non-root uid 10001, two ports                             | `Dockerfile`                                                     | ✅     |

## SA — System & Services Acquisition

| Control                           | grown feature                                              | Files                     | Status                |
| --------------------------------- | ---------------------------------------------------------- | ------------------------- | --------------------- |
| SA-11/SA-15 Dev process & testing | Reproducible pinned builds; **no** SAST/dep-scan/SBOM gate | `Dockerfile`, `flake.nix` | 🟡 ⛔ `poam-vulnscan` |

## Families NOT meaningfully covered (gaps → POA&M)

| Family                                                                    | Status  | POA&M                              |
| ------------------------------------------------------------------------- | ------- | ---------------------------------- |
| **CA** Assessment & authorization (CA-7 continuous monitoring)            | ⛔      | `poam-siem`                        |
| **CP** Contingency planning (backup is inherited but unverified; no plan) | ⛔ 🔵   | `poam-contingency`                 |
| **IR** Incident response (no plan)                                        | ⛔      | `poam-contingency`                 |
| **RA** Risk assessment (RA-5 vuln scanning)                               | ⛔      | `poam-vulnscan` / `poam-siem`      |
| **SI** System & information integrity (SI-4 monitoring)                   | ⛔      | `poam-siem`                        |
| **PE/MA/MP/PS/AT** Physical, maintenance, media, personnel, training      | 🔵 / ⛔ | platform-inherited or undocumented |

---

## Summary

- **Genuinely strong:** AU (audit) — the cross-cutting interceptor + HTTP
  middleware + append-only table + admin viewer is a complete, uniform
  event-capture story. IA/AC identity — Zitadel OIDC, self-service MFA capability,
  revocable sessions, hardened cookies. AC isolation — pervasive `org_id` scoping.
- **Top gaps:** MFA not enforced (`poam-mfa`), no FIPS crypto (`poam-fips`), no
  continuous monitoring/SIEM (`poam-siem`), no encryption-at-rest attestation
  (`poam-rest`), no audit retention/immutability at the DB (`poam-retention`),
  no IR/CP/boundary docs (`poam-contingency`), coarse auth/no RBAC (`poam-rbac`).
