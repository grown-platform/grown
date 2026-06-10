package crypto

import (
	"bytes"
	"crypto"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/pem"
	"fmt"
	"io"
	"log/slog"
	"time"

	"github.com/digitorus/pdf"
	"github.com/digitorus/pdfsign/sign"
)

// extractPKCS7FromSignedPDF scans a signed PDF for the most recent
// /Contents<HEX...> block written by digitorus/pdfsign and returns the
// decoded PKCS#7 bytes. pdfsign writes the PKCS#7 signature into the
// approval signature dictionary as a hex-encoded byte string padded with
// trailing zeros up to SignatureMaxLength. We strip the trailing 0x00
// padding so the returned slice is just the CMS/PKCS#7 envelope.
//
// Returns nil if no /Contents<...> block was found. The caller is
// responsible for deciding whether that's an error.
func extractPKCS7FromSignedPDF(pdfBytes []byte) []byte {
	// Find the last occurrence — multi-signature PDFs accumulate
	// /Contents<> blocks; the most recent corresponds to our just-applied
	// signature.
	needle := []byte("/Contents<")
	idx := bytes.LastIndex(pdfBytes, needle)
	if idx < 0 {
		return nil
	}
	start := idx + len(needle)
	end := bytes.IndexByte(pdfBytes[start:], '>')
	if end < 0 {
		return nil
	}
	hexStr := pdfBytes[start : start+end]
	// Trim trailing zero hex padding ("00" pairs). pdfsign pre-allocates
	// SignatureMaxLength zeros; the real PKCS#7 occupies the prefix.
	for len(hexStr) >= 2 && hexStr[len(hexStr)-1] == '0' && hexStr[len(hexStr)-2] == '0' {
		hexStr = hexStr[:len(hexStr)-2]
	}
	if len(hexStr) == 0 {
		return nil
	}
	decoded := make([]byte, hex.DecodedLen(len(hexStr)))
	n, err := hex.Decode(decoded, hexStr)
	if err != nil {
		return nil
	}
	return decoded[:n]
}

// SignOptions configures the PDF signing operation.
type SignOptions struct {
	// Signer information
	Name        string
	Location    string
	Reason      string
	ContactInfo string

	// Visual appearance (optional)
	ShowVisualSignature bool
	Page                uint32  // 1-indexed page number
	X                   float64 // X position in points from bottom-left
	Y                   float64 // Y position in points from bottom-left
	Width               float64 // Width in points
	Height              float64 // Height in points

	// Timestamp server URL (optional)
	TSAUrl string
}

// SignatureInfo contains information about the generated signature.
type SignatureInfo struct {
	// The raw PKCS#7/CMS signature data
	SignatureData []byte

	// Document hash at signing time
	DocumentHash  string
	HashAlgorithm string

	// Certificate information
	CertificatePEM   string
	CertificateChain string
	Issuer           string
	SerialNumber     string
	ValidFrom        time.Time
	ValidTo          time.Time

	// Signing time
	SigningTimestamp time.Time
}

// PDFSigner handles cryptographic signing of PDF documents.
type PDFSigner struct {
	ca CertificateAuthority
}

// NewPDFSigner creates a new PDF signer with the given certificate authority.
func NewPDFSigner(ca CertificateAuthority) *PDFSigner {
	return &PDFSigner{ca: ca}
}

