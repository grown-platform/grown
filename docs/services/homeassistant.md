# Home Assistant

Grown integrates with [Home Assistant](https://www.home-assistant.io/) (HA) in
both directions:

- **HA inside Grown:** a **Home Assistant** app that shows your organization's
  HA inside Grown, under the normal header (`/homeassistant`).
- **Grown inside HA:** the `grown` HA custom integration signs in with a Grown
  API token and exposes Calendar, Tasks and Notifications as HA entities
  (calendar, to-do lists, sensors and a notify target).

Grown doesn't reimplement HA. The HA URL is configured **per org**; the Helm
chart can also run HA for you and provide a deployment-wide default.

## Setup: point Grown at your Home Assistant

1. Run Home Assistant anywhere the members' browsers can reach (HA OS on a Pi,
   a container on a NAS, Nabu Casa remote URL, ...).
2. In Grown, an org admin opens **Admin > Services > Home Assistant**, enters
   the URL (e.g. `https://ha.example.com` or `http://homeassistant.local:8123`)
   and clicks **Save URL**. In a personal (single-user) org, which has no
   Admin app, the same field is under **Settings > Home Assistant**.
3. The **Home Assistant** tile appears on the dashboard and in the header app
   launchers (hamburger + 9-dot). It opens the in-app view (below).

Until a URL is configured the tile is **hidden** everywhere except
Admin > Services (where it shows "Not set up") and, for personal orgs,
Settings. The on/off switch there hides it again without losing the URL. Only
`http(s)` URLs are accepted.

How it works: the URL is the org's `external_url` for service id
`homeassistant` in `grown.org_service_settings`, the same per-org override
every other tile uses (`AdminService.Get/SetServiceSettings`).

## The in-app view (`/homeassistant`)

The tile opens `/homeassistant` (`/home-assistant` redirects there), which
shows HA in a full-height frame below Grown's header, with the URL, a reload
button and **Open in new tab**.

HA refuses to be shown inside other sites by default (it sends
`X-Frame-Options: SAMEORIGIN`). To allow it, add this to HA's
`configuration.yaml` and restart HA:

```yaml
http:
  use_x_frame_options: false
```

The Helm chart's seeded HA config already includes it. For bring-your-own HA
you add it yourself. Without it the frame stays blank or shows "refused to
connect"; a browser can't detect that from script, so the view's **?** button
explains the fix and **Open in new tab** always works. The view also shows a
message instead of a frame when:

