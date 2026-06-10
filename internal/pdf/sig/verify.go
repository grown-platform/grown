// Package sig provides signature verification helpers used at signing time
// (CompleteSignature) and at audit time (VerifyDocument).
package sig

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/rsa"
	"crypto/x509"
	"encoding/asn1"
	"fmt"
	"strings"
	"time"
)

// VerifyParams bundles all inputs for VerifyClientSignature.
type VerifyParams struct {
	// Cert is the parsed signer certificate.
	Cert *x509.Certificate
	// Signature is the raw signature bytes (no PKCS#7 envelope).
	Signature []byte
	// Hash is the document hash the signature should validate against.
	Hash []byte
	// HashAlgorithm is one of: "SHA256", "SHA384", "SHA512".
	HashAlgorithm string
	// ExpectedEmail is the email asserted by the signer record; the cert
	// must carry this email (SAN rfc822Name or subject emailAddress, case-insensitive).
	ExpectedEmail string
	// Roots is the trust anchor pool.
	Roots *x509.CertPool
	// Intermediates is optional — additional intermediate certs supplied by the client.
	Intermediates *x509.CertPool
	// Now is the time used for chain validity. Pass time.Now() in production.
	Now time.Time
}

// VerifyClientSignature checks all four invariants:
//  1. Cert chains to one of Roots at time Now.
//  2. Cert carries ExpectedEmail in its SAN or subject (case-insensitive).
//  3. HashAlgorithm + Cert.PublicKeyAlgorithm combine into a supported x509.SignatureAlgorithm.
//  4. Signature is a valid signature over Hash under Cert.PublicKey.
//
// Returns nil on full success, error on any failure.
func VerifyClientSignature(p VerifyParams) error {
	if p.Cert == nil {
		return fmt.Errorf("nil cert")
	}
	if p.Roots == nil {
		return fmt.Errorf("nil roots pool")
	}

	opts := x509.VerifyOptions{
		Roots:         p.Roots,
		Intermediates: p.Intermediates,
		CurrentTime:   p.Now,
		KeyUsages:     []x509.ExtKeyUsage{x509.ExtKeyUsageAny},
	}
	if _, err := p.Cert.Verify(opts); err != nil {
		return fmt.Errorf("cert chain: %w", err)
	}

	wantEmail := strings.ToLower(strings.TrimSpace(p.ExpectedEmail))
	if wantEmail == "" {
		return fmt.Errorf("expected email is empty")
	}
	if !certHasEmail(p.Cert, wantEmail) {
		return fmt.Errorf("certificate does not carry expected email %q", p.ExpectedEmail)
	}

	hashFunc, err := mapHashAlgorithm(p.HashAlgorithm)
	if err != nil {
		return err
	}

	if err := verifyRawSignature(p.Cert.PublicKey, hashFunc, p.Hash, p.Signature); err != nil {
		return fmt.Errorf("signature invalid: %w", err)
	}
	return nil
}

// verifyRawSignature verifies a raw signature (not a PKCS#7 envelope) over an
// already-hashed digest using the provided public key.
func verifyRawSignature(pub crypto.PublicKey, hashFunc crypto.Hash, hash, sig []byte) error {
	switch key := pub.(type) {
	case *rsa.PublicKey:
		return rsa.VerifyPKCS1v15(key, hashFunc, hash, sig)
	case *ecdsa.PublicKey:
		if !ecdsa.VerifyASN1(key, hash, sig) {
			return fmt.Errorf("ECDSA verification failure")
		}
		return nil
	default:
		return fmt.Errorf("unsupported public key type %T", pub)
	}
}

// mapHashAlgorithm maps a hash algorithm name to a crypto.Hash constant.
func mapHashAlgorithm(hashAlgo string) (crypto.Hash, error) {
	switch strings.ToUpper(hashAlgo) {
	case "SHA256":
		return crypto.SHA256, nil
	case "SHA384":
		return crypto.SHA384, nil
	case "SHA512":
		return crypto.SHA512, nil
	}
	return 0, fmt.Errorf("unsupported hash algorithm: %s", hashAlgo)
}

// MapSignatureAlgorithm picks the x509.SignatureAlgorithm constant for the
// given hash name + key algorithm. Returns an error for unsupported combos.
func MapSignatureAlgorithm(hashAlgo string, keyAlgo x509.PublicKeyAlgorithm) (x509.SignatureAlgorithm, error) {
	switch strings.ToUpper(hashAlgo) {
	case "SHA256":
		switch keyAlgo {
		case x509.RSA:
			return x509.SHA256WithRSA, nil
		case x509.ECDSA:
			return x509.ECDSAWithSHA256, nil
		}
	case "SHA384":
		switch keyAlgo {
		case x509.RSA:
			return x509.SHA384WithRSA, nil
		case x509.ECDSA:
			return x509.ECDSAWithSHA384, nil
		}
	case "SHA512":
		switch keyAlgo {
		case x509.RSA:
			return x509.SHA512WithRSA, nil
		case x509.ECDSA:
			return x509.ECDSAWithSHA512, nil
		}
	}
	return 0, fmt.Errorf("unsupported hash/key combination: %s + %v", hashAlgo, keyAlgo)
}

// emailAddressOID identifies the subject emailAddress attribute.
var emailAddressOID = asn1.ObjectIdentifier{1, 2, 840, 113549, 1, 9, 1}

func certHasEmail(cert *x509.Certificate, lowerEmail string) bool {
	for _, e := range cert.EmailAddresses {
		if strings.ToLower(strings.TrimSpace(e)) == lowerEmail {
			return true
		}
	}
	if subjEmail := subjectEmailFromCert(cert); subjEmail != "" {
		if strings.ToLower(strings.TrimSpace(subjEmail)) == lowerEmail {
			return true
		}
	}
	return false
}

func subjectEmailFromCert(cert *x509.Certificate) string {
	for _, name := range cert.Subject.Names {
		if name.Type.Equal(emailAddressOID) {
			if s, ok := name.Value.(string); ok {
				return s
			}
		}
	}
	return ""
}

// LoadCAPool reads PEM-encoded root certificates from path into a fresh CertPool.
// Returns an error if the file cannot be read or contains zero certificates.
func LoadCAPool(path string, readFile func(string) ([]byte, error)) (*x509.CertPool, error) {
	data, err := readFile(path)
	if err != nil {
		return nil, fmt.Errorf("read CA bundle %s: %w", path, err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(data) {
		return nil, fmt.Errorf("no certificates parsed from CA bundle %s", path)
	}
	return pool, nil
}
