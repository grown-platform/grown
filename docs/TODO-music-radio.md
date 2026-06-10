# TODO — Music: radio stations from Spacelight's radio cache

Status: **planned** (not built).

## Goal

Feed **Spacelight's cached radio** into the grown **Music** app as **radio station playlists**,
so stations Spacelight has already cached show up and play inside Music alongside the user's
own playlists/library.

## Context

- **Spacelight** is the family-hub / home-dashboard app (external, `spacelight.pick.haus`) and
  caches radio (stream URLs + station metadata, and possibly cached audio segments).
- **Music** (grown `internal/music` + `web/app/src/pages/music`) already has tracks, playlists,
  liked songs, and a player with queue/shuffle/repeat (migration 0064).

## Sketch (when built)

- Define how Spacelight exposes its radio cache — an API endpoint or a shared store. Pull:
  station name, stream URL, genre/logo, and (if present) cached segments.
- In `internal/music`, add a **radio station** concept surfaced as read-only "radio playlists":
  either a `music_radio_stations` table synced from Spacelight, or a virtual playlist source.
  Each station = a playlist entry that streams the (cached or live) station URL.
- Sync job/adapter: periodically (or on demand) import Spacelight's cached stations → Music radio
  playlists; dedupe by stream URL; mark them as "Radio" (distinct from user playlists).
- Player: support streaming a station URL (continuous stream, no track-end advance); show
  now-playing station metadata.
- Frontend: a "Radio" section in the Music sidebar listing the station playlists; click → play.
- Auth/scoping: stations are org-scoped (or global if the cache is shared); respect Spacelight's
  source of truth — Music is a consumer/mirror, not the owner.

## Open questions

- Spacelight's radio cache interface (API vs DB vs file store)?
- Are cached audio segments reusable by Music's player, or only the live stream URLs?
- Per-org vs shared station catalog?
