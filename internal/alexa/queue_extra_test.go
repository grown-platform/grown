package alexa

import (
	"testing"

	"code.pick.haus/grown/grown/internal/music"
)

func TestFilterAlbumMode(t *testing.T) {
	lib := []music.Track{
		{ID: "1", Album: "Abbey Road"},
		{ID: "2", Album: "Let It Be"},
		{ID: "3", Album: "Abbey Road Sessions"},
	}
	got := filterTracks(lib, ModeAlbum, "ABBEY")
	if len(got) != 2 {
		t.Fatalf("album filter matched %d, want 2", len(got))
	}
}

func TestFilterModeAllReturnsEverything(t *testing.T) {
	lib := makeTracks(5)
	if got := filterTracks(lib, ModeAll, "ignored"); len(got) != 5 {
		t.Fatalf("ModeAll should return all %d, got %d", len(lib), len(got))
	}
	// Empty key also short-circuits to "everything".
	if got := filterTracks(lib, ModeArtist, ""); len(got) != 5 {
		t.Fatalf("empty key should return all, got %d", len(got))
	}
}

func TestOrderedTracksUnshuffledStableByID(t *testing.T) {
	lib := []music.Track{{ID: "id-0003"}, {ID: "id-0001"}, {ID: "id-0002"}}
	got := orderedTracks(lib, QueueToken{Mode: ModeAll, Seed: 0})
	for i, want := range []string{"id-0001", "id-0002", "id-0003"} {
		if got[i].ID != want {
			t.Fatalf("ordered[%d].ID = %q want %q", i, got[i].ID, want)
		}
	}
}

func TestNewSeedDeterministicAndNonZero(t *testing.T) {
	a := newSeed("request-abc")
	b := newSeed("request-abc")
	if a != b {
		t.Fatalf("newSeed not deterministic: %d vs %d", a, b)
	}
	if a == 0 {
		t.Fatal("newSeed returned 0 (means 'not shuffled')")
	}
	if newSeed("request-abc") == newSeed("request-xyz") {
		t.Fatal("different sources produced the same seed")
	}
}
