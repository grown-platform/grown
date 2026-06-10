//go:build pkcs11

// Command mtlstest tests mTLS client certificate authentication with a YubiKey.
//
// Usage:
//
//	go run ./cmd/mtlstest -pin 123456 -url https://localhost:8085/api/documents
package main

import (
	"crypto/tls"
	"crypto/x509"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"

	tibcrypto "code.pick.haus/grown/grown/internal/pdf/crypto"
)

func main() {
	pin := flag.String("pin", "123456", "YubiKey PIV PIN")
	modulePath := flag.String("module", "", "Path to libykcs11.so (auto-detected if not specified)")
	serverCA := flag.String("ca", "./certs/server-ca.pem", "Path to server CA certificate")
	url := flag.String("url", "https://localhost:8443/api/documents", "URL to test (default: nginx proxy)")
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

	fmt.Printf("\nClient Certificate:\n")
	fmt.Printf("  Subject:    %s\n", cert.Subject)
	fmt.Printf("  Issuer:     %s\n", cert.Issuer)
	fmt.Printf("  Serial:     %s\n", cert.SerialNumber)

	// Load server CA certificate
	serverCAPool := x509.NewCertPool()
	if *serverCA != "" {
		caCert, err := os.ReadFile(*serverCA)
		if err != nil {
			log.Fatalf("Failed to read server CA: %v", err)
		}
		if !serverCAPool.AppendCertsFromPEM(caCert) {
			log.Fatal("Failed to parse server CA certificate")
		}
	}

	// Create TLS config with client certificate from YubiKey
	// The key from PKCS#11 is a crypto.Signer that signs via hardware
	tlsCert := tls.Certificate{
		Certificate: [][]byte{cert.Raw},
		PrivateKey:  key,
		Leaf:        cert,
	}

	tlsConfig := &tls.Config{
		Certificates: []tls.Certificate{tlsCert},
		RootCAs:      serverCAPool,
		MinVersion:   tls.VersionTLS12,
	}

	// Create HTTP client with mTLS
	client := &http.Client{
		Transport: &http.Transport{
			TLSClientConfig: tlsConfig,
		},
	}

	fmt.Printf("\nConnecting to: %s\n", *url)

	// Make request
	resp, err := client.Get(*url)
	if err != nil {
		log.Fatalf("Request failed: %v", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)

	fmt.Printf("\nResponse:\n")
	fmt.Printf("  Status: %s\n", resp.Status)
	fmt.Printf("  Body:   %s\n", truncate(string(body), 200))

	if resp.StatusCode == http.StatusOK {
		fmt.Printf("\n✓ mTLS authentication successful!\n")
	} else {
		fmt.Printf("\n✗ Request returned non-200 status\n")
	}
}

func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}