package projects

import "testing"

func TestParseRefs(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want []Ref
	}{
		{"bare", "ENG-42 tweak", []Ref{{Key: "ENG", Number: 42, Magic: false}}},
		{"magic fixes", "fixes ENG-7", []Ref{{Key: "ENG", Number: 7, Magic: true}}},
		{"magic closes caps", "Closes ENG-7", []Ref{{Key: "ENG", Number: 7, Magic: true}}},
		{"branch lowercase", "lucas/eng-42-fix-thing", []Ref{{Key: "ENG", Number: 42, Magic: false}}},
		{"multiple", "fix ENG-1 and ENG-2", []Ref{{Key: "ENG", Number: 1, Magic: true}, {Key: "ENG", Number: 2, Magic: false}}},
		{"dedupe keeps magic", "ENG-3 closes ENG-3", []Ref{{Key: "ENG", Number: 3, Magic: true}}},
		{"none", "no refs here", nil},
		{"word boundary", "foo-ENG-9", []Ref{{Key: "ENG", Number: 9, Magic: false}}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := ParseRefs(c.in)
			if len(got) != len(c.want) {
				t.Fatalf("len=%d want %d (%v)", len(got), len(c.want), got)
			}
			for i := range got {
				if got[i] != c.want[i] {
					t.Errorf("ref[%d]=%+v want %+v", i, got[i], c.want[i])
				}
			}
		})
	}
}
