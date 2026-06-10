# grown-workspace → CMMC v2 Level 2 / NIST SP 800-171 Rev 2 Mapping

CMMC v2 **Level 2** is a 1:1 map to the **110 practices** of **NIST SP 800-171
Rev 2**, organized into **14 families**. This table gives grown's status per
family. Detailed 800-53 mappings (which share the same controls) are in
`control-mapping.md`; per-requirement `control-171` tags are in
`oscal/component-definition.json`.

**Status:** ✅ mostly implemented · 🟡 partial · ⛔ gap · 🔵 inherited/undocumented

> grown is **NOT CMMC-certified** and has produced **no 800-171 self-assessment
> or SPRS score** (gap `poam-171ssp`). It processes no CUI today.

| #    | Family (reqs)                               | grown status | Evidence / gap                                                                                                                                                                                                                                                                                                            |
| ---- | ------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1  | **Access Control** (22)                     | 🟡           | Per-request user+org resolution and pervasive `org_id` scoping (3.1.1/3.1.2 ✅); session termination (3.1.11 ✅); flow control in the Zitadel proxy (3.1.3 ✅). Gaps: no least-privilege RBAC (3.1.5 — `poam-rbac`), lockout inherited from Zitadel (3.1.8 🟡), no documented remote-access/separation-of-duties (3.1.4). |
| 3.2  | **Awareness & Training** (3)                | ⛔           | No security awareness or role-based training program for a homelab.                                                                                                                                                                                                                                                       |
| 3.3  | **Audit & Accountability** (9)              | ✅🟡         | **Strongest area.** Central audit capture across all services (3.3.1 ✅), full record content (3.3.2 ✅), admin review (3.3.3 🟡 manual). Gaps: retention/capacity (3.3.4 — `poam-retention`), DB-enforced immutability (3.3.8 — `poam-retention`), no time-sync attestation (3.3.7).                                     |
| 3.4  | **Configuration Management** (9)            | 🟡           | GitOps declarative baseline (3.4.1 ✅), minimal runtime/least-functionality (3.4.6/3.4.7 ✅), startup config validation (3.4.2 🟡). Gaps: no documented change-control board (3.4.3), no inventory/allowlist policy docs.                                                                                                 |
| 3.5  | **Identification & Authentication** (11)    | 🟡           | OIDC identification (3.5.1 ✅), authenticator management via self-scoped proxy (3.5.2 ✅), unique identifiers (3.5.5 ✅), Zitadel password policy (3.5.7 ✅). Key gap: **MFA not enforced** (3.5.3 — `poam-mfa`).                                                                                                         |
| 3.6  | **Incident Response** (3)                   | ⛔           | No IR plan, no reporting/handling process (`poam-contingency`). Audit trail would _support_ IR but no plan exists.                                                                                                                                                                                                        |
| 3.7  | **Maintenance** (6)                         | 🔵           | Inherited from the cluster/platform; not documented for grown.                                                                                                                                                                                                                                                            |
| 3.8  | **Media Protection** (9)                    | 🟡           | Blob/object media access is audited (3.8.2 via audit `Log()`). Gaps: no at-rest media encryption attestation (3.8.x — `poam-rest`), no media sanitization/marking policy.                                                                                                                                                 |
| 3.9  | **Personnel Security** (2)                  | 🔵⛔         | No screening/termination process documented (homelab).                                                                                                                                                                                                                                                                    |
| 3.10 | **Physical Protection** (6)                 | 🔵           | Inherited from the hosting facility/cluster; out of grown's boundary.                                                                                                                                                                                                                                                     |
| 3.11 | **Risk Assessment** (3)                     | ⛔           | No vulnerability scanning or risk-assessment process (3.11.2 — `poam-vulnscan`).                                                                                                                                                                                                                                          |
| 3.12 | **Security Assessment** (4)                 | 🟡           | **This documentation set** is the first control-assessment + POA&M (3.12.2/3.12.4). No continuous assessment (3.12.3 — `poam-siem`).                                                                                                                                                                                      |
| 3.13 | **System & Communications Protection** (16) | 🟡           | TLS in transit (3.13.8 🟡 inherited), session authenticity / hardened cookies (3.13.x ✅), AES-256-GCM for PDF keys (3.13.11 🟡). Gaps: **non-FIPS crypto** (3.13.11 — `poam-fips`), no boundary protection docs (3.13.1 — `poam-contingency`), no at-rest encryption attestation (3.13.16 — `poam-rest`).                |
| 3.14 | **System & Information Integrity** (7)      | ⛔🟡         | No flaw-remediation pipeline / vuln scanning (3.14.1 — `poam-vulnscan`), no monitoring/IDS (3.14.6 — `poam-siem`). Reproducible minimal image helps but is not integrity monitoring.                                                                                                                                      |

---

## Summary

- **Well-covered (for the system's stage):** 3.3 Audit & Accountability, much of
  3.1 Access Control, the implemented half of 3.5 Identification &
  Authentication, and 3.4 Configuration Management (GitOps).
- **Hard gaps blocking CMMC L2:** MFA enforcement (3.5.3), FIPS-validated
  cryptography (3.13.11), continuous monitoring / vuln scanning (3.11/3.14),
  encryption-at-rest attestation (3.13.16), incident response (3.6), audit
  retention/immutability (3.3.4/3.3.8), and — procedurally — the absence of any
  800-171 self-assessment or **SPRS** submission (`poam-171ssp`).
- **Inherited/out-of-boundary families** (3.7 Maintenance, 3.9 Personnel, 3.10
  Physical) would be satisfied at the platform/organizational layer, not in
  grown's code, and are undocumented here.

See `oscal/poam.json` for the remediation plan tied to each gap.
