package audit

import "testing"

func TestSplitFullMethod(t *testing.T) {
	cases := []struct {
		full, wantSvc, wantMethod string
	}{
		{"/grown.v1.VideoService/CreateVideo", "VideoService", "CreateVideo"},
		{"/grown.v1.MailService/DeleteMessage", "MailService", "DeleteMessage"},
		{"/DriveService/UploadFile", "DriveService", "UploadFile"},
		{"NoSlash", "", "NoSlash"},
	}
	for _, c := range cases {
		svc, m := splitFullMethod(c.full)
		if svc != c.wantSvc || m != c.wantMethod {
			t.Errorf("splitFullMethod(%q) = (%q,%q), want (%q,%q)", c.full, svc, m, c.wantSvc, c.wantMethod)
		}
	}
}

func TestIsMutating(t *testing.T) {
	mutating := []string{
		"CreateVideo", "UpdateDoc", "DeleteFile", "TrashItem", "SetSetting",
		"SubmitForm", "PostMessage", "AddMember", "RemoveMember", "MoveFile",
		"CopyFile", "ShareDoc", "RenameFile", "ReorderList", "UpsertContact",
		"GenerateReport",
	}
	for _, m := range mutating {
		if !isMutating(m) {
			t.Errorf("isMutating(%q) = false, want true", m)
		}
	}
	readOnly := []string{
		"ListVideos", "GetVideo", "SearchDocs", "Whoami", "HealthCheck",
		"StreamChanges",
	}
	for _, m := range readOnly {
		if isMutating(m) {
			t.Errorf("isMutating(%q) = true, want false", m)
		}
	}
}

func TestServiceSlug(t *testing.T) {
	cases := map[string]string{
		"VideoService": "video",
		"MailService":  "mail",
		"AuthService":  "auth",
		"Admin":        "admin",
	}
	for in, want := range cases {
		if got := serviceSlug(in); got != want {
			t.Errorf("serviceSlug(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestActionFor(t *testing.T) {
	cases := map[string]string{
		"CreateVideo":    "create",
		"DeleteFile":     "delete",
		"ShareDoc":       "share",
		"UpsertContact":  "upsert",
		"GenerateReport": "generate",
	}
	for in, want := range cases {
		if got := actionFor(in); got != want {
			t.Errorf("actionFor(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestResourceFromPath(t *testing.T) {
	cases := map[string]string{
		"/api/v1/videos/abc123/content":  "abc123",
		"/api/v1/videos/abc123/content/": "abc123",
		"/api/v1/videos/upload":          "",
		"/api/v1/photos/p-9/content":     "p-9",
	}
	for in, want := range cases {
		if got := resourceFromPath(in); got != want {
			t.Errorf("resourceFromPath(%q) = %q, want %q", in, got, want)
		}
	}
}
