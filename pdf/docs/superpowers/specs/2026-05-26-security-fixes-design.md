# Security fixes design — Vulns 1–4

**Status:** Approved — ready for implementation plan
**Branch:** `fix/security-fixes`
**Scope:** Fix the four high-confidence vulnerabilities identified by the 2026-05-26 security review. Rename to `pdf` and agility/effects integration are explicitly out of scope and will be handled in follow-on branches.

## Vulnerabilities being fixed

| #   | File                                                                                            | Category                      | Summary                                                                                                                        |
| --- | ----------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `backend/internal/handler/documents.go:491-554`                                                 | IDOR / token leak             | `ListDocumentsToSign` returns guest `access_token` for any email passed in the request body                                    |
| 2   | `backend/internal/auth/oauth.go:75, 83-140`                                                     | OAuth login CSRF              | OIDC `state` is the literal string `"pdf-state"`; never validated; no nonce                                                |
| 3   | `backend/internal/mtls/mtls.go:161-313`                                                         | Spoofable mTLS identity       | `ProxyMode` trusts `X-SSL-Client-*` headers without authenticating the proxy                                                   |
| 4   | `backend/internal/handler/signing.go:768-878` + `backend/internal/handler/documents.go:715-835` | Signature verification bypass | `CompleteSignature` stores client-supplied signature+cert without verification; `VerifyDocument` hard-codes `sigValid := true` |

## Cross-cutting mechanism: proxy auth

Both Vuln 1 and Vuln 3 depend on the same primitive — a shared-secret header that authenticates the reverse proxy to the backend. Implement it once.

### `mtls.proxy_shared_secret`

- New config key `mtls.proxy_shared_secret` (env: `PDF_MTLS_PROXY_SHARED_SECRET`).
- Minimum length 32 characters. Server refuses to start if `mtls.proxy_mode=true` and the secret is empty or shorter than 32 characters.
- The proxy sends `X-Proxy-Auth: <secret>` on every request.
- Backend middleware checks `X-Proxy-Auth` with `subtle.ConstantTimeCompare`.

### Header-stripping middleware

A single middleware runs as the outermost layer of the HTTP server when `ProxyMode=true`:

1. Unconditionally strip every inbound `X-SSL-Client-*`, `X-User-*`, and `X-Proxy-Identity-*` header from `r.Header` _before_ anything else reads them.
2. Read `r.Header.Get("X-Proxy-Auth")`. Constant-time compare to configured secret.
3. On mismatch: 401, populate no identity. Subsequent handlers see no proxy headers.
4. On match: copy the proxy-supplied request body headers (which only the proxy could have set, since we just cleared them) into a context value `ProxyIdentity{Email, ClientCert, ClientDN, ClientSerial}`.

After this middleware, the rest of the application reads identity from the context only — never from headers directly.

## Vuln 1 — `ListDocumentsToSign` token leak

### Changes

**`backend/internal/handler/documents.go`**

- Remove `email := req.Email` and the `lpick@pick.haus` fallback (lines 491-497).
- Read email from `ProxyIdentity` in the request context (populated by the new middleware).
- If no `ProxyIdentity` is present (proxy auth missing or failed), return `codes.Unauthenticated`.
- If `ProxyIdentity.Email` is empty, return `codes.Unauthenticated`.
- Query signers by the verified email. Only return rows where `signer.email == ProxyIdentity.Email` (case-insensitive). Continue to return `signing_url` for those matches.

**`backend/api/proto/documents.proto`**

- Mark `ListDocumentsToSignRequest.email` as `[deprecated = true]`. Do not remove the field (gRPC ABI stability) but stop reading it.

### Tests

- Request with no `X-Proxy-Auth` → 401.
- Request with valid `X-Proxy-Auth` and `X-User-Email: a@b` returns only documents whose signer.email is `a@b`.
- Request with `email` in body but a different `X-User-Email` returns documents for `X-User-Email` only — the body field is ignored.

## Vuln 2 — OAuth state + nonce

### Changes

**`backend/internal/auth/oauth.go`**

