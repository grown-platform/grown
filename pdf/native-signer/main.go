// Pdf Native Signing Helper
// Chrome Native Messaging host for signing document hashes with CAC/PIV cards via PKCS#11
package main

import (
	"bufio"
	"crypto"
	"crypto/x509"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/miekg/pkcs11"
)

// Default PKCS#11 module paths
var defaultModulePaths = []string{
	// YubiKey
	"/usr/lib/x86_64-linux-gnu/libykcs11.so",
	"/usr/local/lib/libykcs11.so",
	// OpenSC (CAC/PIV)
	"/usr/lib/x86_64-linux-gnu/opensc-pkcs11.so",
	"/usr/local/lib/opensc-pkcs11.so",
	// macOS
	"/usr/local/lib/libykcs11.dylib",
	"/Library/OpenSC/lib/opensc-pkcs11.so",
}

// Message types for Chrome Native Messaging
type Request struct {
	RequestID     int    `json:"requestId"`
	Action        string `json:"action"`
	CertificateID string `json:"certificateId,omitempty"`
	Hash          string `json:"hash,omitempty"`
	HashAlgorithm string `json:"hashAlgorithm,omitempty"`
	PIN           string `json:"pin,omitempty"`
}

type Response struct {
	RequestID    int               `json:"requestId"`
	Error        string            `json:"error,omitempty"`
	Certificates []CertificateInfo `json:"certificates,omitempty"`
	Signature    string            `json:"signature,omitempty"`
	Certificate  string            `json:"certificate,omitempty"`
	Chain        []string          `json:"chain,omitempty"`
}

type CertificateInfo struct {
	ID        string `json:"id"`
	Subject   string `json:"subject"`
	Issuer    string `json:"issuer"`
	Email     string `json:"email,omitempty"`
	NotBefore string `json:"notBefore"`
	NotAfter  string `json:"notAfter"`
	KeyType   string `json:"keyType"`
}

var (
	p11Module *pkcs11.Ctx
	session   pkcs11.SessionHandle
)

func main() {
	// Native messaging uses stdin/stdout with length-prefixed messages
	reader := bufio.NewReader(os.Stdin)

	for {
		// Read message length (4 bytes, native byte order)
		var msgLen uint32
		if err := binary.Read(reader, binary.LittleEndian, &msgLen); err != nil {
			if err == io.EOF {
				break
			}
			continue
		}

		// Sanity check message length
		if msgLen > 1024*1024 {
			sendResponse(Response{Error: "message too large"})
			continue
		}

		// Read message body
		msgBytes := make([]byte, msgLen)
		if _, err := io.ReadFull(reader, msgBytes); err != nil {
			sendResponse(Response{Error: fmt.Sprintf("read error: %v", err)})
			continue
		}

		// Parse request
		var req Request
		if err := json.Unmarshal(msgBytes, &req); err != nil {
			sendResponse(Response{Error: fmt.Sprintf("invalid JSON: %v", err)})
			continue
		}

		// Handle request
		resp := handleRequest(req)
		resp.RequestID = req.RequestID
		sendResponse(resp)
	}
}

func sendResponse(resp Response) {
	data, err := json.Marshal(resp)
	if err != nil {
		return
	}

	// Write length prefix
	binary.Write(os.Stdout, binary.LittleEndian, uint32(len(data)))
	// Write message
	os.Stdout.Write(data)
}

func handleRequest(req Request) Response {
	switch req.Action {
	case "listCertificates":
		return listCertificates()
	case "signHash":
		return signHash(req.CertificateID, req.Hash, req.HashAlgorithm, req.PIN)
	case "getCertificate":
		return getCertificate(req.CertificateID)
	default:
		return Response{Error: fmt.Sprintf("unknown action: %s", req.Action)}
	}
}

func initPKCS11() error {
	if p11Module != nil {
		return nil
	}

	// Try environment variable first
	modulePath := os.Getenv("PKCS11_MODULE_PATH")
	if modulePath == "" {
		// Try default paths
		for _, path := range defaultModulePaths {
			if _, err := os.Stat(path); err == nil {
				modulePath = path
				break
			}
		}
	}

	if modulePath == "" {
		return fmt.Errorf("no PKCS#11 module found")
	}

	p11Module = pkcs11.New(modulePath)
	if p11Module == nil {
		return fmt.Errorf("failed to load PKCS#11 module: %s", modulePath)
	}

	if err := p11Module.Initialize(); err != nil {
		p11Module.Destroy()
		p11Module = nil
		return fmt.Errorf("PKCS#11 initialize failed: %v", err)
	}

	return nil
}

