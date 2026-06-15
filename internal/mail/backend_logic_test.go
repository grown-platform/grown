package mail

import (
	"context"
	"reflect"
	"testing"

	"code.pick.haus/grown/grown/internal/email"
)

func TestDomainOf(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{"bare address", "alice@example.com", "example.com"},
		{"named address", "Alice <alice@Example.COM>", "example.com"},
		{"named with spaces trimmed", "Bob B <  bob@host.io >", "host.io"},
		{"no at-sign", "not-an-email", ""},
		{"empty", "", ""},
		{"angle without close", "Name <alice@example.com", "example.com"},
		{"uppercased domain lowercased", "a@MAIL.X", "mail.x"},
		{"multiple at uses last", "weird@name@final.com", "final.com"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := domainOf(tt.in); got != tt.want {
				t.Errorf("domainOf(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestAddrOf(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{"bare passthrough", "alice@example.com", "alice@example.com"},
		{"named extracts bracketed", "Alice <alice@example.com>", "alice@example.com"},
		{"no brackets", "plain text", "plain text"},
		{"open bracket only returns whole", "Name <alice@example.com", "Name <alice@example.com"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := addrOf(tt.in); got != tt.want {
				t.Errorf("addrOf(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestHTMLEscape(t *testing.T) {
	tests := []struct {
		in, want string
	}{
		{"plain", "plain"},
		{"a & b", "a &amp; b"},
		{"<tag>", "&lt;tag&gt;"},
		{"a < b > c & d", "a &lt; b &gt; c &amp; d"},
		{"", ""},
	}
	for _, tt := range tests {
		if got := htmlEscape(tt.in); got != tt.want {
			t.Errorf("htmlEscape(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}

func TestStringSliceEq(t *testing.T) {
	tests := []struct {
		name string
		a, b []string
		want bool
	}{
		{"both nil", nil, nil, true},
		{"equal", []string{"a", "b"}, []string{"a", "b"}, true},
		{"different length", []string{"a"}, []string{"a", "b"}, false},
		{"different content", []string{"a", "b"}, []string{"a", "c"}, false},
		{"order matters", []string{"a", "b"}, []string{"b", "a"}, false},
		{"empty vs nil", []string{}, nil, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := stringSliceEq(tt.a, tt.b); got != tt.want {
				t.Errorf("stringSliceEq(%v,%v) = %v, want %v", tt.a, tt.b, got, tt.want)
			}
		})
	}
}

func TestRuleMatches(t *testing.T) {
	msg := &Message{
		FromAddr: "alice@example.com",
		FromName: "Alice Wonder",
		ToAddrs:  []string{"bob@example.com"},
		CcAddrs:  []string{"carol@example.com"},
		Subject:  "Quarterly Report",
	}
	tests := []struct {
		name string
		rule Rule
		want bool
	}{
		{"empty rule never matches", Rule{}, false},
		{"from addr match", Rule{MatchFrom: "alice@"}, true},
		{"from name match case-insensitive", Rule{MatchFrom: "WONDER"}, true},
		{"from no match", Rule{MatchFrom: "charlie"}, false},
		{"subject match", Rule{MatchSubject: "quarterly"}, true},
		{"subject no match", Rule{MatchSubject: "annual"}, false},
		{"to match in to-addrs", Rule{MatchTo: "bob@"}, true},
		{"to match in cc-addrs", Rule{MatchTo: "carol@"}, true},
		{"to no match", Rule{MatchTo: "dave@"}, false},
		{"all criteria ANDed - all match", Rule{MatchFrom: "alice", MatchSubject: "report", MatchTo: "bob"}, true},
		{"all criteria ANDed - one fails", Rule{MatchFrom: "alice", MatchSubject: "nope"}, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ruleMatches(msg, tt.rule); got != tt.want {
				t.Errorf("ruleMatches() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestApplyRules(t *testing.T) {
	t.Run("non-matching rule does nothing", func(t *testing.T) {
		m := &Message{Subject: "hi", Folder: "inbox"}
		fwds := applyRules(m, []Rule{{MatchSubject: "nope", ActFolder: "archive"}})
		if m.Folder != "inbox" {
			t.Errorf("folder mutated: %q", m.Folder)
		}
		if len(fwds) != 0 {
			t.Errorf("forwards = %v, want none", fwds)
		}
	})

	t.Run("applies folder/label/markread/star and collects forward", func(t *testing.T) {
		m := &Message{Subject: "Invoice 42", Folder: "inbox", Labels: []string{"old"}}
		rules := []Rule{{
			MatchSubject: "invoice",
			ActFolder:    "archive",
			ActLabel:     "Finance",
			ActMarkRead:  true,
			ActStar:      true,
			ActForward:   "accounting@example.com",
		}}
		fwds := applyRules(m, rules)
		if m.Folder != "archive" {
			t.Errorf("folder = %q, want archive", m.Folder)
		}
		if !contains(m.Labels, "Finance") || !contains(m.Labels, "old") {
			t.Errorf("labels = %v, want both old and Finance", m.Labels)
		}
		if !m.IsRead {
			t.Errorf("expected IsRead")
		}
		if !m.Starred {
			t.Errorf("expected Starred")
		}
		if !reflect.DeepEqual(fwds, []string{"accounting@example.com"}) {
			t.Errorf("forwards = %v", fwds)
		}
	})

	t.Run("label not duplicated when already present", func(t *testing.T) {
		m := &Message{Subject: "x", Labels: []string{"Finance"}}
		applyRules(m, []Rule{{MatchSubject: "x", ActLabel: "Finance"}})
		count := 0
		for _, l := range m.Labels {
			if l == "Finance" {
				count++
			}
		}
		if count != 1 {
			t.Errorf("Finance label count = %d, want 1", count)
		}
	})

	t.Run("multiple matching rules collect multiple forwards", func(t *testing.T) {
		m := &Message{Subject: "report", FromAddr: "a@x.com"}
		rules := []Rule{
			{MatchSubject: "report", ActForward: "one@x.com"},
			{MatchFrom: "a@x.com", ActForward: "two@x.com"},
		}
		fwds := applyRules(m, rules)
		if !reflect.DeepEqual(fwds, []string{"one@x.com", "two@x.com"}) {
			t.Errorf("forwards = %v", fwds)
		}
	})
}

// TestSendExternal_NoopWhenUnconfigured verifies sendExternal short-circuits
// (returning nil, no network) when no external sender is configured.
func TestSendExternal_NoopWhenUnconfigured(t *testing.T) {
	b := &LocalBackend{} // ext == nil
	err := b.sendExternal(context.Background(), Caller{Email: "a@x.com"},
		Compose{To: []string{"ext@gmail.com"}}, []string{"ext@gmail.com"})
	if err != nil {
		t.Errorf("nil sender should no-op, got %v", err)
	}

	// An unconfigured (empty key) sender also no-ops.
	b.ext = email.NewSender("", "noreply@pick.haus", nil)
	err = b.sendExternal(context.Background(), Caller{Email: "a@x.com"},
		Compose{To: []string{"ext@gmail.com"}}, []string{"ext@gmail.com"})
	if err != nil {
		t.Errorf("unconfigured sender should no-op, got %v", err)
	}
}