- no URL is configured (or the service is switched off), or
- Grown is on HTTPS and HA is plain HTTP. Browsers block mixed content, so give
  HA an HTTPS URL (a reverse proxy, Nabu Casa, or the chart's ingress).

Sign-in happens inside the frame with HA's own login. If HA signs in through
single sign-on (for example Zitadel via an OIDC integration), use **Sign in**
in the view's bar: identity providers refuse to be framed, so the SSO login
opens in a popup, and the view reloads when the popup closes. HA keeps the
session in its own origin's storage, which the frame then shares (same site),
so later visits need no popup. Browsers that block
third-party cookies/storage may ask you to sign in to HA again, or refuse to
keep you signed in, when HA is on a different site than Grown. Putting HA on a
subdomain of Grown's domain (e.g. `ha.grown.example.com`) avoids this.

Grown doesn't send `X-Frame-Options` or a `frame-src` CSP on its own pages, so
nothing needs opening on the Grown side. (If you put a proxy in front of Grown
that adds a CSP, allow `frame-src` for your HA origin only.)

## Connect Home Assistant to Grown (the `grown` integration)

1. In Grown, open **Settings > API tokens** and click **Connect Home
   Assistant**. This creates a token named "Home Assistant" with no expiry and
   exactly these scopes:

   | Scope | Allows |
   |---|---|
   | `calendar:read`, `calendar:write` | `GET` and writes under `/api/v1/calendar/*` |
   | `tasks:read`, `tasks:write` | `GET` and writes under `/api/v1/tasks/*` |
   | `notifications:read`, `notifications:write` | `GET` and writes under `/api/v1/notifications/*` (incl. push) |

   The token is shown **once**, with these same instructions. Revoke it from
   the list at any time.
2. Install the integration in HA. The chart's HA ships with it. For your own
   HA, download it from `https://<your-grown>/integrations/homeassistant/grown.zip`
   (also linked from the token panel), unzip it into
   `config/custom_components/`, and restart HA.
3. In HA go to **Settings > Devices & services > Add integration**, pick
   **Grown**, and enter your Grown URL (e.g. `https://workspace.example.com`)
   and the token (for the chart's HA, the in-cluster
   `http://<release>-grown.<ns>.svc.cluster.local:8080` works too). The entry
   is named after your Grown organization. If the token is revoked or expires,
   HA raises a **re-authenticate** repair; paste a new token there.
   **Reconfigure** changes the URL.

### Scope rules

A token authenticates as its owner. On `/api/*` it is limited by its scopes:
`*` means everything, `<service>` means read and write, `<service>:read` means
`GET`/`HEAD` only, and `<service>:write` means read and write. The service is
the first path segment after `/api/v1/`. Token management
(`/api/v1/me/tokens`) always requires an interactive session. If a request
carries both a session cookie and a bearer token, the session wins.

### Endpoints the integration uses

**Validate URL + token**:

```
GET /api/v1/integrations/homeassistant/info
200 {"user_id","email","name","org_id","org_name","scopes":[...],"version"}
```

Works with any valid session or token, whatever its scopes (it only
describes the caller). `scopes` is the token's scopes, or `["*"]` for a
session, and `version` is the Grown server version. Returns 401 when the token
is missing or invalid.

**Push a notification to yourself** (HA's notify entity):

```
POST /api/v1/notifications/push
{"title": "Front door", "message": "Someone is at the door", "link": "/calendar"}
201 {"id": "<uuid>"}
```

- Needs a session or a token with `notifications:write`. Without it the
  response is 403.
- `title` is 1-200 characters, `message` at most 2000, and `link` is optional:
  an in-app path starting with `/` or an absolute `http(s)` URL. Anything else
  returns 400 `{"error": "..."}`.
- The limit is 60 pushes per minute per user; above that the response is 429
  (`Retry-After: 60`).
- The notification lands in the caller's own feed only (the bell), with type
  `homeassistant`. Clicking it follows `link`: in-app paths navigate within
  Grown, and `http(s)` links open in a new tab.

Calendar and Tasks use the regular REST API: `GET /api/v1/calendar/events`
(with optional `time_min`/`time_max` in RFC 3339), `POST`/`PATCH`/`DELETE`
`/api/v1/calendar/events[/{id}]`, `GET /api/v1/tasks/lists`,
`GET|POST /api/v1/tasks/lists/{list_id}/tasks`,
`PATCH|DELETE /api/v1/tasks/lists/{list_id}/tasks/{id}` and
`POST /api/v1/tasks/lists/{list_id}/tasks/{id}/toggle` (completion is
toggled, not patched). JSON field names are snake_case.

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
- **Reverse-proxy settings that stick:** `use_x_forwarded_for` +
  `trusted_proxies` so HA works behind the ingress, and
  `use_x_frame_options: false` so Grown can show HA in an iframe. HA 2026.9+
  puts `http:` settings on a 5-minute trial after migrating them from
  `configuration.yaml` into `.storage/http`, and reverts them (then ignores
  the YAML) unless an admin promotes them; unpromoted, HA answers 400 to
  every proxied request. The chart seeds the YAML on first start and the
  `onboard` sidecar, logged in as the owner, promotes it over HA's websocket
  API, or re-applies and promotes the settings from the chart values when HA
  holds anything else (including installs that already reverted). The frame
  option is a clickjacking trade-off (any site may frame HA); set
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
