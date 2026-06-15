package sites

import "testing"

func TestEmptyJSON(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{name: "blank becomes empty object", in: "", want: "{}"},
		{name: "object passes through", in: `{"pages":[]}`, want: `{"pages":[]}`},
		{name: "whitespace is not blank", in: " ", want: " "},
		{name: "array passes through", in: `[]`, want: `[]`},
		{name: "literal null passes through", in: "null", want: "null"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := emptyJSON(tt.in); got != tt.want {
				t.Fatalf("emptyJSON(%q): got %q want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestNewRepository(t *testing.T) {
	// Constructor wires the (nil) pool without panicking; methods aren't called.
	if NewRepository(nil) == nil {
		t.Fatal("NewRepository returned nil")
	}
}
