package projects

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func sign(body, secret string) string {
	m := hmac.New(sha256.New, []byte(secret))
	m.Write([]byte(body))
	return hex.EncodeToString(m.Sum(nil))
}

func TestVerifySignature(t *testing.T) {
	body := `{"x":1}`
	sig := sign(body, "s3cr3t")
	if !verifyForgejoSignature([]byte(body), sig, "s3cr3t") {
		t.Fatal("valid signature rejected")
	}
	if verifyForgejoSignature([]byte(body), sig, "wrong") {
		t.Fatal("invalid secret accepted")
	}
	if verifyForgejoSignature([]byte(body), "deadbeef", "s3cr3t") {
		t.Fatal("bad signature accepted")
	}
}

func TestHandleForgejoWebhook_RejectsBadSignature(t *testing.T) {
	s := &Service{ForgejoWebhookSecret: "s3cr3t"}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/forgejo/webhook", strings.NewReader(`{}`))
	req.Header.Set("X-Forgejo-Event", "push")
	req.Header.Set("X-Forgejo-Signature", "deadbeef")
	rec := httptest.NewRecorder()
	s.HandleForgejoWebhook(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d want 401", rec.Code)
	}
}

func TestHandleForgejoWebhook_DisabledWhenNoSecret(t *testing.T) {
	s := &Service{}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/forgejo/webhook", strings.NewReader(`{}`))
	rec := httptest.NewRecorder()
	s.HandleForgejoWebhook(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status=%d want 503", rec.Code)
	}
}
