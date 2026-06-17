package projects

import (
	"regexp"
	"strconv"
	"strings"
)

// Ref is a parsed reference to an issue found in git text (branch, PR title/body,
// commit message). Key is upper-cased; Magic is true when preceded by a closing
// keyword (close/fix/resolve and inflections).
type Ref struct {
	Key    string
	Number int32
	Magic  bool
}

// refPattern matches an optional magic keyword followed by a KEY-N identifier.
// Case-insensitive: branch names use a lowercase form (eng-42). The key segment
// is [A-Za-z][A-Za-z0-9]+ and is upper-cased by ParseRefs before use.
var refPattern = regexp.MustCompile(`(?i)\b(?:(close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+)?([a-z][a-z0-9]+)-([0-9]+)\b`)

// ParseRefs extracts every issue reference from s. Duplicates (same Key+Number)
// are merged; if any occurrence is magic the merged ref is magic. Order follows
// first appearance.
func ParseRefs(s string) []Ref {
	matches := refPattern.FindAllStringSubmatch(s, -1)
	if len(matches) == 0 {
		return nil
	}
	order := make([]Ref, 0, len(matches))
	idx := map[string]int{}
	for _, m := range matches {
		num, err := strconv.Atoi(m[3])
		if err != nil {
			continue
		}
		key := strings.ToUpper(m[2])
		magic := m[1] != ""
		k := key + "-" + m[3]
		if i, ok := idx[k]; ok {
			if magic {
				order[i].Magic = true
			}
			continue
		}
		idx[k] = len(order)
		order = append(order, Ref{Key: key, Number: int32(num), Magic: magic})
	}
	return order
}