func getSession() (pkcs11.SessionHandle, error) {
	if session != 0 {
		return session, nil
	}

	if err := initPKCS11(); err != nil {
		return 0, err
	}

	// Get first slot with a token
	slots, err := p11Module.GetSlotList(true)
	if err != nil {
		return 0, fmt.Errorf("get slots failed: %v", err)
	}

	if len(slots) == 0 {
		return 0, fmt.Errorf("no tokens found (is your smart card inserted?)")
	}

	// Open session on first slot
	sess, err := p11Module.OpenSession(slots[0], pkcs11.CKF_SERIAL_SESSION)
	if err != nil {
		return 0, fmt.Errorf("open session failed: %v", err)
	}

	session = sess
	return session, nil
}

func listCertificates() Response {
	sess, err := getSession()
	if err != nil {
		return Response{Error: err.Error()}
	}

	// Find all certificates
	template := []*pkcs11.Attribute{
		pkcs11.NewAttribute(pkcs11.CKA_CLASS, pkcs11.CKO_CERTIFICATE),
		pkcs11.NewAttribute(pkcs11.CKA_CERTIFICATE_TYPE, pkcs11.CKC_X_509),
	}

	if err := p11Module.FindObjectsInit(sess, template); err != nil {
		return Response{Error: fmt.Sprintf("find init failed: %v", err)}
	}
	defer p11Module.FindObjectsFinal(sess)

	var certs []CertificateInfo

	for {
		handles, _, err := p11Module.FindObjects(sess, 10)
		if err != nil {
			break
		}
		if len(handles) == 0 {
			break
		}

		for _, h := range handles {
			certInfo, err := extractCertificateInfo(sess, h)
			if err != nil {
				continue
			}
			certs = append(certs, certInfo)
		}
	}

	return Response{Certificates: certs}
}

func extractCertificateInfo(sess pkcs11.SessionHandle, handle pkcs11.ObjectHandle) (CertificateInfo, error) {
	// Get certificate value
	attrs, err := p11Module.GetAttributeValue(sess, handle, []*pkcs11.Attribute{
		pkcs11.NewAttribute(pkcs11.CKA_VALUE, nil),
		pkcs11.NewAttribute(pkcs11.CKA_ID, nil),
		pkcs11.NewAttribute(pkcs11.CKA_LABEL, nil),
	})
	if err != nil {
		return CertificateInfo{}, err
	}

	var certDER []byte
	var certID []byte
	var label string

	for _, a := range attrs {
		switch a.Type {
		case pkcs11.CKA_VALUE:
			certDER = a.Value
		case pkcs11.CKA_ID:
			certID = a.Value
		case pkcs11.CKA_LABEL:
			label = string(a.Value)
		}
	}

	if len(certDER) == 0 {
		return CertificateInfo{}, fmt.Errorf("no certificate value")
	}

	cert, err := x509.ParseCertificate(certDER)
	if err != nil {
		return CertificateInfo{}, err
	}

	// Extract email from certificate
	email := ""
	for _, name := range cert.Subject.Names {
		if name.Type.String() == "1.2.840.113549.1.9.1" { // emailAddress OID
			email = fmt.Sprintf("%v", name.Value)
			break
		}
	}
	if email == "" && len(cert.EmailAddresses) > 0 {
		email = cert.EmailAddresses[0]
	}

	// Use label + hex ID as unique identifier
	id := label
	if len(certID) > 0 {
		id = fmt.Sprintf("%s:%x", label, certID)
	}

	return CertificateInfo{
		ID:        id,
		Subject:   cert.Subject.String(),
		Issuer:    cert.Issuer.String(),
		Email:     email,
		NotBefore: cert.NotBefore.Format(time.RFC3339),
		NotAfter:  cert.NotAfter.Format(time.RFC3339),
		KeyType:   keyTypeString(cert.PublicKeyAlgorithm),
	}, nil
}

