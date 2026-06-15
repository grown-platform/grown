package alexa

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"
)

func TestValidateCertURL(t *testing.T) {
	cases := []struct {
		name string
		url  string
		ok   bool
	}{
		{"valid", "https://s3.amazonaws.com/echo.api/echo-api-cert.pem", true},
		{"valid with port 443", "https://s3.amazonaws.com:443/echo.api/cert.pem", true},
		{"valid normalized dotdot", "https://s3.amazonaws.com/echo.api/../echo.api/cert.pem", true},
		{"not https", "http://s3.amazonaws.com/echo.api/cert.pem", false},
		{"wrong host", "https://evil.com/echo.api/cert.pem", false},
		{"wrong port", "https://s3.amazonaws.com:8443/echo.api/cert.pem", false},
		{"path not echo.api", "https://s3.amazonaws.com/notecho/cert.pem", false},
		{"dotdot escape", "https://s3.amazonaws.com/echo.api/../secret/cert.pem", false},
		{"empty", "", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateCertURL(tc.url)
			if tc.ok && err != nil {
				t.Fatalf("validateCertURL(%q) = %v, want nil", tc.url, err)
			}
			if !tc.ok && err == nil {
				t.Fatalf("validateCertURL(%q) = nil, want error", tc.url)
			}
		})
	}
}

func TestCleanPath(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"", "/"},
		{"/echo.api/cert.pem", "/echo.api/cert.pem"},
		{"/echo.api/../secret/cert.pem", "/secret/cert.pem"},
		{"/echo.api/./cert.pem", "/echo.api/cert.pem"},
		{"/a/b/../c", "/a/c"},
		{"/echo.api/", "/echo.api/"},
		{"/../../etc", "/etc"},
	}
	for _, tc := range cases {
		if got := cleanPath(tc.in); got != tc.want {
			t.Errorf("cleanPath(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestValidateTimestamp(t *testing.T) {
	body := func(ts string) []byte {
		b, _ := json.Marshal(map[string]any{"request": map[string]any{"timestamp": ts}})
		return b
	}

	t.Run("valid now", func(t *testing.T) {
		ts := time.Now().UTC().Format(time.RFC3339)
		if err := validateTimestamp(body(ts)); err != nil {
			t.Fatalf("valid timestamp rejected: %v", err)
		}
	})
	t.Run("too old", func(t *testing.T) {
		ts := time.Now().Add(-10 * time.Minute).UTC().Format(time.RFC3339)
		if err := validateTimestamp(body(ts)); err == nil {
			t.Fatal("stale timestamp accepted")
		}
	})
	t.Run("too future", func(t *testing.T) {
		ts := time.Now().Add(10 * time.Minute).UTC().Format(time.RFC3339)
		if err := validateTimestamp(body(ts)); err == nil {
			t.Fatal("future timestamp accepted")
		}
	})
	t.Run("missing", func(t *testing.T) {
		if err := validateTimestamp(body("")); err == nil {
			t.Fatal("missing timestamp accepted")
		}
	})
	t.Run("malformed timestamp", func(t *testing.T) {
		if err := validateTimestamp(body("not-a-time")); err == nil {
			t.Fatal("malformed timestamp accepted")
		}
	})
	t.Run("bad json", func(t *testing.T) {
		if err := validateTimestamp([]byte("{not json")); err == nil {
			t.Fatal("bad json accepted")
		}
	})
}

func TestVerifyMissingHeaders(t *testing.T) {
	v := newVerifier()
	if err := v.verify(http.Header{}, []byte("{}")); err == nil {
		t.Fatal("verify with no headers should fail")
	}
}

func TestVerifyBadCertURL(t *testing.T) {
	v := newVerifier()
	h := http.Header{}
	h.Set(certURLHeader, "https://evil.com/echo.api/cert.pem")
	h.Set(signatureHeader, "AAAA")
	if err := v.verify(h, []byte("{}")); err == nil {
		t.Fatal("verify with disallowed cert URL host should fail")
	}
}

func TestParseAndValidateChainEmpty(t *testing.T) {
	if _, err := parseAndValidateChain([]byte("no pem here")); err == nil {
		t.Fatal("expected error for empty/garbage PEM chain")
	}
}
