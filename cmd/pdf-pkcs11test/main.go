// Command pkcs11test tests PKCS#11 signing with a YubiKey.
//
// Usage:
//
//	go run ./cmd/pkcs11test -pin 123456
package main

import (
	"crypto"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"flag"
	"fmt"
	"log"
	"os"

	tibcrypto "code.pick.haus/grown/grown/internal/pdf/crypto"
)

func main() {
	pin := flag.String("pin", "123456", "YubiKey PIV PIN")
	modulePath := flag.String("module", "", "Path to libykcs11.so (auto-detected if not specified)")
	flag.Parse()

	// Find PKCS#11 module
	module := *modulePath
	if module == "" {
		var err error
		module, err = tibcrypto.FindYubiKeyModulePath()
		if err != nil {
			log.Fatalf("Failed to find PKCS#11 module: %v", err)
		}
	}
	fmt.Printf("Using PKCS#11 module: %s\n", module)

	// Initialize PKCS#11 CA
	ca, err := tibcrypto.NewPKCS11CA(tibcrypto.PKCS11Config{
		ModulePath: module,
		PIN:        *pin,
	})
	if err != nil {
		log.Fatalf("Failed to initialize PKCS#11 CA: %v", err)
	}
	defer ca.Close()

	// Get certificate and signer
	cert, key, err := ca.GetOrCreateSignerCertificate(nil, "test-org", "test@example.com", "Test User")
	if err != nil {
		log.Fatalf("Failed to get signer: %v", err)
	}

	fmt.Printf("\nCertificate Info:\n")
	fmt.Printf("  Subject:    %s\n", cert.Subject.CommonName)
	fmt.Printf("  Issuer:     %s\n", cert.Issuer.CommonName)
	fmt.Printf("  Serial:     %s\n", cert.SerialNumber.String())
	fmt.Printf("  Valid From: %s\n", cert.NotBefore)
	fmt.Printf("  Valid To:   %s\n", cert.NotAfter)

	// Get signer interface
	signer, ok := key.(crypto.Signer)
	if !ok {
		log.Fatal("Key does not implement crypto.Signer")
	}

	// Test with a PDF if one is provided (do this first to avoid session timeout)
	if flag.NArg() > 0 {
		pdfPath := flag.Arg(0)
		fmt.Printf("\nSigning PDF: %s\n", pdfPath)

		pdfBytes, err := os.ReadFile(pdfPath)
		if err != nil {
			log.Fatalf("Failed to read PDF: %v", err)
		}

		pdfSigner := tibcrypto.NewPDFSigner(ca)
		signedPDF, sigInfo, err := pdfSigner.SignPDF(pdfBytes, cert, signer, tibcrypto.SignOptions{
			Name:     cert.Subject.CommonName,
			Location: "PKCS#11 Test",
			Reason:   "Testing YubiKey signing",
		})
		if err != nil {
			log.Fatalf("Failed to sign PDF: %v", err)
		}

		outPath := pdfPath[:len(pdfPath)-4] + "-signed.pdf"
		if err := os.WriteFile(outPath, signedPDF, 0644); err != nil {
			log.Fatalf("Failed to write signed PDF: %v", err)
		}

		fmt.Printf("  Output:     %s\n", outPath)
		fmt.Printf("  Doc Hash:   %s\n", sigInfo.DocumentHash[:32]+"...")
		fmt.Printf("  Signed At:  %s\n", sigInfo.SigningTimestamp)
		fmt.Printf("\n✓ PDF signed successfully!\n")
	} else {
		// Basic signing test if no PDF provided
		testData := []byte("Hello, YubiKey signing test!")
		hash := sha256.Sum256(testData)

		fmt.Printf("\nTest Signing:\n")
		fmt.Printf("  Data:       %q\n", testData)
		fmt.Printf("  Hash:       %s\n", hex.EncodeToString(hash[:]))

		sig, err := signer.Sign(rand.Reader, hash[:], crypto.SHA256)
		if err != nil {
			log.Fatalf("Failed to sign: %v", err)
		}

		fmt.Printf("  Signature:  %s... (%d bytes)\n", hex.EncodeToString(sig[:16]), len(sig))
		fmt.Printf("\n✓ PKCS#11 signing successful!\n")
	}
}
