# OSCAL Profiles

These are **thin profile selectors**. They `import` the upstream control
baselines by URL rather than vendoring the full catalogs (which are large and
maintained elsewhere). A profile-resolution tool (e.g. `oscal-cli profile
resolve`) dereferences the `imports[].href` to produce a resolved catalog.

| File                    | Imports                                                 | Status of source                                                                                                                                                                                                                                           |
| ----------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fedramp-moderate.json` | GSA FedRAMP Rev 5 **Moderate** baseline profile         | **Official** (GSA/fedramp-automation). Canonical path per FedRAMP docs, but live reachability was NOT confirmed from the authoring environment (404 on fetch — likely a network/redirect limitation). Verify before use. Resolves to NIST SP 800-53 Rev 5. |
| `nist-800-171.json`     | NIST SP **800-171 Rev 2** catalog (for CMMC v2 Level 2) | **Community-maintained** (FATHOM5). See caveat below.                                                                                                                                                                                                      |

## Source URLs (with reachability checked from the authoring environment)

- **FedRAMP Moderate (Rev 5):** ⚠️ **NOT confirmed reachable here** (404 on
  fetch + repo API 404 — likely a network-egress restriction in this
  environment, or FedRAMP relocated the asset). This is the path cited across
  FedRAMP/GSA documentation; **verify and pin to a release tag before use**:
  `https://raw.githubusercontent.com/GSA/fedramp-automation/master/dist/content/rev5/baselines/json/FedRAMP_rev5_MODERATE-baseline_profile.json`
  — repo: <https://github.com/GSA/fedramp-automation> · portal:
  <https://automate.fedramp.gov/>

- **NIST 800-53 Rev 5 catalog** ✅ **verified HTTP 200** (transitively imported
  by the FedRAMP profile, and cited as `source` in the component-definition —
  the actual control catalog the mappings resolve against):
  `https://raw.githubusercontent.com/usnistgov/oscal-content/main/nist.gov/SP800-53/rev5/json/NIST_SP-800-53_rev5_catalog.json`

- **NIST 800-171 Rev 2 catalog (community / FATHOM5)** ✅ **verified HTTP 200**:
  `https://raw.githubusercontent.com/FATHOM5/oscal/main/content/SP800-171/oscal-content/catalogs/NIST_SP-800-171_rev2_catalog.json`

- **NIST 800-171 Rev 3 catalog (official, alternative)** ✅ **verified HTTP 200**:
  `https://raw.githubusercontent.com/usnistgov/oscal-content/main/nist.gov/SP800-171/rev3/json/NIST_SP800-171_rev3_catalog.json`

## ⚠️ 800-171 sourcing caveat

NIST's **official** OSCAL content repo (`usnistgov/oscal-content`) publishes only
**Rev 3** of 800-171 in OSCAL format — there is **no NIST-official Rev 2 OSCAL
catalog**. CMMC v2 Level 2 assessments, however, still reference **Rev 2**. We
therefore import a **community-maintained Rev 2** OSCAL catalog (FATHOM5),
verified to resolve and parse as a valid OSCAL `catalog` (oscal-version 1.0.0).

If you prefer the NIST-official Rev 3 catalog (different family numbering), use:
`https://raw.githubusercontent.com/usnistgov/oscal-content/main/nist.gov/SP800-171/rev3/json/NIST_SP800-171_rev3_catalog.json`

## Validation

The imported source URLs were checked for reachability/parse-ability, but the
**resolved** profiles were **not** run through `oscal-cli profile resolve` or a
schema validator in this environment. Validate before use.
