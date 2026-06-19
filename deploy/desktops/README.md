# On-demand container desktops — Phase 2 deployment

Cluster scaffolding for the desktops feature (`internal/desktops`). grown
provisions per-session desktop pods here and registers Guacamole connections.

**Depends on Phase 1** (a running Guacamole gateway with a reachable REST API +
an admin credential). Enabled on **pick.haus only**.

## Apply (gitops)

`deploy/desktops/*.yaml` in order:

| File | What |
| --- | --- |
| `00-namespace.yaml` | the `grown-desktops` namespace |
| `10-rbac.yaml` | scoped Role + RoleBinding so grown's SA can manage pods/services/PVCs **only here** |
| `20-quota.yaml` | ResourceQuota + LimitRange (cap total + per-pod) |
| `30-networkpolicy.yaml` | default-deny; allow ingress from `guacd`, egress to DNS + internet (no RFC1918) |

## Enable on the grown (pick.haus) deployment

Set on the `grown` deployment env:

```
GROWN_DESKTOPS_ENABLED=true
GROWN_DESKTOPS_NAMESPACE=grown-desktops      # default
GROWN_DESKTOPS_STORAGE_CLASS=ceph-block      # default
GROWN_GUAC_API_URL=http://guacamole.grown.svc.cluster.local:8080
GROWN_GUAC_ADMIN_USER=<guacamole admin>
GROWN_GUAC_ADMIN_PASSWORD=<guacamole admin password>
GROWN_GUAC_URL=https://guac.pick.haus/       # open-in-gateway base (already set in Phase 1)
```

The Guacamole admin account is used only by grown's REST client to create/grant
connections. grown's in-cluster ServiceAccount (`default` in ns `grown`) gets the
scoped Role above to orchestrate desktop pods.

## Notes / tunables confirmed at deploy time

- **Flavor images + VNC ports** (`internal/desktops/catalog.go`) are defaults;
  the exact VNC port and the password env-var name depend on the chosen images
  (linuxserver vs Kasm) and are confirmed on first launch.
- Idle TTL (30m) and per-user cap (2) are currently constants in `main.go`; lift
  to env if needed.
- Grants map the grown user to the Guacamole account by **email local-part**
  (same convention as Phase 1 OIDC).
