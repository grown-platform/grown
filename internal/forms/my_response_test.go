package forms

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestServeMyResponse_Unauthenticated(t *testing.T) {
	svc := NewService(nil)
	rec := httptest.NewRecorder()
	svc.ServeMyResponse(rec, httptest.NewRequest(http.MethodGet, "/api/v1/forms/x/my-response", nil), "x")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status: got %d want 401 (%s)", rec.Code, rec.Body.String())
	}
}

func TestServeMyResponse_MethodNotAllowed(t *testing.T) {
	svc := NewService(nil)
	rec := httptest.NewRecorder()
	svc.ServeMyResponse(rec, httptest.NewRequest(http.MethodPost, "/api/v1/forms/x/my-response", nil), "x")
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status: got %d want 405", rec.Code)
	}
}
