package music

import (
	"testing"
	"time"
)

func TestStreamURL(t *testing.T) {
	tests := []struct {
		id   string
		want string
	}{
		{"abc", "/api/v1/music/abc/content"},
		{"00000000-0000-0000-0000-000000000000", "/api/v1/music/00000000-0000-0000-0000-000000000000/content"},
		{"", "/api/v1/music//content"},
	}
	for _, tt := range tests {
		if got := streamURL(tt.id); got != tt.want {
			t.Errorf("streamURL(%q) = %q, want %q", tt.id, got, tt.want)
		}
	}
}

func sampleTrackRow() Track {
	created := time.Date(2024, 1, 2, 3, 4, 5, 0, time.UTC)
	updated := time.Date(2024, 6, 7, 8, 9, 10, 0, time.UTC)
	return Track{
		ID:              "t1",
		OrgID:           "org1",
		OwnerID:         "owner1",
		Title:           "Song",
		Artist:          "Artist",
		Album:           "Album",
		ContentType:     "audio/mpeg",
		Size:            999,
		DurationSeconds: 12.5,
		ArtworkDataURL:  "data:image/png;base64,ZZ",
		BlobKey:         "music/secret-key",
		CreatedAt:       created,
		UpdatedAt:       updated,
	}
}

func TestTrackToProto(t *testing.T) {
	in := sampleTrackRow()
	got := trackToProto(in)

	if got.GetId() != "t1" || got.GetOrgId() != "org1" || got.GetOwnerId() != "owner1" {
		t.Errorf("ids mismatch: %+v", got)
	}
	if got.GetTitle() != "Song" || got.GetArtist() != "Artist" || got.GetAlbum() != "Album" {
		t.Errorf("metadata mismatch: %+v", got)
	}
	if got.GetContentType() != "audio/mpeg" || got.GetSize() != 999 || got.GetDurationSeconds() != 12.5 {
		t.Errorf("content fields mismatch: %+v", got)
	}
	if got.GetArtworkDataUrl() != "data:image/png;base64,ZZ" {
		t.Errorf("artwork mismatch: %q", got.GetArtworkDataUrl())
	}
	if got.GetStreamUrl() != "/api/v1/music/t1/content" {
		t.Errorf("stream url mismatch: %q", got.GetStreamUrl())
	}
	// The blob key is an internal detail and must NOT be exposed in the proto.
	if got.GetStreamUrl() == in.BlobKey {
		t.Errorf("blob key leaked into stream url")
	}
	// Timestamps are RFC3339 UTC.
	if got.GetCreatedAt() != "2024-01-02T03:04:05Z" {
		t.Errorf("created_at = %q, want RFC3339", got.GetCreatedAt())
	}
	if got.GetUpdatedAt() != "2024-06-07T08:09:10Z" {
		t.Errorf("updated_at = %q, want RFC3339", got.GetUpdatedAt())
	}
	// trackToProto defaults liked to false.
	if got.GetLiked() {
		t.Errorf("trackToProto should default liked=false")
	}
}

func TestTrackToProtoLiked(t *testing.T) {
	for _, liked := range []bool{true, false} {
		got := trackToProtoLiked(sampleTrackRow(), liked)
		if got.GetLiked() != liked {
			t.Errorf("trackToProtoLiked(_, %v).Liked = %v", liked, got.GetLiked())
		}
	}
}

func TestTrackToProto_LocalTimeNormalizedToUTC(t *testing.T) {
	loc, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Skipf("tz data unavailable: %v", err)
	}
	in := sampleTrackRow()
	in.CreatedAt = time.Date(2024, 1, 2, 3, 4, 5, 0, loc) // 08:04:05 UTC
	got := trackToProto(in)
	if got.GetCreatedAt() != "2024-01-02T08:04:05Z" {
		t.Errorf("created_at = %q, want UTC-normalized 2024-01-02T08:04:05Z", got.GetCreatedAt())
	}
}

func TestPlaylistToProto(t *testing.T) {
	created := time.Date(2023, 3, 3, 3, 3, 3, 0, time.UTC)
	updated := time.Date(2023, 4, 4, 4, 4, 4, 0, time.UTC)
	p := Playlist{
		ID:          "p1",
		OrgID:       "org1",
		OwnerID:     "owner1",
		Name:        "Focus",
		Description: "deep work",
		Tracks:      []Track{sampleTrackRow(), sampleTrackRow()},
		TrackCount:  2,
		CreatedAt:   created,
		UpdatedAt:   updated,
	}
	got := playlistToProto(p)
	if got.GetId() != "p1" || got.GetName() != "Focus" || got.GetDescription() != "deep work" {
		t.Errorf("playlist fields mismatch: %+v", got)
	}
	if got.GetTrackCount() != 2 {
		t.Errorf("track_count = %d, want 2", got.GetTrackCount())
	}
	if len(got.GetTracks()) != 2 {
		t.Errorf("tracks len = %d, want 2", len(got.GetTracks()))
	}
	if got.GetCreatedAt() != "2023-03-03T03:03:03Z" || got.GetUpdatedAt() != "2023-04-04T04:04:04Z" {
		t.Errorf("timestamps mismatch: created=%q updated=%q", got.GetCreatedAt(), got.GetUpdatedAt())
	}
	// Each nested track gets its own stream URL.
	for i, tr := range got.GetTracks() {
		if tr.GetStreamUrl() != "/api/v1/music/t1/content" {
			t.Errorf("nested track %d stream url = %q", i, tr.GetStreamUrl())
		}
	}
}

func TestPlaylistToProto_EmptyTracks(t *testing.T) {
	got := playlistToProto(Playlist{ID: "p", Name: "Empty"})
	if got.GetTracks() == nil {
		t.Error("tracks should be non-nil empty slice, got nil")
	}
	if len(got.GetTracks()) != 0 {
		t.Errorf("empty playlist tracks len = %d", len(got.GetTracks()))
	}
}