// SignPDF creates a cryptographically signed PDF.
// It returns the signed PDF bytes and signature metadata.
func (s *PDFSigner) SignPDF(pdfBytes []byte, cert *x509.Certificate, key crypto.Signer, opts SignOptions) ([]byte, *SignatureInfo, error) {
	// Calculate document hash before signing
	docHash := sha256.Sum256(pdfBytes)
	docHashHex := hex.EncodeToString(docHash[:])

	// Create input reader
	input := bytes.NewReader(pdfBytes)

	// Parse the PDF
	pdfReader, err := pdf.NewReader(input, int64(len(pdfBytes)))
	if err != nil {
		return nil, nil, fmt.Errorf("failed to parse PDF: %w", err)
	}

	// Build certificate chain
	caCert := s.ca.GetCACertificate()
	var certChain [][]*x509.Certificate
	if caCert != nil && caCert.SerialNumber.Cmp(cert.SerialNumber) != 0 {
		// Different CA cert - include in chain
		certChain = [][]*x509.Certificate{{cert, caCert}}
	} else {
		// Self-signed cert or same as CA - use single cert chain
		certChain = [][]*x509.Certificate{{cert}}
	}

	// Prepare sign data
	signData := sign.SignData{
		Signature: sign.SignDataSignature{
			CertType:   sign.ApprovalSignature,
			DocMDPPerm: sign.AllowFillingExistingFormFieldsAndSignaturesPerms,
			Info: sign.SignDataSignatureInfo{
				Name:        opts.Name,
				Location:    opts.Location,
				Reason:      opts.Reason,
				ContactInfo: opts.ContactInfo,
				Date:        time.Now(),
			},
		},
		Signer:            key,
		DigestAlgorithm:   crypto.SHA256,
		Certificate:       cert,
		CertificateChains: certChain,
	}

	// Add visual appearance if requested
	if opts.ShowVisualSignature && opts.Page > 0 {
		signData.Appearance = sign.Appearance{
			Visible:     true,
			Page:        opts.Page,
			LowerLeftX:  opts.X,
			LowerLeftY:  opts.Y,
			UpperRightX: opts.X + opts.Width,
			UpperRightY: opts.Y + opts.Height,
		}
	}

	// Add TSA if configured
	if opts.TSAUrl != "" {
		signData.TSA = sign.TSA{
			URL: opts.TSAUrl,
		}
	}

	// Reset reader position
	input.Seek(0, io.SeekStart)

	// Create output buffer
	output := &bytes.Buffer{}

	// Sign the PDF
	err = sign.Sign(input, output, pdfReader, int64(len(pdfBytes)), signData)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to sign PDF: %w", err)
	}

	// Encode certificate to PEM
	certPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "CERTIFICATE",
		Bytes: cert.Raw,
	})

	// Encode CA certificate
	caCertPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "CERTIFICATE",
		Bytes: caCert.Raw,
	})

	// Extract the embedded PKCS#7/CMS signature blob from the freshly
	// signed PDF. We persist this to satisfy signatures.signature_data
	// (BYTEA NOT NULL) and to give callers something concrete to verify
	// against later. If extraction fails for any reason we fall back to a
	// 32-byte SHA-256 of the signed PDF so the column never ends up NULL —
	// the cryptographic signature is still embedded in the returned PDF
	// either way, this just keeps the DB row consistent.
	signedBytes := output.Bytes()
	pkcs7Bytes := extractPKCS7FromSignedPDF(signedBytes)
	if len(pkcs7Bytes) == 0 {
		slog.Warn("SignPDF: could not extract PKCS#7 from signed PDF, falling back to signed-PDF SHA-256",
			"signer", opts.Name)
		fallback := sha256.Sum256(signedBytes)
		pkcs7Bytes = fallback[:]
	} else {
		slog.Info("SignPDF: extracted PKCS#7 signature blob",
			"signer", opts.Name,
			"pkcs7Bytes", len(pkcs7Bytes))
	}

	sigInfo := &SignatureInfo{
		SignatureData:    pkcs7Bytes,
		DocumentHash:     docHashHex,
		HashAlgorithm:    "SHA256",
		CertificatePEM:   string(certPEM),
		CertificateChain: string(certPEM) + string(caCertPEM),
		Issuer:           cert.Issuer.String(),
		SerialNumber:     cert.SerialNumber.String(),
		ValidFrom:        cert.NotBefore,
		ValidTo:          cert.NotAfter,
		SigningTimestamp: time.Now(),
	}

	slog.Info("PDF signed cryptographically",
		"signer", opts.Name,
		"docHash", docHashHex[:16]+"...",
		"certSerial", cert.SerialNumber.String())

	return signedBytes, sigInfo, nil
}

// TSA represents a Time Stamp Authority configuration.
type TSA struct {
	URL string
}
