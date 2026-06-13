# Grown Workspace — rendered raw manifests

`grown.yaml` is the **all-in-one** Kubernetes manifest for the Grown Workspace
platform: bundled Postgres + MinIO (S3) + Zitadel (OIDC) + the grown app, with
no external operators required.

## This file is generated — do not edit by hand

It is rendered from the Helm chart at `../helm/grown`:

```sh
helm template grown ../helm/grown -n grown \
  --set domain=grown.example.com \
  > grown.yaml
```

To change anything (domain, image tag, credentials, ingress type, enable the
bolo sidecar, swap to external Postgres/OIDC, etc.), edit the chart's
`values.yaml` (or pass `--set`) and re-render. Editing `grown.yaml` directly
will be lost on the next render.

## Apply with kubectl

The manifest does **not** create the namespace (kept portable). Create it first:

```sh
kubectl create namespace grown
kubectl apply -n grown -f grown.yaml
```

Then watch it come up:

```sh
kubectl get pods -n grown -w
```

Reach grown via port-forward (the rendered default uses `ingress.type=none`):

```sh
kubectl -n grown port-forward svc/grown-grown 8080:8080
# http://localhost:8080/healthz
```

## Notes / caveats

- **domain** in the rendered file is `grown.example.com`. Re-render with your
  own `--set domain=...` before applying for real.
- **Credentials are the chart defaults** (admin `admin@grown.localtest.me` /
  `DevPassword!1`, S3 `grown` / `DevPassword!1`, Zitadel masterkey). Override
  them via the chart for anything beyond a throwaway/local cluster.
- **Zitadel OIDC auto-provisioning**: the `grown-zitadel-provision` Job creates
  the grown OIDC app and writes the `grown-zitadel-secret` Secret. grown stays
  `NotReady` until that secret holds a real client-id. Browser-facing SSO login
  needs Zitadel exposed at the same issuer URL grown uses — see
  `../helm/grown/README.md` ("Zitadel & real login").
- For production, prefer `helm install` so upgrades and the kept OIDC secret are
  managed; this raw manifest is mainly for clusters without Helm / for review.
