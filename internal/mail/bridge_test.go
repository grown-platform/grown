package mail

import (
	"reflect"
	"testing"
)

func TestSplitRecipients(t *testing.T) {
	tests := []struct {
		name         string
		mailDomain   string
		to, cc       []string
		wantInternal []string
		wantExtTo    []string
		wantExtCc    []string
	}{
		{
			name:         "splits on/off domain across to and cc",
			mailDomain:   "mail.example.com",
			to:           []string{"bob@mail.example.com", "ext@gmail.com"},
			cc:           []string{"carol@mail.example.com", "other@outlook.com"},
			wantInternal: []string{"bob@mail.example.com", "carol@mail.example.com"},
			wantExtTo:    []string{"ext@gmail.com"},
			wantExtCc:    []string{"other@outlook.com"},
		},
		{
			name:         "no mail domain treats everyone as external",
			mailDomain:   "",
			to:           []string{"a@mail.example.com"},
			cc:           []string{"b@gmail.com"},
			wantInternal: nil,
			wantExtTo:    []string{"a@mail.example.com"},
			wantExtCc:    []string{"b@gmail.com"},
		},
		{
			name:         "case-insensitive domain match and dedup",
			mailDomain:   "Mail.Example.com",
			to:           []string{"Bob <bob@MAIL.example.com>", "bob@mail.example.com"},
			cc:           nil,
			wantInternal: []string{"bob@mail.example.com"},
			wantExtTo:    nil,
			wantExtCc:    nil,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotInt, gotTo, gotCc := splitRecipients(tt.mailDomain, tt.to, tt.cc)
			if !reflect.DeepEqual(gotInt, tt.wantInternal) {
				t.Errorf("internal = %v, want %v", gotInt, tt.wantInternal)
			}
			if !reflect.DeepEqual(gotTo, tt.wantExtTo) {
				t.Errorf("extTo = %v, want %v", gotTo, tt.wantExtTo)
			}
			if !reflect.DeepEqual(gotCc, tt.wantExtCc) {
				t.Errorf("extCc = %v, want %v", gotCc, tt.wantExtCc)
			}
		})
	}
}

func TestMailboxAddr(t *testing.T) {
	tests := []struct {
		name       string
		mailDomain string
		email      string
		want       string
	}{
		{"empty domain back-compat", "", "alice@gmail.com", "alice@gmail.com"},
		{"empty domain passthrough verbatim", "", "Weird.Login", "Weird.Login"},
		{"gmail mapped to localpart@domain", "mail.example.com", "alice@gmail.com", "alice@mail.example.com"},
		{"already on domain passthrough", "mail.example.com", "bob@mail.example.com", "bob@mail.example.com"},
		{"already on domain case-insensitive passthrough", "mail.example.com", "Bob@Mail.Example.com", "Bob@Mail.Example.com"},
		{"no at-sign uses whole string lowercased", "mail.example.com", "Carol", "carol@mail.example.com"},
		{"mixed-case localpart lowercased", "mail.example.com", "Alice.B@Gmail.com", "alice.b@mail.example.com"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := BridgeConfig{MailDomain: tt.mailDomain}
			got := mailboxAddr(cfg, Caller{Email: tt.email})
			if got != tt.want {
				t.Errorf("mailboxAddr(domain=%q, email=%q) = %q, want %q", tt.mailDomain, tt.email, got, tt.want)
			}
		})
	}
}
