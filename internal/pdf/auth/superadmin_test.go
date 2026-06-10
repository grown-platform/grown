package auth

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

type fakeChecker struct {
	allow map[string]bool
	err   error
}

func (f *fakeChecker) IsSuperadmin(ctx context.Context, email string) (bool, error) {
	if f.err != nil {
		return false, f.err
	}
	return f.allow[email], nil
}

func TestIsSuperadmin_EmptyEmailReturnsFalse(t *testing.T) {
	got := IsSuperadmin(context.Background(), &fakeChecker{}, "")
	if got {
		t.Fatal("empty email must be non-superadmin")
	}
}

func TestIsSuperadmin_DBErrorReturnsFalse(t *testing.T) {
	got := IsSuperadmin(context.Background(), &fakeChecker{err: errors.New("boom")}, "lpick@pick.haus")
	if got {
		t.Fatal("DB error must NOT elevate privilege")
	}
}

func TestIsSuperadmin_HitAndMiss(t *testing.T) {
	fc := &fakeChecker{allow: map[string]bool{"lpick@pick.haus": true}}
	if !IsSuperadmin(context.Background(), fc, "lpick@pick.haus") {
		t.Fatal("expected true for granted email")
	}
	if IsSuperadmin(context.Background(), fc, "other@example.com") {
		t.Fatal("expected false for non-granted email")
	}
}

func TestRequireSuperadmin_NoEmail_401(t *testing.T) {
	mw := RequireSuperadmin(&fakeChecker{})
	h := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("inner handler must not run")
	}))
	req := httptest.NewRequest("GET", "/admin/foo", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", w.Code)
	}
}

func TestRequireSuperadmin_NotSuperadmin_403(t *testing.T) {
	mw := RequireSuperadmin(&fakeChecker{})
	h := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("inner handler must not run")
	}))
	req := httptest.NewRequest("GET", "/admin/foo", nil)
	req = req.WithContext(WithUserEmail(req.Context(), "noone@example.com"))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d", w.Code)
	}
}

func TestRequireSuperadmin_Allows(t *testing.T) {
	fc := &fakeChecker{allow: map[string]bool{"lpick@pick.haus": true}}
	mw := RequireSuperadmin(fc)
	ran := false
	h := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ran = true
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest("GET", "/admin/foo", nil)
	req = req.WithContext(WithUserEmail(req.Context(), "lpick@pick.haus"))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if !ran {
		t.Fatal("expected inner handler to run")
	}
	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", w.Code)
	}
}
