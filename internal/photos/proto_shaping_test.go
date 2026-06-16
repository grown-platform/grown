package photos

import (
	"testing"
	"time"
)

func TestContentURL(t *testing.T) {
	if got := contentURL("xyz"); got != "/api/v1/photos/xyz/content" {
		t.Errorf("contentURL = %q", got)
	}
	if got := contentURL(""); got != "/api/v1/photos//content" {
		t.Errorf("contentURL(empty) = %q", got)
	}
}

func TestPhotoToProto(t *testing.T) {
	// A fixed non-UTC time exercises the .UTC().Format(RFC3339) shaping.
	loc := time.FixedZone("PST", -8*3600)
	created := time.Date(2024, 3, 2, 1, 0, 0, 0, loc)
	updated := time.Date(2024, 3, 2, 5, 30, 0, 0, loc)

	p := Photo{
		ID:          "p1",
		OrgID:       "o1",
		OwnerID:     "u1",
		Filename:    "beach.jpg",
		ContentType: "image/jpeg",
		Size:        4096,
		Width:       1920,
		Height:      1080,
		Description: "sunset",
		Favorite:    true,
		BlobKey:     "photos/secret-key", // must NOT leak into proto
		CreatedAt:   created,
		UpdatedAt:   updated,
	}
	got := photoToProto(p)

	if got.GetId() != "p1" || got.GetOrgId() != "o1" || got.GetOwnerId() != "u1" {
		t.Errorf("ids: %+v", got)
	}
	if got.GetFilename() != "beach.jpg" || got.GetContentType() != "image/jpeg" {
		t.Errorf("file meta: %+v", got)
	}
	if got.GetSize() != 4096 || got.GetWidth() != 1920 || got.GetHeight() != 1080 {
		t.Errorf("dims: %+v", got)
	}
	if got.GetDescription() != "sunset" || !got.GetFavorite() {
		t.Errorf("editable meta: %+v", got)
	}
	if got.GetContentUrl() != "/api/v1/photos/p1/content" {
		t.Errorf("content_url = %q", got.GetContentUrl())
	}
	// Timestamps normalized to UTC RFC3339.
	if got.GetCreatedAt() != "2024-03-02T09:00:00Z" {
		t.Errorf("created_at = %q", got.GetCreatedAt())
	}
	if got.GetUpdatedAt() != "2024-03-02T13:30:00Z" {
		t.Errorf("updated_at = %q", got.GetUpdatedAt())
	}
	// BlobKey is internal and must never be serialized into the proto.
	// (grownv1.Photo has no blob_key field; this asserts the mapping list above
	// stays complete via the explicit checks rather than reflection.)
}

func TestAlbumToProto_WithCover(t *testing.T) {
	ts := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	a := Album{
		ID:           "a1",
		OrgID:        "o1",
		OwnerID:      "u1",
		Title:        "Trip",
		CoverPhotoID: "cover1",
		PhotoCount:   3,
		CreatedAt:    ts,
		UpdatedAt:    ts,
		Photos: []Photo{
			{ID: "ph1", CreatedAt: ts, UpdatedAt: ts},
			{ID: "ph2", CreatedAt: ts, UpdatedAt: ts},
		},
	}
	got := albumToProto(a)

	if got.GetId() != "a1" || got.GetTitle() != "Trip" || got.GetPhotoCount() != 3 {
		t.Errorf("album meta: %+v", got)
	}
	if got.GetCoverPhotoId() != "cover1" {
		t.Errorf("cover_photo_id = %q", got.GetCoverPhotoId())
	}
	if got.GetCoverUrl() != "/api/v1/photos/cover1/content" {
		t.Errorf("cover_url = %q", got.GetCoverUrl())
	}
	if len(got.GetPhotos()) != 2 {
		t.Fatalf("photos len = %d, want 2", len(got.GetPhotos()))
	}
	if got.GetPhotos()[0].GetId() != "ph1" || got.GetPhotos()[1].GetId() != "ph2" {
		t.Errorf("photos order/mapping: %+v", got.GetPhotos())
	}
	if got.GetCreatedAt() != "2024-01-01T00:00:00Z" {
		t.Errorf("created_at = %q", got.GetCreatedAt())
	}
}

func TestAlbumToProto_NoCover(t *testing.T) {
	ts := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	a := Album{
		ID:         "a2",
		Title:      "Empty",
		PhotoCount: 0,
		CreatedAt:  ts,
		UpdatedAt:  ts,
	}
	got := albumToProto(a)

	if got.GetCoverPhotoId() != "" {
		t.Errorf("cover_photo_id should be empty, got %q", got.GetCoverPhotoId())
	}
	// With no cover photo, cover_url must stay blank (no /content/ URL).
	if got.GetCoverUrl() != "" {
		t.Errorf("cover_url should be empty, got %q", got.GetCoverUrl())
	}
	if len(got.GetPhotos()) != 0 {
		t.Errorf("photos should be empty, got %d", len(got.GetPhotos()))
	}
}
