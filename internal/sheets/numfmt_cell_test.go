package sheets

import "testing"

// Computed cells get their display text `m` from the cell's number format.
func TestComputedCellDisplayUsesNumberFormat(t *testing.T) {
	cell := func(r, c int, v interface{}, f, fa string) FsCellData {
		fc := &FsCell{V: v, F: f}
		if fa != "" {
			fc.CT = &FsCellType{FA: fa, T: "n"}
		}
		return FsCellData{R: r, C: c, V: fc}
	}
	data := []FsCellData{
		cell(0, 0, 1.0, "", ""),
		cell(0, 1, 8.0, "", ""),
		cell(1, 0, nil, "=A1/B1", "0.00%"),
		cell(1, 1, nil, "=A1/3", ""),
		cell(1, 2, nil, "=DATE(2024,1,2)", "m/d/yyyy"),
		cell(1, 3, nil, "=-1234.5", `_($* #,##0.00_);_($* (#,##0.00);_($* "-"??_);_(@_)`),
		cell(1, 4, nil, "=A1*1E+12", ""),
		cell(1, 5, nil, `="abc"`, `"<"@">"`),
	}
	want := map[[2]int]string{
		{1, 0}: "12.50%",
		{1, 1}: "0.333333333",
		{1, 2}: "1/2/2024",
		{1, 3}: " $(1,234.50)",
		{1, 4}: "1E+12",
		{1, 5}: "<abc>",
	}
	for _, cd := range Recompute(data) {
		if w, ok := want[[2]int{cd.R, cd.C}]; ok && cd.V.M != w {
			t.Errorf("%d,%d: m = %q, want %q", cd.R, cd.C, cd.V.M, w)
		}
	}
}

// TEXT() uses the full number-format engine.
func TestTextFunctionFormats(t *testing.T) {
	cases := map[string]string{
		`=TEXT(1234.5,"#,##0.00")`:           "1,234.50",
		`=TEXT(0.125,"0.0%")`:                "12.5%",
		`=TEXT(45293.75,"yyyy-mm-dd hh:mm")`: "2024-01-02 18:00",
		`=TEXT(1.5,"[h]:mm")`:                "36:00",
		`=TEXT(-5,"0;(0)")`:                  "(5)",
		`=TEXT(0.75,"# ?/?")`:                " 3/4",
		`=TEXT(60,"d-mmm-yyyy")`:             "29-Feb-1900",
		`=TEXT("abc","@"" (text)""")`:        "abc (text)",
		`=TEXT(12,"[<10]""small"";""big""")`: "big",
		`=TEXT(1234.5,"_($* #,##0.00_)")`:    " $1,234.50 ",
		`=TEXT("2024-01-02","dddd")`:         "Tuesday",
		`=VALUE("1 1/2")`:                    "1.5",
		`=VALUE("€5")`:                       "5",
	}
	for f, want := range cases {
		got := eval(t, f[1:])
		if got.toStr() != want {
			t.Errorf("%s = %q, want %q", f, got.toStr(), want)
		}
	}
}
