# Contributing to Grown Workspace

**Contributions and issues are very welcome** — thank you for helping make Grown
better. Bug reports, feature ideas, new games, docs fixes, and pull requests are
all appreciated.

## Where things live

- **Canonical repo (source of truth):** Forgejo at `code.pick.haus/grown/grown-workspace`.
- **Public mirror (for issues & PRs):** **https://github.com/grown-platform/grown-workspace**

The GitHub repo is a mirror of Forgejo so anyone can participate without a Forgejo
account. **Open issues and pull requests on GitHub.**

## Reporting issues

[Open an issue on GitHub](https://github.com/grown-platform/grown-workspace/issues)
with:
- What you expected vs. what happened, steps to reproduce.
- Which app/service (Drive, Mail, a specific game, etc.) and platform (desktop/mobile).
- Screenshots or console errors if you have them.

## Pull requests

1. **Fork** `grown-platform/grown-workspace` on GitHub.
2. Create a branch: `git checkout -b feat/your-thing`.
3. Make your change. Keep it focused; match the surrounding code style.
4. Verify it builds: backend `go build ./...`; frontend `cd web/app && npx tsc --noEmit`.
5. Open a **pull request** against the GitHub mirror's `main`.

A maintainer reviews your PR and merges it into the canonical Forgejo repo; the
merge then flows back out to the GitHub mirror automatically. (Because GitHub is a
push-mirror of Forgejo, your PR is integrated upstream rather than merged via the
GitHub button — your authorship is preserved.)

## License & third-party assets

By contributing, you agree your contributions are licensed under the project's
[MIT License](LICENSE). Note that a few **bundled third-party components keep
their own licenses** (e.g. the WinBolo port is GPL v2, Maelstrom is Zlib) — don't
relicense those, and don't add assets you don't have the rights to redistribute.
