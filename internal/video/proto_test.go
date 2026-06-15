package video

import (
	"testing"
	"time"
)

// These tests exercise the pure domain->proto mapping functions. They require
// no database. They pin field mapping, RFC3339 UTC time formatting, and the
// derived stream/watch URLs.

var fixedTime = time.Date(2026, 6, 11, 15, 4, 5, 0, time.FixedZone("EST", -5*60*60))

func TestToProto(t *testing.T) {
	v := Video{
		ID:               "vid1",
		OrgID:            "org1",
		OwnerID:          "user1",
		Title:            "Clip",
		Description:      "desc",
		ContentType:      "video/mp4",
		Size:             999,
		DurationSeconds:  12.5,
		ThumbnailDataURL: "data:thumb",
		BlobKey:          "video/secret-key", // must NOT leak into proto
		CreatedAt:        fixedTime,
		UpdatedAt:        fixedTime.Add(time.Hour),
	}
	p := toProto(v)
	if p.GetId() != "vid1" || p.GetOrgId() != "org1" || p.GetOwnerId() != "user1" {
		t.Errorf("id/org/owner mismatch: %+v", p)
	}
	if p.GetTitle() != "Clip" || p.GetDescription() != "desc" || p.GetContentType() != "video/mp4" {
		t.Errorf("title/desc/ct mismatch: %+v", p)
	}
	if p.GetSize() != 999 || p.GetDurationSeconds() != 12.5 || p.GetThumbnailDataUrl() != "data:thumb" {
		t.Errorf("size/dur/thumb mismatch: %+v", p)
	}
	if p.GetStreamUrl() != "/api/v1/videos/vid1/content" {
		t.Errorf("stream url: %q", p.GetStreamUrl())
	}
	// RFC3339 in UTC: EST 15:04:05 -> 20:04:05Z.
	if p.GetCreatedAt() != "2026-06-11T20:04:05Z" {
		t.Errorf("created_at: %q", p.GetCreatedAt())
	}
	if p.GetUpdatedAt() != "2026-06-11T21:04:05Z" {
		t.Errorf("updated_at: %q", p.GetUpdatedAt())
	}
	// BlobKey is internal and has no proto field; nothing to assert except that
	// the mapping compiled without exposing it.
}

func TestToVideoPlaylistProto(t *testing.T) {
	p := toVideoPlaylistProto(VideoPlaylist{
		ID:          "pl1",
		OrgID:       "org1",
		OwnerUserID: "user1",
		Name:        "Faves",
		CreatedAt:   fixedTime,
		ItemCount:   3,
	})
	if p.GetId() != "pl1" || p.GetOrgId() != "org1" || p.GetOwnerUserId() != "user1" {
		t.Errorf("ids mismatch: %+v", p)
	}
	if p.GetName() != "Faves" || p.GetItemCount() != 3 {
		t.Errorf("name/count mismatch: %+v", p)
	}
	if p.GetCreatedAt() != "2026-06-11T20:04:05Z" {
		t.Errorf("created_at: %q", p.GetCreatedAt())
	}
}

func TestToUserShareProto(t *testing.T) {
	p := toUserShareProto(UserShare{
		VideoID:   "vid1",
		UserID:    "user1",
		UserName:  "Alice",
		UserEmail: "alice@example.com",
		CreatedAt: fixedTime,
	})
	if p.GetVideoId() != "vid1" || p.GetUserId() != "user1" {
		t.Errorf("ids mismatch: %+v", p)
	}
	if p.GetUserName() != "Alice" || p.GetUserEmail() != "alice@example.com" {
		t.Errorf("name/email mismatch: %+v", p)
	}
	if p.GetCreatedAt() != "2026-06-11T20:04:05Z" {
		t.Errorf("created_at: %q", p.GetCreatedAt())
	}
}

func TestToShareLinkProto(t *testing.T) {
	t.Run("with expiry and host", func(t *testing.T) {
		exp := fixedTime.Add(24 * time.Hour)
		p := toShareLinkProto(ShareLink{
			Token:     "tok123",
			VideoID:   "vid1",
			OrgID:     "org1",
			CreatedBy: "user1",
			ExpiresAt: &exp,
			CreatedAt: fixedTime,
		}, "https://watch.example.com")
		if p.GetToken() != "tok123" || p.GetVideoId() != "vid1" || p.GetOrgId() != "org1" {
			t.Errorf("ids mismatch: %+v", p)
		}
		if p.GetCreatedBy() != "user1" {
			t.Errorf("created_by mismatch: %+v", p)
		}
		if p.GetUrl() != "https://watch.example.com/video/watch/tok123" {
			t.Errorf("url: %q", p.GetUrl())
		}
		if p.GetExpiresAt() != "2026-06-12T20:04:05Z" {
			t.Errorf("expires_at: %q", p.GetExpiresAt())
		}
		if p.GetCreatedAt() != "2026-06-11T20:04:05Z" {
			t.Errorf("created_at: %q", p.GetCreatedAt())
		}
	})

	t.Run("nil expiry yields empty string", func(t *testing.T) {
		p := toShareLinkProto(ShareLink{
			Token:     "tok",
			ExpiresAt: nil,
			CreatedAt: fixedTime,
		}, "")
		if p.GetExpiresAt() != "" {
			t.Errorf("nil expiry should map to empty, got %q", p.GetExpiresAt())
		}
		// Empty host still produces a relative-ish watch URL.
		if p.GetUrl() != "/video/watch/tok" {
			t.Errorf("url with empty host: %q", p.GetUrl())
		}
	})
}

func TestToCaptionProto(t *testing.T) {
	p := toCaptionProto(Caption{
		ID:        "cap1",
		OrgID:     "org1",
		VideoID:   "vid1",
		Lang:      "en",
		Label:     "English",
		BlobKey:   "caption/secret", // internal only
		CreatedAt: fixedTime,
	})
	if p.GetId() != "cap1" || p.GetOrgId() != "org1" || p.GetVideoId() != "vid1" {
		t.Errorf("ids mismatch: %+v", p)
	}
	if p.GetLang() != "en" || p.GetLabel() != "English" {
		t.Errorf("lang/label mismatch: %+v", p)
	}
	if p.GetStreamUrl() != "/api/v1/videos/captions/cap1/content" {
		t.Errorf("stream url: %q", p.GetStreamUrl())
	}
	if p.GetCreatedAt() != "2026-06-11T20:04:05Z" {
		t.Errorf("created_at: %q", p.GetCreatedAt())
	}
}

func TestToProgressProto(t *testing.T) {
	p := toProgressProto(Progress{
		VideoID:         "vid1",
		PositionSeconds: 42.0,
		Percent:         0.75,
		Watched:         true,
		UpdatedAt:       fixedTime,
	})
	if p.GetVideoId() != "vid1" {
		t.Errorf("video id mismatch: %+v", p)
	}
	if p.GetPositionSeconds() != 42.0 || p.GetPercent() != 0.75 || !p.GetWatched() {
		t.Errorf("position/percent/watched mismatch: %+v", p)
	}
	if p.GetUpdatedAt() != "2026-06-11T20:04:05Z" {
		t.Errorf("updated_at: %q", p.GetUpdatedAt())
	}
}
