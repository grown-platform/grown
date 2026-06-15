package mail

import (
	"encoding/base64"
	"strings"
	"testing"

	"github.com/emersion/go-imap/v2"
)

func TestMailboxFor(t *testing.T) {
	tests := []struct {
		folder, want string
	}{
		{"inbox", "INBOX"},
		{"sent", "Sent"},
		{"drafts", "Drafts"},
		{"spam", "Junk"},
		{"trash", "Trash"},
		{"unknown-folder", "INBOX"},
		{"", "INBOX"},
	}
	for _, tt := range tests {
		if got := mailboxFor(tt.folder); got != tt.want {
			t.Errorf("mailboxFor(%q) = %q, want %q", tt.folder, got, tt.want)
		}
	}
}

func TestHost(t *testing.T) {
	tests := []struct {
		in, want string
	}{
		{"mail.example.com:993", "mail.example.com"},
		{"127.0.0.1:143", "127.0.0.1"},
		{"no-port", "no-port"}, // SplitHostPort errors -> returns input
	}
	for _, tt := range tests {
		if got := host(tt.in); got != tt.want {
			t.Errorf("host(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}

func TestMsgIDRoundTrip(t *testing.T) {
	id := msgID("inbox", imap.UID(42))
	if id != "inbox:42" {
		t.Fatalf("msgID = %q, want inbox:42", id)
	}
	folder, uid, ok := parseMsgID(id)
	if !ok || folder != "inbox" || uid != imap.UID(42) {
		t.Fatalf("parseMsgID(%q) = (%q, %d, %v)", id, folder, uid, ok)
	}
}

func TestParseMsgID(t *testing.T) {
	tests := []struct {
		name       string
		id         string
		wantFolder string
		wantUID    imap.UID
		wantOK     bool
	}{
		{"valid", "sent:7", "sent", 7, true},
		{"folder with no colon", "inbox", "", 0, false},
		{"non-numeric uid", "inbox:abc", "", 0, false},
		{"uses last colon", "a:b:9", "a:b", 9, true},
		{"empty", "", "", 0, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f, uid, ok := parseMsgID(tt.id)
			if f != tt.wantFolder || uid != tt.wantUID || ok != tt.wantOK {
				t.Errorf("parseMsgID(%q) = (%q,%d,%v), want (%q,%d,%v)",
					tt.id, f, uid, ok, tt.wantFolder, tt.wantUID, tt.wantOK)
			}
		})
	}
}

func TestImapLogin(t *testing.T) {
	t.Run("master user appends *master with mailbox", func(t *testing.T) {
		b := NewBridge(BridgeConfig{MailDomain: "mail.x", MasterUser: "admin", MasterPass: "secret"})
		user, pass := b.imapLogin(Caller{Email: "alice@gmail.com"})
		if user != "alice@mail.x*admin" {
			t.Errorf("user = %q, want alice@mail.x*admin", user)
		}
		if pass != "secret" {
			t.Errorf("pass = %q", pass)
		}
	})
	t.Run("no master user logs in directly as mailbox", func(t *testing.T) {
		b := NewBridge(BridgeConfig{MailDomain: "mail.x", MasterPass: "pw"})
		user, pass := b.imapLogin(Caller{Email: "bob@mail.x"})
		if user != "bob@mail.x" || pass != "pw" {
			t.Errorf("got (%q,%q)", user, pass)
		}
	})
}

func TestTLSConfigFor(t *testing.T) {
	t.Run("nil when not insecure", func(t *testing.T) {
		b := NewBridge(BridgeConfig{})
		if b.tlsConfigFor("mail.x:993") != nil {
			t.Errorf("expected nil tls config")
		}
	})
	t.Run("insecure skip verify pins server name", func(t *testing.T) {
		b := NewBridge(BridgeConfig{TLSInsecure: true})
		tc := b.tlsConfigFor("mail.x:993")
		if tc == nil {
			t.Fatalf("expected non-nil tls config")
		}
		if !tc.InsecureSkipVerify {
			t.Errorf("expected InsecureSkipVerify true")
		}
		if tc.ServerName != "mail.x" {
			t.Errorf("ServerName = %q, want mail.x", tc.ServerName)
		}
	})
}

func TestBuildRFC822(t *testing.T) {
	c := Caller{Name: "Alice"}
	raw := string(buildRFC822("alice@mail.x", c, Compose{
		To:      []string{"bob@x.com", "carol@x.com"},
		Cc:      []string{"dave@x.com"},
		Subject: "Hello",
		Body:    "line1\nline2",
	}))
	for _, want := range []string{
		"From: Alice <alice@mail.x>\r\n",
		"To: bob@x.com, carol@x.com\r\n",
		"Cc: dave@x.com\r\n",
		"Subject: Hello\r\n",
		"MIME-Version: 1.0\r\n",
		"Content-Type: text/plain; charset=utf-8\r\n",
		"line1\r\nline2", // body newlines converted to CRLF
	} {
		if !strings.Contains(raw, want) {
			t.Errorf("buildRFC822 missing %q in:\n%s", want, raw)
		}
	}
}

func TestBuildRFC822_NoNameNoCc(t *testing.T) {
	raw := string(buildRFC822("alice@mail.x", Caller{}, Compose{
		To: []string{"bob@x.com"}, Subject: "Hi", Body: "yo",
	}))
	if !strings.Contains(raw, "From: alice@mail.x\r\n") {
		t.Errorf("expected bare From, got:\n%s", raw)
	}
	if strings.Contains(raw, "Cc:") {
		t.Errorf("did not expect Cc header:\n%s", raw)
	}
}

func TestDecodeTransfer(t *testing.T) {
	t.Run("identity for plain", func(t *testing.T) {
		got := decodeTransfer("", strings.NewReader("hello world"))
		if string(got) != "hello world" {
			t.Errorf("got %q", got)
		}
	})
	t.Run("quoted-printable", func(t *testing.T) {
		got := decodeTransfer("quoted-printable", strings.NewReader("caf=C3=A9"))
		if string(got) != "café" {
			t.Errorf("got %q, want café", got)
		}
	})
	t.Run("base64 with embedded newlines", func(t *testing.T) {
		enc := base64.StdEncoding.EncodeToString([]byte("hello base64 body"))
		// inject a newline mid-stream to exercise newlineStripper
		mid := len(enc) / 2
		wrapped := enc[:mid] + "\r\n" + enc[mid:]
		got := decodeTransfer("base64", strings.NewReader(wrapped))
		if string(got) != "hello base64 body" {
			t.Errorf("got %q", got)
		}
	})
	t.Run("case-insensitive encoding name", func(t *testing.T) {
		got := decodeTransfer("  QUOTED-PRINTABLE  ", strings.NewReader("a=3Db"))
		if string(got) != "a=b" {
			t.Errorf("got %q", got)
		}
	})
}

func TestHTMLToText(t *testing.T) {
	tests := []struct {
		name, in, want string
	}{
		{"strip tags", "<p>Hello <b>world</b></p>", "Hello world"},
		{"br to newline", "a<br>b", "a\nb"},
		{"entities", "Tom &amp; Jerry &lt;3 &nbsp;x", "Tom & Jerry <3  x"},
		{"drop style block", "<style>p{color:red}</style>visible", "visible"},
		{"drop script block", "<script>alert(1)</script>safe", "safe"},
		{"collapse blank lines", "a<br><br><br><br>b", "a\n\nb"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := htmlToText(tt.in); got != tt.want {
				t.Errorf("htmlToText(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestExtractText(t *testing.T) {
	t.Run("empty", func(t *testing.T) {
		if got := extractText(nil); got != "" {
			t.Errorf("got %q", got)
		}
	})

	t.Run("simple text/plain", func(t *testing.T) {
		raw := "Subject: Hi\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nHello body"
		if got := extractText([]byte(raw)); got != "Hello body" {
			t.Errorf("got %q", got)
		}
	})

	t.Run("quoted-printable text/plain", func(t *testing.T) {
		raw := "Content-Type: text/plain\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\ncaf=C3=A9 time"
		if got := extractText([]byte(raw)); got != "café time" {
			t.Errorf("got %q", got)
		}
	})

	t.Run("html fallback when no plain", func(t *testing.T) {
		raw := "Content-Type: text/html\r\n\r\n<p>Hi <b>there</b></p>"
		if got := extractText([]byte(raw)); got != "Hi there" {
			t.Errorf("got %q", got)
		}
	})

	t.Run("multipart prefers text/plain", func(t *testing.T) {
		raw := "MIME-Version: 1.0\r\n" +
			"Content-Type: multipart/alternative; boundary=BOUND\r\n\r\n" +
			"--BOUND\r\n" +
			"Content-Type: text/html\r\n\r\n<p>HTML version</p>\r\n" +
			"--BOUND\r\n" +
			"Content-Type: text/plain\r\n\r\nPlain version\r\n" +
			"--BOUND--\r\n"
		got := extractText([]byte(raw))
		if got != "Plain version" {
			t.Errorf("got %q, want 'Plain version'", got)
		}
	})

	t.Run("unparseable headers returns body after break", func(t *testing.T) {
		// No colon in first line -> ReadMessage fails -> returns after \r\n\r\n.
		raw := "not a header line\r\n\r\nthe body here"
		got := extractText([]byte(raw))
		if got != "the body here" {
			t.Errorf("got %q", got)
		}
	})
}
