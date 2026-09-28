# Home Assistant

A workspace tile that opens your organization's own
[Home Assistant](https://www.home-assistant.io/) in a new tab. Grown doesn't
reimplement HA; it's a **bring-your-own** app, configured **per org**.

## Setup (bring your own, the primary path)

1. Run Home Assistant anywhere the members' browsers can reach (HA OS on a Pi,
   a container on a NAS, Nabu Casa remote URL, ...).
2. In Grown, an org admin opens **Admin > Services > Home Assistant**, enters
   the URL (e.g. `https://ha.example.com` or `http://homeassistant.local:8123`)
   and clicks **Save URL**.
3. The **Home Assistant** tile appears on the dashboard and in the header app
   launchers (hamburger + 9-dot), linking to that URL.

Until a URL is configured the tile is **hidden** everywhere except
Admin > Services, where it shows "Not set up". The on/off switch there hides
it again without losing the URL. Only `http(s)` URLs are accepted.

How it works: the URL is the org's `external_url` for service id
`homeassistant` in `grown.org_service_settings`, the same per-org override
every other tile uses (`AdminService.Get/SetServiceSettings`). No proto or
schema changes were needed.

## Chart-deployed instance (convenience)

The Helm chart can run HA next to grown (`homeAssistant.enabled=true`; see the
[chart README](../../deploy/helm/grown/README.md#optional-home-assistant)).
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

The chart seeds a minimal `configuration.yaml` on first start
(`use_x_forwarded_for` + `trusted_proxies` so HA works behind the ingress) and
never overwrites it afterwards.

## Future: plugins in both directions (not built yet)

- **Grown inside HA:** an HA custom integration (HACS) that signs in with a
  Grown API token and exposes Grown data as HA entities and services: Calendar
  as a `calendar` entity, Tasks as a `todo` list, Drive files as a media
  source, Chat/Mail as notify targets. Automations could then react to Grown
  events ("meeting starts in 5 min, dim the office lights").
- **HA inside Grown:** embed HA dashboards (Lovelace views) in a Grown page or
  panel via iframe with HA's trusted-network/long-lived-token auth, instead of
  only linking out, and optionally single sign-on through Grown's Zitadel with
  an HA OIDC auth provider.
- **Per-org tokens:** store a per-org HA long-lived access token (encrypted)
  so Grown features such as Keep reminders and Calendar alerts can call the HA
  REST/WebSocket API.
