# Grown Music — self-hosted Alexa skill

This is a custom Alexa skill that plays your **grown Music library** on an Echo.
Unlike most skills it has **no AWS Lambda**: grown is already a public HTTPS
service, so the skill endpoint is hosted *inside* grown itself at `POST /alexa`.
The Echo fetches audio bytes from a signed, session-free stream URL on the same
host.

## How it works

- **`POST /alexa`** — Alexa sends every Launch / Intent / playback event here.
  The endpoint is public (no grown login) because Alexa **signs its own
  requests**; grown verifies the signature (cert chain + RSA-SHA256 over the raw
  body + a 150-second timestamp window) before acting on it.
- **`GET /api/v1/music/alexa/stream/{trackID}?e=<unixExpiry>&s=<hmac>`** — the
  Echo streams audio from here with **no grown session**. The URL is authorized
  by an HMAC signature instead:
  `s = hex(HMAC-SHA256(GROWN_ALEXA_SECRET, trackID + "|" + e))`, and `e` must be
  in the future. The handler validates the signature + expiry, then serves the
  blob with `Accept-Ranges: bytes` so the Echo can seek/resume.
- **Stateless queue** — there is no server-side playback state. The whole queue
  (which subset of the library, the shuffle order, and the cursor position) is
  encoded into the AudioPlayer `token`:
  `base64url(JSON{m: mode, k: key, i: idx, s: seed})`. On every request grown
  reconstructs the ordered track list deterministically (stable sort by track id,
  then a `seed`-driven Fisher-Yates shuffle), so Next / Previous and the gapless
  `PlaybackNearlyFinished` enqueue all work without storing anything.

## Server configuration (env)

| Env | Required | Default | Purpose |
|-----|----------|---------|---------|
| `GROWN_ALEXA_SECRET` | **yes** | _(unset → skill disabled)_ | HMAC key that signs the session-free Echo stream URLs. Pick a long random string. The whole skill (both routes) is **off** until this is set. |
| `GROWN_PUBLIC_BASE_URL` | no | derived from `GROWN_OIDC_REDIRECT_URL` origin | Public origin used to build absolute stream URLs, e.g. `https://pick.haus`. |
| `GROWN_ALEXA_SKIP_VERIFY` | no | `false` | `true` bypasses Alexa request-signature validation. **Local dev only** — leave false in production so every `/alexa` request is cryptographically verified. |

The skill serves the music library of grown's **default org** (`GROWN_DEFAULT_ORG_SLUG`).
See the multi-user note at the bottom.

## Amazon Developer Console setup

1. Go to the [Alexa Developer Console](https://developer.amazon.com/alexa/console/ask)
   and **Create Skill**.
   - Name: `Grown Music`
   - Model: **Custom**
   - Hosting: **Provision your own** (we host the endpoint in grown, not Lambda).
2. **Interaction Model → JSON Editor**: paste the contents of
   [`interaction-model.en-US.json`](./interaction-model.en-US.json) and **Save** +
   **Build Model**. The invocation name is **"grown music"**.
3. **Endpoint**: choose **HTTPS**, set the Default Region URL to:
   ```
   https://pick.haus/alexa
   ```
   For the SSL certificate type pick *"My development endpoint has a certificate
   from a trusted certificate authority"* (pick.haus serves a real CA cert via
   Cloudflare).
4. **Interfaces**: enable **Audio Player** (this lets the skill emit
   `AudioPlayer.Play` directives). The required `AMAZON.*` playback intents are
   already in the interaction model.
5. On the grown server, set `GROWN_ALEXA_SECRET` (and optionally
   `GROWN_PUBLIC_BASE_URL`) and redeploy so the `/alexa` endpoint is live.
6. **Test** (Developer Console → Test tab, or any account-linked Echo):
   - "Alexa, open grown music" → greets and starts the library shuffled.
   - "Alexa, ask grown music to play the Beatles"
   - "next", "previous", "pause", "resume", "stop"

`skill.json` is the full skill manifest (custom interface + Audio Player
enabled + the `https://pick.haus/alexa` endpoint placeholder) for reference or
for use with the ASK CLI (`ask deploy`). If you host grown at a different origin,
change the endpoint URL in both the console and `skill.json`.

## Voice commands

| Say | Does |
|-----|------|
| open grown music | greet + play whole library shuffled |
| play my music / shuffle my music | play whole library shuffled |
| play `{artist}` | play that artist (case-insensitive contains match) |
| play the album `{album}` | play that album / station |
| next / previous | step the queue |
| pause / stop / cancel | stop playback |
| resume | replay the current track (offset not persisted — restarts the track) |
| start over | restart the current track |
| shuffle on / off | reshuffle / un-shuffle the current selection |
| help | usage hint |

## TODO — multi-user account-linking (follow-up)

v1 serves a **single configured org** (grown's default org). It does **not**
implement Alexa account-linking, so every Echo plays the same library and
there's no per-user identity.

The follow-up is to add **Alexa account-linking via Zitadel OAuth**: configure
the skill's Account Linking with grown's Zitadel as the OAuth provider, then in
`POST /alexa` resolve the user from the access token in
`context.System.user.accessToken` and look up *their* org instead of the default
org. That makes the skill multi-tenant. Until then, keep the skill private to
the household that owns the default org.
