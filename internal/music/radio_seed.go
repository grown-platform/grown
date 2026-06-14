package music

import (
	"context"
	"log/slog"
)

// seedStation is a built-in radio station, copied from Spacelight's
// seed-radio.ts. genre is grown's addition for the sidebar listing.
type seedStation struct {
	Name      string
	StreamURL string
	Genre     string
}

// seedStations is the station list ported from Spacelight (apps/api/seed/
// seed-radio.ts). The K-LOVE/AAC (maestro.emfcdn.com) and streamguys URLs are
// the reliable, ICY-metadata-bearing candidates for end-to-end testing.
var seedStations = []seedStation{
	{Name: "K-LOVE · AAC 64kbps", StreamURL: "https://maestro.emfcdn.com/stream_for/k-love/airable/aac", Genre: "Christian"},
	{Name: "Air1 · AAC 64kbps", StreamURL: "https://maestro.emfcdn.com/stream_for/air1/airable/aac", Genre: "Christian"},
	{Name: "K-LOVE 2000s · AAC 64kbps", StreamURL: "https://maestro.emfcdn.com/stream_for/k-love-2000s/airable/aac", Genre: "Christian"},
	{Name: "K-LOVE Pop · AAC 64kbps", StreamURL: "https://maestro.emfcdn.com/stream_for/k-love-pop/airable/aac", Genre: "Christian"},
	{Name: "Christian Power Praise · AAC 136kbps", StreamURL: "https://listen.christianrock.net/stream/13/", Genre: "Christian Rock"},
	{Name: "Abiding Radio Instrumental · MP3 128kbps", StreamURL: "https://streams.abidingradio.com:7800/1", Genre: "Instrumental"},
	{Name: "CBN Classic Christian · MP3 128kbps", StreamURL: "https://streams.cbnradio.com/Classic-Christian-128K?app=cbnplayer", Genre: "Christian"},
	{Name: "KFUO · AAC 192kbps", StreamURL: "https://kfuo.streamguys1.com/kfuo", Genre: "Talk"},
	{Name: "KGBI 100.7 · MP3 64kbps", StreamURL: "https://nwmedia-kgbi.streamguys1.com/kgbi-mp3", Genre: "Christian"},
	{Name: "Praise 106.5 · AAC+ 64kbps", StreamURL: "https://crista-kwpz.streamguys1.com/kwpzaacp", Genre: "Christian"},
	{Name: "HR3 · MP3 128kbps", StreamURL: "https://dispatcher.rndfnk.com/hr/hr3/live/mp3/high", Genre: "Pop"},
	{Name: "Hit Radio FFH · MP3 128kbps", StreamURL: "http://mp3.ffh.de/radioffh/hqlivestream.mp3", Genre: "Pop"},
}

// SeedStations populates the built-in radio station list for orgID on first run
// (no-op once the org already has any station). Safe to call on every boot;
// errors are logged, never fatal.
func SeedStations(ctx context.Context, repo *Repository, orgID string) {
	n, err := repo.CountStations(ctx, orgID)
	if err != nil {
		slog.Warn("radio seed: count failed", "err", err)
		return
	}
	if n > 0 {
		return
	}
	for _, s := range seedStations {
		if _, err := repo.UpsertStation(ctx, orgID, StationFields{
			Name:      s.Name,
			StreamURL: s.StreamURL,
			Genre:     s.Genre,
		}); err != nil {
			slog.Warn("radio seed: upsert failed", "station", s.Name, "err", err)
		}
	}
	slog.Info("radio seed: seeded stations", "org", orgID, "count", len(seedStations))
}