- `LoginHandler`:
  - Generate `state` via 32 random bytes from `crypto/rand`, URL-base64-encoded.
  - Generate `nonce` the same way.
  - Set a `pdf_oauth_state` cookie: `Value = state + ":" + nonce`, `HttpOnly`, `Secure`, `SameSite=Lax`, `MaxAge=600`, `Path=/auth/callback`.
  - Build the authorization URL with both `state` and `nonce` parameters (use `oauth2.AccessTypeOnline` and `oidc.Nonce(nonce)`).
- `CallbackHandler`:
  - Read `pdf_oauth_state` cookie. If missing → 400.
  - Split into `state | nonce`. Delete the cookie on the response (set `MaxAge=-1`).
  - Compare cookie state to `r.URL.Query().Get("state")` with `subtle.ConstantTimeCompare`. Mismatch → 400.
  - After exchanging the code, configure the verifier with the expected nonce and verify the ID token. Reject if `IDToken.Nonce != nonce`.

### Tests

- Login → callback with matching state+nonce → session cookie set.
- Login → callback with mismatched state → 400, no cookie set.
- Login → callback with no state cookie → 400.
- Login → callback with valid state but ID-token nonce missing → 400.

## Vuln 3 — Proxy header trust

### Changes

**`backend/internal/config/config.go`**

- Add `ProxySharedSecret string` to `MTLSConfig` (env: `PDF_MTLS_PROXY_SHARED_SECRET`).
- Validation in `Load`: if `ProxyMode=true` then `len(ProxySharedSecret) >= 32` characters required.

**`backend/internal/mtls/mtls.go`**

- Replace the existing ProxyMode middleware with the two-phase one described in "Cross-cutting mechanism" above.
- Identity extraction (`extractFromProxyHeaders`) only runs once we know the request is from the authenticated proxy.
- Remove identity-extraction code paths that read directly from `r.Header` outside the middleware.

**`backend/cmd/server/main.go`**

- Wire the proxy-auth middleware as the outermost HTTP middleware on the `/api/*` and `/auth/*` routes when `mtls.proxy_mode=true`.

### Tests

- ProxyMode=true, request with no `X-Proxy-Auth` → 401, no identity in audit trail.
- ProxyMode=true, request with bad `X-Proxy-Auth` → 401.
- ProxyMode=true, request with good `X-Proxy-Auth` and spoofed `X-SSL-Client-DN`: only the proxy's view of that header is used (verify by setting it on inbound and confirming it's stripped before re-population — this requires the test proxy to also set it).
- Server refuses to start with `proxy_mode=true` and empty `proxy_shared_secret`.

## Vuln 4 — Real signature verification

### Trust anchor

- New config `signing.trusted_ca_bundle_path` (env: `PDF_SIGNING_TRUSTED_CA_BUNDLE_PATH`).
- File is a PEM bundle of root CAs. Loaded once at startup into `*x509.CertPool` stored on the handler.
- Server refuses to start if `signing.browser_extension_enabled=true` and the bundle is missing, unreadable, or contains zero certs.
- In dev: bundle includes the internal CA from `backend/internal/crypto/ca.go`. In prod: bundle is the DoD root CA bundle (operator-supplied).

### Identity binding

- After chain verification, extract email candidates:
  - Every entry in `cert.EmailAddresses` (RFC 5280 SAN rfc822Name).
  - Subject `emailAddress` attribute (OID 1.2.840.113549.1.9.1) if present.
- Case-insensitive compare against `signer.email`. Accept on any match; reject otherwise.

### `CompleteSignature` (write path)

Rewrite of the verification block in `backend/internal/handler/signing.go:CompleteSignature`:

```
1. sigBytes  := base64-decode(req.Signature)        // fail → InvalidArgument
2. certBytes := base64-decode(req.Certificate)      // fail → InvalidArgument
3. cert, err := x509.ParseCertificate(certBytes)    // fail → InvalidArgument
4. _, err := cert.Verify(x509.VerifyOptions{
       Roots:       h.trustedCAPool,
       CurrentTime: time.Now(),
       KeyUsages:   []x509.ExtKeyUsage{x509.ExtKeyUsageAny},
   })                                                // fail → PermissionDenied
5. emails := append(cert.EmailAddresses, subjectEmailAttr(cert)...)
   if !containsCI(emails, signer.Email) → PermissionDenied
6. pending, err := h.q.GetPendingSignature(ctx, signatureId)  // fail → FailedPrecondition
   if pending.SignerID != signer.ID                            → PermissionDenied
   if pending.ExpiresAt < now                                  → FailedPrecondition
7. sigAlgo := mapHashAlgoToX509(pending.HashAlgorithm, cert.PublicKeyAlgorithm)
   if err := cert.CheckSignature(sigAlgo, pending.Hash, sigBytes) → PermissionDenied
8. Persist signature_data (raw sigBytes), certificate_chain (cert DER + any intermediates supplied),
   certificate_issuer (cert.Issuer.String()), certificate_serial (cert.SerialNumber.String()).
9. Delete or mark consumed the pending row to enforce single-use.
```

