package crypto

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"log/slog"
	"math/big"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"code.pick.haus/grown/grown/internal/pdf/database"
	"code.pick.haus/grown/grown/internal/pdf/sqlc"
)

// CertificateAuthority is the interface for certificate issuance.
// Implementations can be self-signed CA (dev) or external CA (Let's Encrypt, DigiCert).
type CertificateAuthority interface {
	// GetOrCreateSignerCertificate returns a certificate for the given signer.
	// If one doesn't exist, it creates one.
	GetOrCreateSignerCertificate(ctx context.Context, orgID, email, name string) (*x509.Certificate, crypto.PrivateKey, error)

	// GetCACertificate returns the CA certificate for the certificate chain.
	GetCACertificate() *x509.Certificate
}

// SelfSignedCA implements CertificateAuthority using a self-signed CA.
// Suitable for development and testing.
type SelfSignedCA struct {
	db       *database.DB
	keystore *Keystore
	caCert   *x509.Certificate
	caKey    *rsa.PrivateKey
	orgID    string
}

// NewSelfSignedCA creates a new self-signed CA.
// It loads or creates the CA certificate on initialization.
func NewSelfSignedCA(ctx context.Context, db *database.DB, keystore *Keystore, orgID string) (*SelfSignedCA, error) {
	ca := &SelfSignedCA{
		db:       db,
		keystore: keystore,
		orgID:    orgID,
	}

	// Try to load existing CA certificate
	if err := ca.loadOrCreateCA(ctx); err != nil {
		return nil, fmt.Errorf("failed to initialize CA: %w", err)
	}

	return ca, nil
}

func (ca *SelfSignedCA) loadOrCreateCA(ctx context.Context) error {
	// Try to load existing CA from database
	caCert, err := ca.db.Queries.GetActiveCertificateByOrg(ctx, ca.orgID)

	if err == nil {
		// Found existing CA, load it
		return ca.loadCA(caCert)
	}

	// No CA exists, create one
	slog.Info("No CA certificate found, generating new self-signed CA", "orgId", ca.orgID)
	return ca.createCA(ctx)
}

func (ca *SelfSignedCA) loadCA(certRecord sqlc.SigningCertificate) error {
	// Parse the certificate
	block, _ := pem.Decode([]byte(certRecord.CertificatePem))
	if block == nil {
		return fmt.Errorf("failed to decode CA certificate PEM")
	}

	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return fmt.Errorf("failed to parse CA certificate: %w", err)
	}

	// Decrypt the private key
	keyBytes, err := ca.keystore.DecryptPrivateKey(certRecord.PrivateKeyEncrypted)
	if err != nil {
		return fmt.Errorf("failed to decrypt CA private key: %w", err)
	}

	key, err := x509.ParsePKCS1PrivateKey(keyBytes)
	if err != nil {
		return fmt.Errorf("failed to parse CA private key: %w", err)
	}

	ca.caCert = cert
	ca.caKey = key

	slog.Info("Loaded existing CA certificate",
		"subject", cert.Subject.CommonName,
		"serial", cert.SerialNumber.String(),
		"validTo", cert.NotAfter)

	return nil
}

