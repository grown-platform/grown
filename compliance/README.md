# grown-workspace Compliance Documentation

This directory documents the security posture of **grown-workspace** against two
U.S. federal compliance frameworks, expressed as machine-readable
[OSCAL](https://pages.nist.gov/OSCAL/) artifacts plus human-readable control
mappings. It is a **documentation + gap-analysis** effort, not an authorization
package.

---

## ⚠️ Authorization status: NOT AUTHORIZED

> grown-workspace is a homelab / development system. It has **NO** Authority to
> Operate (ATO), **NO** FedRAMP authorization, and **NO** CMMC certification. It
> does not currently process Federal Contract Information (FCI), Controlled
> Unclassified Information (CUI), or any federal data.
>
> The artifacts here describe what grown **actually implements today** and
> **honestly enumerate the gaps** that would have to be closed before any
> authorization could be pursued. Nothing in this directory should be read as a
> claim of compliance. Where a control is only partially met, it is marked
> `partial`; where it is unmet, it lives in the POA&M. Overclaiming is treated
> as a defect.

---

## Frameworks in scope

| Framework   | Baseline | Underlying catalog                                 | Notes                                                                                    |
| ----------- | -------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **FedRAMP** | Moderate | NIST SP 800-53 Rev 5                               | Cloud-service-provider baseline (~325 controls). We document the subset grown addresses. |
| **CMMC v2** | Level 2  | NIST SP 800-171 Rev 2 (110 practices, 14 families) | DoD contractor baseline for protecting CUI. Level 2 is a 1:1 map to 800-171 Rev 2.       |

Both frameworks share NIST control DNA, so a single set of grown components maps
to controls in both. The FedRAMP / 800-53 mapping is the primary artifact; the
800-171 / CMMC mapping is derived from it (see `cmmc-l2-mapping.md`).

NIST SP 800-171 **Rev 3** (final, May 2024) exists and reorganizes the families,
but CMMC v2 Level 2 assessments still reference **Rev 2**, so this documentation
targets Rev 2.

---

## What is OSCAL?

The **Open Security Controls Assessment Language** (OSCAL) is a NIST-maintained
set of machine-readable formats (JSON/XML/YAML) for security documentation. It
replaces prose-and-spreadsheet compliance with structured, diff-able,
tool-validatable data. The models used here:

| OSCAL model                               | File                              | Purpose                                                                                                                                           |
| ----------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **component-definition**                  | `oscal/component-definition.json` | Reusable building blocks. Each grown component (Auth, Audit, Postgres, …) declares which controls it satisfies and how, citing implementing code. |
| **system-security-plan (SSP)**            | `oscal/ssp.json`                  | The system as a whole: characteristics, impact level, authorization boundary, and per-control implementation statements.                          |
| **plan-of-action-and-milestones (POA&M)** | `oscal/poam.json`                 | The gaps: unmet / partial controls with risk and planned remediation. **The most important artifact.**                                            |
| **profile**                               | `oscal/profiles/*.json`           | Thin selectors that `import` the upstream FedRAMP Moderate and 800-171 baselines by URL (we do not vendor the full catalogs).                     |

How they relate:

```
profiles/fedramp-moderate.json ──imports──▶ GSA FedRAMP Moderate baseline (upstream)
profiles/nist-800-171.json      ──imports──▶ NIST 800-171 catalog (upstream)
            ▲
            │ import-profile
            │
        ssp.json ──references──▶ component-definition.json (control implementations)
            │
            ▼
        poam.json (gaps against the same controls)
```

---

## Files

```
compliance/
├── README.md                  ← you are here
├── control-mapping.md         ← human-readable 800-53 family → grown feature → status
├── cmmc-l2-mapping.md         ← 14 CMMC L2 / 800-171 families → grown status
└── oscal/
    ├── component-definition.json
    ├── ssp.json
    ├── poam.json
    └── profiles/
        ├── fedramp-moderate.json
        ├── nist-800-171.json
        └── README.md
```

---

## Where grown is strong vs. where it is weak

**Strong (well-implemented):**

- **AU — Audit & Accountability.** A cross-cutting audit subsystem
  (`internal/audit`) records every _mutating_ gRPC RPC across all services via a
  unary interceptor, plus all binary upload/download/stream routes via HTTP
  middleware, into an append-only `grown.audit_events` table (org-scoped,
  indexed, with actor/IP/user-agent/method/status), surfaced through an
  admin-gated viewer. This is the standout control story.
- **IA / AC — Identity & Access.** All authentication delegates to **Zitadel
  OIDC** (`internal/auth`). Self-service MFA (TOTP, passkeys/FIDO2, password) is
  exposed in-app via a narrowly-scoped Zitadel User API v2 proxy
  (`internal/zitadelproxy`). Opaque, revocable, expiring server-side sessions
  (`internal/auth/session.go`); host-only / `Secure` / `HttpOnly` cookies.
- **AC / SC — Multi-tenancy isolation.** Every domain table carries `org_id`;
  every repository scopes by it; the request's org is resolved into context and
  audit rows without an org are dropped.

**Weak / gaps (see POA&M):**

- **MFA is _capable_ but not _enforced_ org-wide** (AC-2 / IA-2 partial).
- **No FIPS 140-validated crypto module** — TLS and the PDF KEK use Go stdlib /
  Let's Encrypt, none FIPS-validated (SC-13).
- **No continuous monitoring, vuln scanning, or SIEM** (CA-7 / RA-5 / SI-4).
- **No encryption-at-rest attestation** for Postgres or the blob store (SC-28).
- **No log retention / forwarding policy** for audit data (AU-4 / AU-11).
- **No formal IR / contingency-plan / boundary-protection documentation**
  (IR-_ / CP-_ / SC-7).
- **Tenancy is single-org _in practice_** — multi-org routing is stubbed.

See `oscal/poam.json` and the two `*-mapping.md` files for the full picture.

---

## Validation caveat

These OSCAL JSON files were **hand-authored against the OSCAL 1.1.x JSON schema**
and have **not** been run through an automated validator (`oscal-cli validate`,
compliance-trestle, or the NIST Metaschema validator) in this environment. The
structure mirrors the established OSCAL component-definitions in the sibling
`pick-gitops/oscal/` repo (upgraded from their `oscal-version: 1.0.4` to
`1.1.3`). Before relying on them, run:

```bash
oscal-cli component-definition validate oscal/component-definition.json
oscal-cli ssp  validate                 oscal/ssp.json
oscal-cli poam validate                 oscal/poam.json
oscal-cli profile validate              oscal/profiles/fedramp-moderate.json
```

All UUIDs are **fixed, well-formed placeholder UUIDs** (the authoring
environment cannot generate randomness). Regenerate them with real random UUIDs
before any formal submission.

**Source-URL reachability** (checked from the authoring environment):

- ✅ NIST SP 800-53 Rev 5 catalog (the `source` cited throughout the
  component-definition) — verified HTTP 200.
- ✅ NIST SP 800-171 Rev 2 (community/FATHOM5) and Rev 3 (official) catalogs —
  verified HTTP 200.
- ⚠️ The GSA FedRAMP Moderate baseline profile URL could **not** be confirmed
  reachable here (404 / network-egress restriction). It is the canonical path
  per FedRAMP documentation but **must be verified before use**. See
  `oscal/profiles/README.md`.
