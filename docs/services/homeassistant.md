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

Sign-in happens inside the frame with HA's own login. Browsers that block
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
   and the token.

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

## Chart-deployed instance

The Helm chart can run HA next to Grown (see the
[chart README](../../deploy/helm/grown/README.md)). It then sets
`GROWN_HOMEASSISTANT_URL` on the Grown server, and the service-settings API
reports that URL for every org that hasn't set its own. Precedence:

| Org URL set? | `GROWN_HOMEASSISTANT_URL` set? | Tile |
|---|---|---|
| yes | any | org URL |
| no | yes | deployment default |
| no | no | hidden |

Clearing an org's URL falls back to the deployment default; the default is
never written to the database. The chart's HA is one instance for the whole
deployment, so if orgs need separate homes, each should bring its own URL.

The chart seeds a minimal `configuration.yaml` on first start
(`use_x_forwarded_for` + `trusted_proxies` so HA works behind the ingress, and
`use_x_frame_options: false` so the in-app view can frame it) and never
overwrites it afterwards.

## Future

- Single sign-on into HA through Grown's Zitadel (an HA OIDC auth provider),
  so the in-app view needs no separate HA login.
- A per-org HA long-lived access token (stored encrypted) so Grown features
  such as Keep reminders and Calendar alerts can call HA's REST/WebSocket API.
- Drive files as an HA media source, and Chat/Mail as notify targets.