func keyTypeString(algo x509.PublicKeyAlgorithm) string {
	switch algo {
	case x509.RSA:
		return "RSA"
	case x509.ECDSA:
		return "ECDSA"
	case x509.Ed25519:
		return "Ed25519"
	default:
		return "Unknown"
	}
}

func signHash(certID, hashB64, hashAlgo, pin string) Response {
	if certID == "" {
		return Response{Error: "certificateId is required"}
	}
	if hashB64 == "" {
		return Response{Error: "hash is required"}
	}

	hashBytes, err := base64.StdEncoding.DecodeString(hashB64)
	if err != nil {
		return Response{Error: fmt.Sprintf("invalid hash base64: %v", err)}
	}

	sess, err := getSession()
	if err != nil {
		return Response{Error: err.Error()}
	}

	// Parse certificate ID to find matching private key
	label := certID
	var keyID []byte
	if idx := strings.LastIndex(certID, ":"); idx != -1 {
		label = certID[:idx]
		keyIDHex := certID[idx+1:]
		keyID, _ = parseHex(keyIDHex)
	}

	// Find private key with matching ID/label
	template := []*pkcs11.Attribute{
		pkcs11.NewAttribute(pkcs11.CKA_CLASS, pkcs11.CKO_PRIVATE_KEY),
	}
	if len(keyID) > 0 {
		template = append(template, pkcs11.NewAttribute(pkcs11.CKA_ID, keyID))
	}
	if label != "" && len(keyID) == 0 {
		template = append(template, pkcs11.NewAttribute(pkcs11.CKA_LABEL, label))
	}

	if err := p11Module.FindObjectsInit(sess, template); err != nil {
		return Response{Error: fmt.Sprintf("find key init failed: %v", err)}
	}

	handles, _, err := p11Module.FindObjects(sess, 1)
	p11Module.FindObjectsFinal(sess)

	if err != nil || len(handles) == 0 {
		return Response{Error: "private key not found for certificate"}
	}

	keyHandle := handles[0]

	// Login if PIN provided (or use cached login)
	if pin != "" {
		if err := p11Module.Login(sess, pkcs11.CKU_USER, pin); err != nil {
			// Ignore already logged in error
			if !strings.Contains(err.Error(), "CKR_USER_ALREADY_LOGGED_IN") {
				return Response{Error: fmt.Sprintf("login failed: %v", err)}
			}
		}
	}

	// Determine mechanism based on hash algorithm and key type
	mechanism := getMechanism(hashAlgo)

	// Sign
	if err := p11Module.SignInit(sess, []*pkcs11.Mechanism{mechanism}, keyHandle); err != nil {
		return Response{Error: fmt.Sprintf("sign init failed: %v", err)}
	}

	signature, err := p11Module.Sign(sess, hashBytes)
	if err != nil {
		return Response{Error: fmt.Sprintf("sign failed: %v", err)}
	}

	return Response{
		Signature: base64.StdEncoding.EncodeToString(signature),
	}
}

func getMechanism(hashAlgo string) *pkcs11.Mechanism {
	// Use RSA PKCS#1 v1.5 signature mechanisms
	switch strings.ToUpper(hashAlgo) {
	case "SHA384":
		return pkcs11.NewMechanism(pkcs11.CKM_SHA384_RSA_PKCS, nil)
	case "SHA512":
		return pkcs11.NewMechanism(pkcs11.CKM_SHA512_RSA_PKCS, nil)
	default: // SHA256
		return pkcs11.NewMechanism(pkcs11.CKM_SHA256_RSA_PKCS, nil)
	}
}

