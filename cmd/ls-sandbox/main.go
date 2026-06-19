// Command ls-sandbox is a deliberately worthless SSH target for the grown
// Guacamole gateway (Phase 1). A session can only run `ls`, which reports from a
// fake in-memory tree (see eval.go). There is no real shell, no process exec, no
// filesystem access, and no network egress (enforced by the deployment's
// NetworkPolicy + read-only/unprivileged container). It exists purely to prove
// the gateway → target pipeline end-to-end with zero blast radius.
package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/binary"
	"io"
	"log"
	"net"
	"os"

	"golang.org/x/crypto/ssh"
)

func main() {
	addr := ":2222" // non-root friendly; the deployment runs unprivileged
	if a := os.Getenv("GROWN_LS_SANDBOX_ADDR"); a != "" {
		addr = a
	}

	// Auth is intentionally permissive: the GATEWAY (Guacamole + Zitadel SSO) is
	// the trust boundary. This target does nothing sensitive, so any username /
	// password (or none) is accepted.
	config := &ssh.ServerConfig{
		PasswordCallback: func(ssh.ConnMetadata, []byte) (*ssh.Permissions, error) {
			return nil, nil
		},
		KeyboardInteractiveCallback: func(ssh.ConnMetadata, ssh.KeyboardInteractiveChallenge) (*ssh.Permissions, error) {
			return nil, nil
		},
	}
	config.AddHostKey(mustHostKey())

	ln, err := net.Listen("tcp", addr)
	if err != nil {
		log.Fatalf("ls-sandbox: listen %s: %v", addr, err)
	}
	log.Printf("ls-sandbox: listening on %s", addr)
	for {
		conn, err := ln.Accept()
		if err != nil {
			continue
		}
		go handleConn(conn, config)
	}
}

// mustHostKey generates a fresh ephemeral ed25519 host key at startup. A
// throwaway target needs no persistent identity.
func mustHostKey() ssh.Signer {
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		log.Fatalf("ls-sandbox: host key: %v", err)
	}
	s, err := ssh.NewSignerFromSigner(priv)
	if err != nil {
		log.Fatalf("ls-sandbox: signer: %v", err)
	}
	return s
}

func handleConn(nConn net.Conn, config *ssh.ServerConfig) {
	defer nConn.Close()
	conn, chans, reqs, err := ssh.NewServerConn(nConn, config)
	if err != nil {
		return
	}
	defer conn.Close()
	go ssh.DiscardRequests(reqs)
	for nc := range chans {
		if nc.ChannelType() != "session" {
			_ = nc.Reject(ssh.UnknownChannelType, "only session channels")
			continue
		}
		ch, requests, err := nc.Accept()
		if err != nil {
			continue
		}
		go handleSession(ch, requests)
	}
}

func handleSession(ch ssh.Channel, requests <-chan *ssh.Request) {
	for req := range requests {
		switch req.Type {
		case "pty-req", "env", "window-change", "signal":
			_ = req.Reply(true, nil) // acknowledge; we run our own line loop
		case "shell":
			_ = req.Reply(true, nil)
			runInteractive(ch)
			_ = ch.Close()
			return
		case "exec":
			_ = req.Reply(true, nil)
			out, _ := evalCommand(parseExecPayload(req.Payload))
			if out != "" {
				_, _ = io.WriteString(ch, out)
			}
			_ = ch.Close()
			return
		default:
			_ = req.Reply(false, nil)
		}
	}
}

// parseExecPayload extracts the command string from an SSH "exec" request
// payload (uint32 length prefix + bytes). Returns "" on a malformed payload.
func parseExecPayload(p []byte) string {
	if len(p) < 4 {
		return ""
	}
	n := binary.BigEndian.Uint32(p[:4])
	if int(n) > len(p)-4 {
		return ""
	}
	return string(p[4 : 4+n])
}

// runInteractive is a minimal line editor over the raw SSH channel: it echoes
// printable input, handles CR / backspace / Ctrl-C / Ctrl-D, and on each line
// runs evalCommand. It never spawns a PTY-backed shell.
func runInteractive(ch ssh.Channel) {
	const prompt = "ls-sandbox$ "
	_, _ = io.WriteString(ch, "grown ls-only sandbox — the only command is `ls`.\r\n"+prompt)
	var line []byte
	buf := make([]byte, 1)
	for {
		n, err := ch.Read(buf)
		if err != nil {
			return
		}
		if n == 0 {
			continue
		}
		switch b := buf[0]; b {
		case '\r', '\n':
			_, _ = io.WriteString(ch, "\r\n")
			out, done := evalCommand(string(line))
			line = line[:0]
			if out != "" {
				_, _ = io.WriteString(ch, out)
			}
			if done {
				return
			}
			_, _ = io.WriteString(ch, prompt)
		case 0x7f, 0x08: // DEL / Backspace
			if len(line) > 0 {
				line = line[:len(line)-1]
				_, _ = io.WriteString(ch, "\b \b")
			}
		case 0x03: // Ctrl-C
			line = line[:0]
			_, _ = io.WriteString(ch, "^C\r\n"+prompt)
		case 0x04: // Ctrl-D on an empty line closes
			if len(line) == 0 {
				_, _ = io.WriteString(ch, "\r\n")
				return
			}
		default:
			if b >= 0x20 && b < 0x7f { // printable ASCII only
				line = append(line, b)
				_, _ = ch.Write([]byte{b}) // echo
			}
		}
	}
}
