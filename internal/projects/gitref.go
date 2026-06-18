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
//
// Known limitation: the pattern matches any "word-number" token, so strings like
// "UTF-8" or "v2-3" parse as candidate refs. This is harmless unless an org has a
// team whose key collides (e.g. a team keyed "UTF" with an issue #8): a webhook
// only links / advances a ref when it resolves to a live issue in that org (see
// Service.linkRef → Repository.FindIssueByKeyNumber). Org-wide identifier matching
// has this inherent ambiguity; resolution to a real issue gates any side effect.
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
