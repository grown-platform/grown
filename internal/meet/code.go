package meet

import (
	"crypto/rand"
	"math/big"
	"regexp"
	"strings"
)

// codeAlphabet is the set of unambiguous lowercase letters used in codes.
// Omits: l (looks like 1), o (looks like 0), i (looks like 1).
const codeAlphabet = "abcdefghjkmnpqrstuvwxyz"

var codeRe = regexp.MustCompile(`^[a-z]{3}-[a-z]{4}-[a-z]{3}$`)

// GenerateCode returns a random Google-Meet-style code: "xxx-xxxx-xxx".
// Each character is drawn from codeAlphabet (no ambiguous chars).
func GenerateCode() (string, error) {
	n := big.NewInt(int64(len(codeAlphabet)))
	pick := func(count int) (string, error) {
		var b strings.Builder
		for range count {
			idx, err := rand.Int(rand.Reader, n)
			if err != nil {
				return "", err
			}
			b.WriteByte(codeAlphabet[idx.Int64()])
		}
		return b.String(), nil
	}
	a, err := pick(3)
	if err != nil {
		return "", err
	}
	b, err := pick(4)
	if err != nil {
		return "", err
	}
	c, err := pick(3)
	if err != nil {
		return "", err
	}
	return a + "-" + b + "-" + c, nil
}

// ValidCode reports whether s is a syntactically valid meeting code.
func ValidCode(s string) bool { return codeRe.MatchString(s) }
