package main

import "strings"

// fakeTree is the ENTIRE (fake, in-memory) filesystem this sandbox will ever
// reveal. There is no real filesystem access — `ls` reports from this map only.
var fakeTree = map[string][]string{
	"":        {"README.txt", "docs/", "welcome/"},
	"docs":    {"intro.md", "safety.md"},
	"welcome": {"hello.txt"},
}

// evalCommand interprets one input line and returns the text to write back
// (CRLF-terminated for a raw terminal) plus whether the session should close.
//
// The ONLY accepted command is `ls` (optional flags, at most one directory
// operand). Everything else is refused. There is deliberately no path here to a
// real shell, process exec, or file read — evalCommand is a pure function over
// fakeTree, and the SSH server never shells out.
func evalCommand(line string) (out string, done bool) {
	line = strings.TrimSpace(line)
	switch line {
	case "":
		return "", false
	case "exit", "logout", "quit":
		return "bye\r\n", true
	}
	fields := strings.Fields(line)
	if fields[0] != "ls" {
		return "permitted: ls only\r\n", false
	}
	// Collect non-flag operands (flags like -la are ignored, not executed).
	var dirs []string
	for _, f := range fields[1:] {
		if strings.HasPrefix(f, "-") {
			continue
		}
		dirs = append(dirs, strings.TrimRight(f, "/"))
	}
	if len(dirs) > 1 {
		return "permitted: ls only\r\n", false
	}
	target := ""
	if len(dirs) == 1 {
		target = dirs[0]
	}
	entries, ok := fakeTree[target]
	if !ok {
		return "ls: cannot access '" + target + "': No such file or directory\r\n", false
	}
	return strings.Join(entries, "  ") + "\r\n", false
}