`mapHashAlgoToX509` covers SHA256/SHA384/SHA512 × RSA/ECDSA based on `cert.PublicKeyAlgorithm`. Reject unsupported combinations with `InvalidArgument`.

The TODO comments at signing.go:803-805 are removed.

### `VerifyDocument` (read path)

Replace the `sigValid := true` block in `backend/internal/handler/documents.go:VerifyDocument`:

For each row in `signatures` for the document:

1. Parse `certificate_chain` back into `*x509.Certificate`.
2. Verify chain against current trust bundle. Capture `valid_at_signing` from stored timestamps if available; `valid_now` is the result of this verify.
3. Recompute the document content hash from the stored PDF in S3 using the same algorithm recorded at signing time.
4. Verify `signature_data` against the recomputed hash using `cert.CheckSignature(...)`.
5. Set `sig_valid = chain_ok_at_signing && hash_matches && signature_valid`.
6. Set `hash_matches = recomputed == stored`.
7. Set `cert_valid_now` separately so the UI can distinguish "signature is genuine but cert has since expired" from "signature is invalid".

The hard-coded `sigValid := true` (documents.go:777) and `HashMatches: true` (documents.go:804) are deleted.

### Tests

Write-path:

- Valid cert + valid signature + matching email → 200, signer marked signed.
- Cert not chaining to bundle → `PermissionDenied`.
- Cert chains but email doesn't match signer → `PermissionDenied`.
- Cert + email valid but signature is garbage → `PermissionDenied`.
- Cert valid but `signatureId` belongs to a different signer → `PermissionDenied`.
- Pending row expired → `FailedPrecondition`.
- Replay: submit same `signatureId` twice → second call rejected.

Read-path:

- Doc with a real verified signature → `valid: true, hashMatches: true`.
- Doc whose stored PDF was tampered with (mutate one byte in test S3) → `hashMatches: false, valid: false`.
- Doc whose cert is now expired but was valid at signing → `valid: true, certValidNow: false`.

## Out of scope (explicitly deferred)

| Item                              | Why deferred                                                                           |
| --------------------------------- | -------------------------------------------------------------------------------------- |
| Zitadel full integration          | Separate, larger effort tracked in CLAUDE.md TODO                                      |
| Renaming pdf → pdf      | Separate follow-on branch per session sequencing decision                              |
| Agility/effects → API integration | Separate follow-on branch; needs the rename to land first                              |
| `org_default` multi-tenancy       | Larger architectural change                                                            |
| Vuln 5 (filename path traversal)  | Confirmed low impact today (no auth, UUID docID); will be sanitized in the rename pass |
| CSRF on cookie-auth endpoints     | Becomes load-bearing once Zitadel is fully wired                                       |

## Config surface added

```yaml
mtls:
  proxy_mode: true
  proxy_shared_secret: "<32+ byte random string>" # NEW — required when proxy_mode=true

signing:
  browser_extension_enabled: true
  trusted_ca_bundle_path: "/etc/pdf/trusted-cas.pem" # NEW — required when browser_extension_enabled=true
```

Env equivalents: `PDF_MTLS_PROXY_SHARED_SECRET`, `PDF_SIGNING_TRUSTED_CA_BUNDLE_PATH`.

## Deployment notes (handoff for the operator)

- Generate `proxy_shared_secret` with `head -c 32 /dev/urandom | base64`.
- Configure the same value on the reverse proxy (e.g., nginx `proxy_set_header X-Proxy-Auth "<secret>";`).
- Generate a dev CA bundle by exporting the internal CA cert from `backend/internal/crypto/ca.go` and placing it at the configured path.
- Update the dev `process-compose.yaml` to set both new env vars.
