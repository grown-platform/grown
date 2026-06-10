package sig

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"math/big"
	"testing"
	"time"
)

func mkRSACA(t *testing.T, cn string) (*x509.Certificate, *rsa.PrivateKey) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	tmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: cn},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(time.Hour),
		IsCA:                  true,
		BasicConstraintsValid: true,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	return cert, key
}

func mkRSALeaf(t *testing.T, ca *x509.Certificate, caKey *rsa.PrivateKey, email string) (*x509.Certificate, *rsa.PrivateKey) {
	t.Helper()
	leafKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	tmpl := &x509.Certificate{
		SerialNumber:   big.NewInt(2),
		Subject:        pkix.Name{CommonName: "Test Signer"},
		EmailAddresses: []string{email},
		NotBefore:      time.Now().Add(-time.Hour),
		NotAfter:       time.Now().Add(time.Hour),
		KeyUsage:       x509.KeyUsageDigitalSignature,
		ExtKeyUsage:    []x509.ExtKeyUsage{x509.ExtKeyUsageEmailProtection},
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, ca, &leafKey.PublicKey, caKey)
	if err != nil {
		t.Fatal(err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	return cert, leafKey
}

func TestVerifyClientSignature_HappyPath(t *testing.T) {
	ca, caKey := mkRSACA(t, "Test Root")
	leaf, leafKey := mkRSALeaf(t, ca, caKey, "alice@example.com")

	pool := x509.NewCertPool()
	pool.AddCert(ca)

	hash := sha256.Sum256([]byte("the document"))
	sig, err := rsa.SignPKCS1v15(rand.Reader, leafKey, crypto.SHA256, hash[:])
	if err != nil {
		t.Fatal(err)
	}

	err = VerifyClientSignature(VerifyParams{
		Cert:          leaf,
		Signature:     sig,
		Hash:          hash[:],
		HashAlgorithm: "SHA256",
		ExpectedEmail: "alice@example.com",
		Roots:         pool,
		Now:           time.Now(),
	})
	if err != nil {
		t.Fatalf("expected verification to succeed, got %v", err)
	}
}

func TestVerifyClientSignature_ChainFailsWithoutRoot(t *testing.T) {
	ca, caKey := mkRSACA(t, "Test Root")
	leaf, leafKey := mkRSALeaf(t, ca, caKey, "alice@example.com")

	emptyPool := x509.NewCertPool()

	hash := sha256.Sum256([]byte("doc"))
	sig, _ := rsa.SignPKCS1v15(rand.Reader, leafKey, crypto.SHA256, hash[:])

	err := VerifyClientSignature(VerifyParams{
		Cert:          leaf,
		Signature:     sig,
		Hash:          hash[:],
		HashAlgorithm: "SHA256",
		ExpectedEmail: "alice@example.com",
		Roots:         emptyPool,
		Now:           time.Now(),
	})
	if err == nil {
		t.Fatal("expected chain error, got nil")
	}
}

func TestVerifyClientSignature_EmailMismatchFails(t *testing.T) {
	ca, caKey := mkRSACA(t, "Test Root")
	leaf, leafKey := mkRSALeaf(t, ca, caKey, "alice@example.com")

	pool := x509.NewCertPool()
	pool.AddCert(ca)

	hash := sha256.Sum256([]byte("doc"))
	sig, _ := rsa.SignPKCS1v15(rand.Reader, leafKey, crypto.SHA256, hash[:])

	err := VerifyClientSignature(VerifyParams{
		Cert:          leaf,
		Signature:     sig,
		Hash:          hash[:],
		HashAlgorithm: "SHA256",
		ExpectedEmail: "bob@example.com",
		Roots:         pool,
		Now:           time.Now(),
	})
	if err == nil {
		t.Fatal("expected email mismatch error")
	}
}

func TestVerifyClientSignature_TamperedSignatureFails(t *testing.T) {
	ca, caKey := mkRSACA(t, "Test Root")
	leaf, leafKey := mkRSALeaf(t, ca, caKey, "alice@example.com")

	pool := x509.NewCertPool()
	pool.AddCert(ca)

	hash := sha256.Sum256([]byte("doc"))
	sig, _ := rsa.SignPKCS1v15(rand.Reader, leafKey, crypto.SHA256, hash[:])
	sig[0] ^= 0xff

	err := VerifyClientSignature(VerifyParams{
		Cert:          leaf,
		Signature:     sig,
		Hash:          hash[:],
		HashAlgorithm: "SHA256",
		ExpectedEmail: "alice@example.com",
		Roots:         pool,
		Now:           time.Now(),
	})
	if err == nil {
		t.Fatal("expected signature verification failure")
	}
}

func TestVerifyClientSignature_ECDSACertPath(t *testing.T) {
	caKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	caTmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "ECDSA Root"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(time.Hour),
		IsCA:                  true,
		BasicConstraintsValid: true,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature,
	}
	caDER, err := x509.CreateCertificate(rand.Reader, caTmpl, caTmpl, &caKey.PublicKey, caKey)
	if err != nil {
		t.Fatal(err)
	}
	ca, _ := x509.ParseCertificate(caDER)

	leafKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	leafTmpl := &x509.Certificate{
		SerialNumber:   big.NewInt(2),
		Subject:        pkix.Name{CommonName: "ECDSA Signer"},
		EmailAddresses: []string{"alice@example.com"},
		NotBefore:      time.Now().Add(-time.Hour),
		NotAfter:       time.Now().Add(time.Hour),
		KeyUsage:       x509.KeyUsageDigitalSignature,
	}
	leafDER, err := x509.CreateCertificate(rand.Reader, leafTmpl, ca, &leafKey.PublicKey, caKey)
	if err != nil {
		t.Fatal(err)
	}
	leaf, _ := x509.ParseCertificate(leafDER)

	pool := x509.NewCertPool()
	pool.AddCert(ca)

	hash := sha256.Sum256([]byte("doc"))
	sig, err := ecdsa.SignASN1(rand.Reader, leafKey, hash[:])
	if err != nil {
		t.Fatal(err)
	}

	err = VerifyClientSignature(VerifyParams{
		Cert:          leaf,
		Signature:     sig,
		Hash:          hash[:],
		HashAlgorithm: "SHA256",
		ExpectedEmail: "alice@example.com",
		Roots:         pool,
		Now:           time.Now(),
	})
	if err != nil {
		t.Fatalf("expected ECDSA verification to succeed, got %v", err)
	}
}

func TestVerifyClientSignature_EmailMatchIsCaseInsensitive(t *testing.T) {
	ca, caKey := mkRSACA(t, "Root")
	leaf, leafKey := mkRSALeaf(t, ca, caKey, "Alice@Example.COM")

	pool := x509.NewCertPool()
	pool.AddCert(ca)

	hash := sha256.Sum256([]byte("doc"))
	sig, _ := rsa.SignPKCS1v15(rand.Reader, leafKey, crypto.SHA256, hash[:])

	err := VerifyClientSignature(VerifyParams{
		Cert:          leaf,
		Signature:     sig,
		Hash:          hash[:],
		HashAlgorithm: "SHA256",
		ExpectedEmail: "alice@example.com",
		Roots:         pool,
		Now:           time.Now(),
	})
	if err != nil {
		t.Fatalf("expected case-insensitive match, got %v", err)
	}
}