func (ca *SelfSignedCA) createCA(ctx context.Context) error {
	// Generate 4096-bit RSA key for CA
	caKey, err := rsa.GenerateKey(rand.Reader, 4096)
	if err != nil {
		return fmt.Errorf("failed to generate CA key: %w", err)
	}

	// Create CA certificate template
	serialNumber, err := generateSerialNumber()
	if err != nil {
		return fmt.Errorf("failed to generate serial number: %w", err)
	}

	now := time.Now()
	caTemplate := &x509.Certificate{
		SerialNumber: serialNumber,
		Subject: pkix.Name{
			Organization:       []string{"Pdf"},
			OrganizationalUnit: []string{"Document Signing CA"},
			CommonName:         "Pdf Document Signing CA",
			Country:            []string{"US"},
		},
		NotBefore:             now,
		NotAfter:              now.AddDate(10, 0, 0), // 10 year validity
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign | x509.KeyUsageDigitalSignature,
		BasicConstraintsValid: true,
		IsCA:                  true,
		MaxPathLen:            1,
	}

	// Self-sign the CA certificate
	caCertDER, err := x509.CreateCertificate(rand.Reader, caTemplate, caTemplate, &caKey.PublicKey, caKey)
	if err != nil {
		return fmt.Errorf("failed to create CA certificate: %w", err)
	}

	caCert, err := x509.ParseCertificate(caCertDER)
	if err != nil {
		return fmt.Errorf("failed to parse created CA certificate: %w", err)
	}

	// Encode certificate to PEM
	certPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "CERTIFICATE",
		Bytes: caCertDER,
	})

	// Encrypt private key
	keyBytes := x509.MarshalPKCS1PrivateKey(caKey)
	encryptedKey, err := ca.keystore.EncryptPrivateKey(keyBytes)
	if err != nil {
		return fmt.Errorf("failed to encrypt CA private key: %w", err)
	}

	// Store in database
	certID := "cert_" + uuid.New().String()
	_, err = ca.db.Queries.CreateSigningCertificate(ctx, sqlc.CreateSigningCertificateParams{
		ID:                  certID,
		OrganizationID:      ca.orgID,
		CertificateType:     sqlc.CertificateTypeOrganization,
		Status:              sqlc.CertificateStatusActive,
		CertificatePem:      string(certPEM),
		PrivateKeyEncrypted: encryptedKey,
		KeyEncryptionKeyID:  "default", // In production, use KMS key ID
		SerialNumber:        serialNumber.String(),
		IssuerDn:            caCert.Issuer.String(),
		SubjectDn:           caCert.Subject.String(),
		ValidFrom:           pgtype.Timestamptz{Time: caCert.NotBefore, Valid: true},
		ValidTo:             pgtype.Timestamptz{Time: caCert.NotAfter, Valid: true},
		CaName:              "Pdf Self-Signed CA",
		CaCertificateChain:  string(certPEM), // Self-signed, so chain is just itself
	})
	if err != nil {
		return fmt.Errorf("failed to store CA certificate: %w", err)
	}

	ca.caCert = caCert
	ca.caKey = caKey

	slog.Info("Created new self-signed CA certificate",
		"certId", certID,
		"serial", serialNumber.String(),
		"validTo", caCert.NotAfter)

	return nil
}

// GetOrCreateSignerCertificate returns a certificate for signing documents.
func (ca *SelfSignedCA) GetOrCreateSignerCertificate(ctx context.Context, orgID, email, name string) (*x509.Certificate, crypto.PrivateKey, error) {
	// For simplicity, we'll generate a new certificate for each signing operation.
	// In production, you might want to cache these per-user.

	// Generate 2048-bit RSA key for signer
	signerKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to generate signer key: %w", err)
	}

	serialNumber, err := generateSerialNumber()
	if err != nil {
		return nil, nil, fmt.Errorf("failed to generate serial number: %w", err)
	}

	now := time.Now()
	signerTemplate := &x509.Certificate{
		SerialNumber: serialNumber,
		Subject: pkix.Name{
			CommonName:   name,
			Organization: []string{"Pdf User"},
			Country:      []string{"US"},
		},
		EmailAddresses:        []string{email},
		NotBefore:             now,
		NotAfter:              now.AddDate(1, 0, 0), // 1 year validity
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageContentCommitment,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageEmailProtection},
		BasicConstraintsValid: true,
		IsCA:                  false,
	}

	// Sign with CA
	signerCertDER, err := x509.CreateCertificate(rand.Reader, signerTemplate, ca.caCert, &signerKey.PublicKey, ca.caKey)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to create signer certificate: %w", err)
	}

	signerCert, err := x509.ParseCertificate(signerCertDER)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to parse signer certificate: %w", err)
	}

	slog.Info("Issued signer certificate",
		"name", name,
		"email", email,
		"serial", serialNumber.String(),
		"validTo", signerCert.NotAfter)

	return signerCert, signerKey, nil
}

// GetCACertificate returns the CA certificate for building certificate chains.
func (ca *SelfSignedCA) GetCACertificate() *x509.Certificate {
	return ca.caCert
}

// generateSerialNumber generates a random serial number for certificates.
func generateSerialNumber() (*big.Int, error) {
	serialNumberLimit := new(big.Int).Lsh(big.NewInt(1), 128)
	return rand.Int(rand.Reader, serialNumberLimit)
}
