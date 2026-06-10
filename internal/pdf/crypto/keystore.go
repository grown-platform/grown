package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
)

// Keystore handles encryption and decryption of private keys using AES-256-GCM.
// The Key Encryption Key (KEK) should be stored securely (e.g., environment variable,
// KMS, or HashiCorp Vault in production).
type Keystore struct {
	kek []byte // 32 bytes for AES-256
}

// NewKeystore creates a new Keystore with the given base64-encoded KEK.
// The KEK must be 32 bytes (256 bits) when decoded.
func NewKeystore(kekBase64 string) (*Keystore, error) {
	if kekBase64 == "" {
		// Generate a random KEK for development if not provided
		kek := make([]byte, 32)
		if _, err := rand.Read(kek); err != nil {
			return nil, fmt.Errorf("failed to generate random KEK: %w", err)
		}
		return &Keystore{kek: kek}, nil
	}

	kek, err := base64.StdEncoding.DecodeString(kekBase64)
	if err != nil {
		return nil, fmt.Errorf("failed to decode KEK: %w", err)
	}

	if len(kek) != 32 {
		return nil, fmt.Errorf("KEK must be 32 bytes, got %d", len(kek))
	}

	return &Keystore{kek: kek}, nil
}

// EncryptPrivateKey encrypts the given private key bytes using AES-256-GCM.
// Returns the encrypted data with the nonce prepended.
func (k *Keystore) EncryptPrivateKey(privateKey []byte) ([]byte, error) {
	block, err := aes.NewCipher(k.kek)
	if err != nil {
		return nil, fmt.Errorf("failed to create cipher: %w", err)
	}

	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("failed to create GCM: %w", err)
	}

	// Create a nonce (12 bytes for GCM)
	nonce := make([]byte, aesGCM.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, fmt.Errorf("failed to generate nonce: %w", err)
	}

	// Encrypt and prepend nonce
	ciphertext := aesGCM.Seal(nonce, nonce, privateKey, nil)
	return ciphertext, nil
}

// DecryptPrivateKey decrypts private key bytes that were encrypted with EncryptPrivateKey.
// Expects the nonce to be prepended to the ciphertext.
func (k *Keystore) DecryptPrivateKey(encryptedKey []byte) ([]byte, error) {
	block, err := aes.NewCipher(k.kek)
	if err != nil {
		return nil, fmt.Errorf("failed to create cipher: %w", err)
	}

	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("failed to create GCM: %w", err)
	}

	nonceSize := aesGCM.NonceSize()
	if len(encryptedKey) < nonceSize {
		return nil, errors.New("ciphertext too short")
	}

	nonce, ciphertext := encryptedKey[:nonceSize], encryptedKey[nonceSize:]
	plaintext, err := aesGCM.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to decrypt: %w", err)
	}

	return plaintext, nil
}

// GenerateKEK generates a new random KEK and returns it as a base64 string.
// Useful for initial setup.
func GenerateKEK() (string, error) {
	kek := make([]byte, 32)
	if _, err := rand.Read(kek); err != nil {
		return "", fmt.Errorf("failed to generate KEK: %w", err)
	}
	return base64.StdEncoding.EncodeToString(kek), nil
}
