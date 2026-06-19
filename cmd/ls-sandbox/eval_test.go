package main

import "testing"

func TestEvalCommand(t *testing.T) {
	const root = "README.txt  docs/  welcome/\r\n"
	cases := []struct {
		in   string
		out  string
		done bool
	}{
		{"ls", root, false},
		{"   ls   ", root, false},
		{"ls -la", root, false},          // flags ignored, never executed
		{"ls docs", "intro.md  safety.md\r\n", false},
		{"ls welcome/", "hello.txt\r\n", false},
		{"ls nope", "ls: cannot access 'nope': No such file or directory\r\n", false},
		{"ls docs welcome", "permitted: ls only\r\n", false}, // >1 operand refused
		{"pwd", "permitted: ls only\r\n", false},
		{"cat /etc/passwd", "permitted: ls only\r\n", false},
		{"sh", "permitted: ls only\r\n", false},
		{"/bin/ls", "permitted: ls only\r\n", false}, // only the bare word `ls`
		{"", "", false},
		{"exit", "bye\r\n", true},
		{"logout", "bye\r\n", true},
	}
	for _, c := range cases {
		out, done := evalCommand(c.in)
		if out != c.out || done != c.done {
			t.Errorf("evalCommand(%q) = (%q,%v); want (%q,%v)", c.in, out, done, c.out, c.done)
		}
	}
}
