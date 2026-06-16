package sheets

import "testing"

func TestSparklineBars(t *testing.T) {
	cells := []FsCellData{
		libCell(0, 0, float64(1)), libCell(0, 1, float64(5)), libCell(0, 2, float64(9)),
	}
	v := eval(t, "SPARKLINE(A1:C1)", cells...)
	// min=1 → lowest block, max=9 → highest block, mid value → mid block.
	got := []rune(v.toStr())
	if len(got) != 3 {
		t.Fatalf("want 3 glyphs, got %q", v.toStr())
	}
	if got[0] != '▁' || got[2] != '█' {
		t.Fatalf("endpoints should be lowest/highest block, got %q", v.toStr())
	}
	if got[1] == '▁' || got[1] == '█' {
		t.Fatalf("middle value should be a mid block, got %q", v.toStr())
	}
}

func TestSparklineWinloss(t *testing.T) {
	cells := []FsCellData{
		libCell(0, 0, float64(3)), libCell(0, 1, float64(-2)),
		libCell(0, 2, float64(0)), libCell(0, 3, float64(7)),
	}
	// Options pass as a bare charttype string (the engine has no {} array
	// literals) or via a key/value range; here we use the bare-string form.
	v := eval(t, `SPARKLINE(A1:D1,"winloss")`, cells...)
	if v.toStr() != "▀▄─▀" {
		t.Fatalf("winloss = %q, want ▀▄─▀", v.toStr())
	}
}

func TestSparklineOptionRange(t *testing.T) {
	// charttype supplied via a {key,value} range (E1="charttype", F1="winloss").
	cells := []FsCellData{
		libCell(0, 0, float64(3)), libCell(0, 1, float64(-2)),
		libCell(0, 4, "charttype"), libCell(0, 5, "winloss"),
	}
	v := eval(t, `SPARKLINE(A1:B1,E1:F1)`, cells...)
	if v.toStr() != "▀▄" {
		t.Fatalf("winloss via range = %q, want ▀▄", v.toStr())
	}
}

func TestSparklineFlat(t *testing.T) {
	cells := []FsCellData{
		libCell(0, 0, float64(4)), libCell(0, 1, float64(4)), libCell(0, 2, float64(4)),
	}
	v := eval(t, "SPARKLINE(A1:C1)", cells...)
	if v.toStr() != "▄▄▄" {
		t.Fatalf("flat series = %q, want ▄▄▄ (mid block)", v.toStr())
	}
}

func TestSparklineEmpty(t *testing.T) {
	cells := []FsCellData{libCell(0, 0, "x"), libCell(0, 1, "y")}
	v := eval(t, "SPARKLINE(A1:B1)", cells...)
	if v.toStr() != "" {
		t.Fatalf("non-numeric range should give empty string, got %q", v.toStr())
	}
}
