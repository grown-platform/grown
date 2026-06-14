package alexa

import (
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// Alexa request validation per Amazon's "Host a Custom Skill as a Web Service"
// security requirements:
//  1. SignatureCertChainUrl header must be an https URL on s3.amazonaws.com
//     with a path under /echo.api/ (and port 443 if present).
//  2. Fetch (and cache) the PEM cert chain; the leaf cert's SAN must include
//     echo-api.amazon.com and the cert must currently be valid + chain to a
//     trusted root.
//  3. Verify the Signature-256 header (base64 RSA SHA-256 signature) over the
//     RAW request body using the leaf cert's public key.
//  4. The request body's timestamp must be within 150 seconds of now.
const (
	certURLHeader   = "SignatureCertChainUrl"
	signatureHeader = "Signature-256"
	echoSANHost     = "echo-api.amazon.com"
	maxClockSkew    = 150 * time.Second
)

// verifier fetches + caches Alexa signing certs and validates request signatures.
type verifier struct {
	client *http.Client
	mu     sync.Mutex
	cache  map[string]*x509.Certificate // cert-chain URL -> validated leaf cert
}

func newVerifier() *verifier {
	return &verifier{
		client: &http.Client{Timeout: 5 * time.Second},
		cache:  make(map[string]*x509.Certificate),
	}
}

// verify validates the inbound Alexa request: header cert URL, cert chain/SAN,
// the RSA signature over body, and the embedded timestamp. Returns nil if the
// request is authentic.
func (v *verifier) verify(h http.Header, body []byte) error {
	certURL := h.Get(certURLHeader)
	sig := h.Get(signatureHeader)
	if certURL == "" || sig == "" {
		return errors.New("missing signature headers")
	}
	if err := validateCertURL(certURL); err != nil {
		return err
	}
	leaf, err := v.leafCert(certURL)
	if err != nil {
		return err
	}
	// Verify the signature over the raw body.
	sigBytes, err := base64.StdEncoding.DecodeString(sig)
	if err != nil {
		return fmt.Errorf("decode signature: %w", err)
	}
	pub, ok := leaf.PublicKey.(*rsa.PublicKey)
	if !ok {
		return errors.New("cert public key is not RSA")
	}
	sum := sha256.Sum256(body)
	if err := rsa.VerifyPKCS1v15(pub, crypto.SHA256, sum[:], sigBytes); err != nil {
		return fmt.Errorf("signature mismatch: %w", err)
	}
	// Validate the request timestamp (replay protection).
	if err := validateTimestamp(body); err != nil {
		return err
	}
	return nil
}

// validateCertURL enforces the Amazon URL constraints on the cert chain URL.
func validateCertURL(raw string) error {
	u, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("bad cert url: %w", err)
	}
	if strings.ToLower(u.Scheme) != "https" {
		return errors.New("cert url not https")
	}
	if strings.ToLower(u.Hostname()) != "s3.amazonaws.com" {
		return errors.New("cert url host not s3.amazonaws.com")
	}
	if p := u.Port(); p != "" && p != "443" {
		return errors.New("cert url port not 443")
	}
	// Normalize the path (collapse ../ etc.) before the prefix check.
	if !strings.HasPrefix(cleanPath(u.Path), "/echo.api/") {
		return errors.New("cert url path not under /echo.api/")
	}
	return nil
}

// leafCert returns a cached, validated leaf cert for the URL, fetching it on a
// cache miss. The cache key is the (already-validated) URL.
func (v *verifier) leafCert(certURL string) (*x509.Certificate, error) {
	v.mu.Lock()
	if c, ok := v.cache[certURL]; ok && time.Now().Before(c.NotAfter) {
		v.mu.Unlock()
		return c, nil
	}
	v.mu.Unlock()

	resp, err := v.client.Get(certURL)
	if err != nil {
		return nil, fmt.Errorf("fetch cert: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fetch cert: status %d", resp.StatusCode)
	}
	pemBytes, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("read cert: %w", err)
	}
	leaf, err := parseAndValidateChain(pemBytes)
	if err != nil {
		return nil, err
	}
	v.mu.Lock()
	v.cache[certURL] = leaf
	v.mu.Unlock()
	return leaf, nil
}

// parseAndValidateChain parses the PEM chain (leaf first, then intermediates),
// verifies it chains to a trusted root, is time-valid, and that the leaf's SAN
// includes echo-api.amazon.com.
func parseAndValidateChain(pemBytes []byte) (*x509.Certificate, error) {
	var certs []*x509.Certificate
	rest := pemBytes
	for {
		var block *pem.Block
		block, rest = pem.Decode(rest)
		if block == nil {
			break
		}
		if block.Type != "CERTIFICATE" {
			continue
		}
		c, err := x509.ParseCertificate(block.Bytes)
		if err != nil {
			return nil, fmt.Errorf("parse cert: %w", err)
		}
		certs = append(certs, c)
	}
	if len(certs) == 0 {
		return nil, errors.New("no certificates in chain")
	}
	leaf := certs[0]

	// SAN must include the Alexa API host.
	if err := leaf.VerifyHostname(echoSANHost); err != nil {
		return nil, fmt.Errorf("cert SAN missing %s: %w", echoSANHost, err)
	}

	// Build the intermediates pool and verify the chain to a system root.
	inter := x509.NewCertPool()
	for _, c := range certs[1:] {
		inter.AddCert(c)
	}
	if _, err := leaf.Verify(x509.VerifyOptions{
		Intermediates: inter,
		CurrentTime:   time.Now(),
	}); err != nil {
		return nil, fmt.Errorf("cert chain not trusted: %w", err)
	}
	return leaf, nil
}

// validateTimestamp parses just the request.timestamp field and checks it is
// within maxClockSkew of now (guards against replays of a captured request).
func validateTimestamp(body []byte) error {
	var probe struct {
		Request struct {
			Timestamp string `json:"timestamp"`
		} `json:"request"`
	}
	if err := json.Unmarshal(body, &probe); err != nil {
		return fmt.Errorf("parse timestamp: %w", err)
	}
	if probe.Request.Timestamp == "" {
		return errors.New("missing request timestamp")
	}
	ts, err := time.Parse(time.RFC3339, probe.Request.Timestamp)
	if err != nil {
		return fmt.Errorf("bad timestamp: %w", err)
	}
	if d := time.Since(ts); d > maxClockSkew || d < -maxClockSkew {
		return errors.New("request timestamp outside tolerance")
	}
	return nil
}

// cleanPath collapses ".." and "." path segments so a crafted cert URL can't
// smuggle a non-/echo.api/ path past the prefix check.
func cleanPath(p string) string {
	if p == "" {
		return "/"
	}
	segs := strings.Split(p, "/")
	out := make([]string, 0, len(segs))
	for _, s := range segs {
		switch s {
		case "", ".":
			// skip
		case "..":
			if len(out) > 0 {
				out = out[:len(out)-1]
			}
		default:
			out = append(out, s)
		}
	}
	res := "/" + strings.Join(out, "/")
	if strings.HasSuffix(p, "/") && res != "/" {
		res += "/"
	}
	return res
}
