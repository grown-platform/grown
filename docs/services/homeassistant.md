# Home Assistant

A workspace tile that opens your organization's own
[Home Assistant](https://www.home-assistant.io/) in a new tab. Grown doesn't
reimplement HA; it's a **bring-your-own** app, configured **per org**.

## Setup (bring your own, the primary path)

1. Run Home Assistant anywhere the members' browsers can reach (HA OS on a Pi,
   a container on a NAS, Nabu Casa remote URL, ...).
2. In Grown, an org admin opens **Admin > Services > Home Assistant**, enters
   the URL (e.g. `https://ha.example.com` or `http://homeassistant.local:8123`)
   and clicks **Save URL**. In a personal (single-user) org, which has no
   Admin app, the same field is under **Settings > Home Assistant**.
3. The **Home Assistant** tile appears on the dashboard and in the header app
   launchers (hamburger + 9-dot), linking to that URL.

Until a URL is configured the tile is **hidden** everywhere except
Admin > Services (where it shows "Not set up") and, for personal orgs,
Settings. The on/off switch there hides
it again without losing the URL. Only `http(s)` URLs are accepted.

How it works: the URL is the org's `external_url` for service id
`homeassistant` in `grown.org_service_settings`, the same per-org override
every other tile uses (`AdminService.Get/SetServiceSettings`). No proto or
schema changes were needed.

## Chart-deployed instance (default since chart 0.4.0)

The Helm chart runs HA next to grown by default (`homeAssistant.enabled`,
switchable off; see the
[chart README](../../deploy/helm/grown/README.md#home-assistant-default-on)).
It then sets `GROWN_HOMEASSISTANT_URL` on the grown server, and the
service-settings API reports that URL for every org that hasn't set its own.
Precedence:

| Org URL set? | `GROWN_HOMEASSISTANT_URL` set? | Tile |
|---|---|---|
| yes | any | org URL |
| no | yes | deployment default |
| no | no | hidden |

Clearing an org's URL falls back to the deployment default; the default is
never written to the database. The chart's HA is one instance for the whole
deployment, so if orgs need separate homes, each should bring its own URL.

What the chart adds around HA:

- **Automatic onboarding.** A fresh HA lets the first visitor create the
  owner. The chart's `onboard` sidecar creates the owner over localhost from
  the `<release>-homeassistant-owner` Secret the moment HA starts, and HA's
  readiness is gated on that, so the Ingress never routes to an un-owned HA.
  Password: `kubectl -n <ns> get secret <release>-homeassistant-owner -o
  jsonpath='{.data.password}' | base64 -d`.
- **Seeded config** on first start only (never overwritten):
  `use_x_forwarded_for` + `trusted_proxies` so HA works behind the ingress,
  and `use_x_frame_options: false` so Grown can show HA in an iframe. That
  last one is a clickjacking trade-off (any site may frame HA); set
  `homeAssistant.http.useXFrameOptions: true` to keep HA's
  `X-Frame-Options: SAMEORIGIN`, and Grown then only links out.
- **The Grown integration pre-installed** (below), downloaded from grown on
  every HA start so it always matches the Grown version.

## The Grown integration for Home Assistant

A Home Assistant custom integration (domain `grown`, "Grown Workspace") that
brings a Grown account into HA. Source:
[`integrations/homeassistant/custom_components/grown`](../../integrations/homeassistant/custom_components/grown).
It polls Grown's REST API every 2 minutes with a personal API token.

### Entities

| Entity | What it is | Supports |
|---|---|---|
| `calendar.<org>_calendar` | Grown Calendar (the org's events, recurring series expanded). State `on` during an event; attributes show the current/next one. | list, create, update, delete (a single occurrence or the whole series) |
| `todo.<org>_<list name>` | one per Grown task list; state = open items. Lists added/removed in Grown appear/disappear. | add, rename, notes, due date/time, complete/reopen, delete, reorder |
| `sensor.<org>_unread_notifications` | unread Grown notifications | |
| `sensor.<org>_open_tasks` | incomplete tasks across all lists | |
| `sensor.<org>_overdue_tasks` | incomplete tasks past their due date | |
| `notify.<org>_notifications` | sends a notification into Grown (the bell) for the token's user, via `POST /api/v1/notifications/push` | title + message |

Example automation:

```yaml
- alias: Washer done -> Grown
  triggers:
    - trigger: state
      entity_id: sensor.washer_status
      to: "idle"
  actions:
    - action: notify.send_message
      target: { entity_id: notify.acme_household_notifications }
      data: { title: Laundry, message: "The washer is done." }
```

Notes: task due dates without a time are stored as UTC midnight, matching how
Grown's Tasks app shows them; Grown has no "this and following occurrences"
edit, so HA's "this and future" on a recurring event applies to the whole
series. Grown limits pushes to 60 per minute per token (HA reports the
rate-limit error).

### Connect it

1. In Grown, **Settings > API tokens**, create a token with the **Connect
   Home Assistant** preset (`calendar`, `tasks` and `notifications` read +
   write). Copy the `grw_...` token.
2. In HA, **Settings > Devices & services > Add integration > Grown
   Workspace**. Enter the Grown URL (e.g. `https://grown.example.com`; for
   the chart's HA, the in-cluster
   `http://<release>-grown.<ns>.svc.cluster.local:8080` works too) and the
   token. The entry is named after your Grown organization.
3. If the token is revoked or expires, HA raises a **re-authenticate**
   repair; paste a new token there. **Reconfigure** changes the URL.

### Installing on a bring-your-own HA

Grown serves the integration matching its own version at
`<grown URL>/integrations/homeassistant/grown.zip` (public, no login). The zip
contains `custom_components/grown/`, so from HA's config directory:

```sh
cd /config            # HA OS: the "config" share; Docker: your /config volume
curl -fsSLO https://grown.example.com/integrations/homeassistant/grown.zip
unzip -o grown.zip && rm grown.zip
```

Restart Home Assistant, then add the integration as above. Re-run it after
upgrading Grown to pick up the matching integration.

### Development

The integration's tests use `pytest-homeassistant-custom-component` pinned to
the chart's HA version and run inside that HA image:

```sh
integrations/homeassistant/run-tests.sh
```

`internal/hacomponent` builds the zip deterministically (sorted entries, fixed
mtimes) from the go:embed-ded sources in `integrations/homeassistant`.

## Future (not built yet)

- **More Grown in HA:** Drive files as a media source, Chat/Mail as notify
  targets, and push (instead of polling) so automations react to Grown events
  instantly ("meeting starts in 5 min, dim the office lights").
- **Single sign-on:** sign in to the chart's HA through Grown's Zitadel with
  an HA OIDC auth provider, instead of HA's own owner/users.
- **Per-org tokens:** store a per-org HA long-lived access token (encrypted)
  so Grown features such as Keep reminders and Calendar alerts can call the HA
  REST/WebSocket API.
