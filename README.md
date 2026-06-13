# Grown

> **Grow your own platform and own what you grow.**

**A self-hosted, open-source workspace platform** — your own Drive, Mail, Calendar,
Docs, Sheets, Slides, Chat, Meet, Photos, Music, Video, a 100+ game arcade, and
more, running on your own infrastructure. A free alternative to the big cloud
office suites.

> **Forever free. MIT licensed.** Grown Workspace is and always will be free and
> open source under the [MIT License](LICENSE). Use it, run it, fork it, sell it —
> no strings.

Live instance: **[grown.haus](https://grown.haus)**

## Contributing & issues — very welcome 🙌

**Contributions and issues are genuinely appreciated.** Whether it's a bug report,
a feature idea, a new game, or a pull request — please jump in.

> **Missing something?** If an app lacks a feature, a doc is unclear, or you hit a
> bug — **just [open an issue](https://github.com/grown-platform/grown/issues/new)
> and we'll get it grown 🌱.** No request is too small.

- **Source code (mirror):** **https://github.com/grown-platform/grown**
- **🐛 Found a bug / have an idea?** [Open an issue](https://github.com/grown-platform/grown/issues).
- **🔧 Want to contribute code?** Fork the GitHub mirror, make your change, and
  open a pull request — see **[CONTRIBUTING.md](CONTRIBUTING.md)** for the flow.

The canonical repository lives on our Forgejo (`code.pick.haus`) and is mirrored
to GitHub so anyone can file issues and propose PRs. A maintainer reviews PRs and
merges them upstream; merged changes flow back out to the GitHub mirror.

## What's inside

A Go backend (gRPC + gRPC-Gateway) serving a React/TypeScript SPA (Vite, Joy UI),
with Postgres, S3-compatible blob storage, and Zitadel OIDC auth. Apps include
Drive, Mail, Calendar, Contacts, Docs, Sheets, Slides, Whiteboard, Forms, Photos,
Books, Video, Live, Music, Chat, Meet, Tasks, Keep, Sites, Groups, a Ticketing
service, an in-process PDF signing app, and a large browser game arcade (including
native game ports compiled to WebAssembly).

## Install / self-host

One all-in-one Helm chart brings up the whole platform (app + Postgres + MinIO +
Zitadel SSO, no required operators) on any cluster — a laptop (kind), a Raspberry
Pi 5 cluster, or a homelab:

```bash
helm install grown deploy/helm/grown -n grown --create-namespace \
  --set domain=grown.example.com
```

Prefer plain `kubectl`? `kubectl apply -f deploy/manifests/grown.yaml`. Full guide
(kind, Raspberry Pi 5, Helm values, production notes): **[Install &
self-host](https://grown.haus/docs/install.html)** · chart in
[`deploy/helm/grown`](deploy/helm/grown).

## Documentation

- **[Visual tour of every service](docs/services/README.md)** — live screenshots
  of each app, desktop + mobile.
- Architecture, design notes, and roadmaps live under [`docs/`](docs/).

## License

[MIT](LICENSE) for the platform's own code. A few **bundled third-party
components keep their own licenses** (noted in their subdirectories) — e.g. the
WinBolo game port is GPL v2, and Maelstrom is Zlib. See [LICENSE](LICENSE) for
details.