func getCertificate(certID string) Response {
	if certID == "" {
		return Response{Error: "certificateId is required"}
	}

	sess, err := getSession()
	if err != nil {
		return Response{Error: err.Error()}
	}

	// Parse certificate ID
	label := certID
	var certKeyID []byte
	if idx := strings.LastIndex(certID, ":"); idx != -1 {
		label = certID[:idx]
		certKeyID, _ = parseHex(certID[idx+1:])
	}

	// Find certificate with matching ID/label
	template := []*pkcs11.Attribute{
		pkcs11.NewAttribute(pkcs11.CKA_CLASS, pkcs11.CKO_CERTIFICATE),
	}
	if len(certKeyID) > 0 {
		template = append(template, pkcs11.NewAttribute(pkcs11.CKA_ID, certKeyID))
	}
	if label != "" && len(certKeyID) == 0 {
		template = append(template, pkcs11.NewAttribute(pkcs11.CKA_LABEL, label))
	}

	if err := p11Module.FindObjectsInit(sess, template); err != nil {
		return Response{Error: fmt.Sprintf("find cert init failed: %v", err)}
	}

	handles, _, err := p11Module.FindObjects(sess, 1)
	p11Module.FindObjectsFinal(sess)

	if err != nil || len(handles) == 0 {
		return Response{Error: "certificate not found"}
	}

	// Get certificate value
	attrs, err := p11Module.GetAttributeValue(sess, handles[0], []*pkcs11.Attribute{
		pkcs11.NewAttribute(pkcs11.CKA_VALUE, nil),
	})
	if err != nil {
		return Response{Error: fmt.Sprintf("get cert value failed: %v", err)}
	}

	var certDER []byte
	for _, a := range attrs {
		if a.Type == pkcs11.CKA_VALUE {
			certDER = a.Value
			break
		}
	}

	if len(certDER) == 0 {
		return Response{Error: "certificate value empty"}
	}

	// Convert to PEM
	certPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "CERTIFICATE",
		Bytes: certDER,
	})

	// Try to build certificate chain (find issuer certs)
	chain := buildCertificateChain(sess, certDER)

	return Response{
		Certificate: base64.StdEncoding.EncodeToString(certPEM),
		Chain:       chain,
	}
}

func buildCertificateChain(sess pkcs11.SessionHandle, leafDER []byte) []string {
	var chain []string

	leaf, err := x509.ParseCertificate(leafDER)
	if err != nil {
		return chain
	}

	// Find all certificates in token
	template := []*pkcs11.Attribute{
		pkcs11.NewAttribute(pkcs11.CKA_CLASS, pkcs11.CKO_CERTIFICATE),
		pkcs11.NewAttribute(pkcs11.CKA_CERTIFICATE_TYPE, pkcs11.CKC_X_509),
	}

	if err := p11Module.FindObjectsInit(sess, template); err != nil {
		return chain
	}
	defer p11Module.FindObjectsFinal(sess)

	var allCerts []*x509.Certificate
	for {
		handles, _, err := p11Module.FindObjects(sess, 10)
		if err != nil || len(handles) == 0 {
			break
		}

		for _, h := range handles {
			attrs, err := p11Module.GetAttributeValue(sess, h, []*pkcs11.Attribute{
				pkcs11.NewAttribute(pkcs11.CKA_VALUE, nil),
			})
			if err != nil {
				continue
			}

			for _, a := range attrs {
				if a.Type == pkcs11.CKA_VALUE && len(a.Value) > 0 {
					cert, err := x509.ParseCertificate(a.Value)
					if err == nil {
						allCerts = append(allCerts, cert)
					}
				}
			}
		}
	}

	// Build chain by finding issuers
	current := leaf
	seen := make(map[string]bool)
	seen[current.Subject.String()] = true

	for i := 0; i < 10; i++ { // Max depth
		if current.Subject.String() == current.Issuer.String() {
			break // Self-signed (root)
		}

		found := false
		for _, cert := range allCerts {
			if cert.Subject.String() == current.Issuer.String() && !seen[cert.Subject.String()] {
				seen[cert.Subject.String()] = true
				certPEM := pem.EncodeToMemory(&pem.Block{
					Type:  "CERTIFICATE",
					Bytes: cert.Raw,
				})
				chain = append(chain, base64.StdEncoding.EncodeToString(certPEM))
				current = cert
				found = true
				break
			}
		}

		if !found {
			break
		}
	}

	return chain
}

func parseHex(s string) ([]byte, error) {
	var result []byte
	for i := 0; i < len(s); i += 2 {
		if i+2 > len(s) {
			break
		}
		var b byte
		fmt.Sscanf(s[i:i+2], "%02x", &b)
		result = append(result, b)
	}
	return result, nil
}

// hashAlgorithmFromName returns the crypto.Hash for a given name
func hashAlgorithmFromName(name string) crypto.Hash {
	switch strings.ToUpper(name) {
	case "SHA384":
		return crypto.SHA384
	case "SHA512":
		return crypto.SHA512
	default:
		return crypto.SHA256
	}
}
