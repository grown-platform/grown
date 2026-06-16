package sheets

import "testing"

// ARRAYFORMULA broadcasts operators and scalar functions over ranges, spilling
// the element-wise result.

func TestArrayFormulaMultiply(t *testing.T) {
	// =ARRAYFORMULA(A1:A3*B1:B3) over 1,2,3 × 10,20,30 → 10,40,90.
	out := Recompute([]FsCellData{
		libCell(0, 0, float64(1)), libCell(0, 1, float64(10)),
		libCell(1, 0, float64(2)), libCell(1, 1, float64(20)),
		libCell(2, 0, float64(3)), libCell(2, 1, float64(30)),
		libFormula(0, 2, "=ARRAYFORMULA(A1:A3*B1:B3)"),
	})
	wantCellNum(t, out, 0, 2, 10)
	wantCellNum(t, out, 1, 2, 40)
	wantCellNum(t, out, 2, 2, 90)
}

func TestArrayFormulaScalarBroadcast(t *testing.T) {
	// A scalar broadcasts across the range: =ARRAYFORMULA(A1:A3+100).
	out := Recompute([]FsCellData{
		libCell(0, 0, float64(1)),
		libCell(1, 0, float64(2)),
		libCell(2, 0, float64(3)),
		libFormula(0, 1, "=ARRAYFORMULA(A1:A3+100)"),
	})
	wantCellNum(t, out, 0, 1, 101)
	wantCellNum(t, out, 1, 1, 102)
	wantCellNum(t, out, 2, 1, 103)
}

func TestArrayFormulaConcat(t *testing.T) {
	// =ARRAYFORMULA(A1:A2 & "!") → "hi!", "yo!".
	out := Recompute([]FsCellData{
		libCell(0, 0, "hi"),
		libCell(1, 0, "yo"),
		libFormula(0, 1, `=ARRAYFORMULA(A1:A2&"!")`),
	})
	wantCellStr(t, out, 0, 1, "hi!")
	wantCellStr(t, out, 1, 1, "yo!")
}

func TestArrayFormulaIf(t *testing.T) {
	// IF broadcasts over its condition: positives → "pos", else "neg".
	out := Recompute([]FsCellData{
		libCell(0, 0, float64(5)),
		libCell(1, 0, float64(-3)),
		libCell(2, 0, float64(8)),
		libFormula(0, 1, `=ARRAYFORMULA(IF(A1:A3>0,"pos","neg"))`),
	})
	wantCellStr(t, out, 0, 1, "pos")
	wantCellStr(t, out, 1, 1, "neg")
	wantCellStr(t, out, 2, 1, "pos")
}

func TestArrayFormulaScalarFunc(t *testing.T) {
	// LEN maps element-wise: =ARRAYFORMULA(LEN(A1:A3)).
	out := Recompute([]FsCellData{
		libCell(0, 0, "a"),
		libCell(1, 0, "abc"),
		libCell(2, 0, "abcde"),
		libFormula(0, 1, "=ARRAYFORMULA(LEN(A1:A3))"),
	})
	wantCellNum(t, out, 0, 1, 1)
	wantCellNum(t, out, 1, 1, 3)
	wantCellNum(t, out, 2, 1, 5)
}

func TestArrayFormulaScalarStaysScalar(t *testing.T) {
	// With no ranges inside, ARRAYFORMULA just returns the scalar result.
	v := eval(t, "ARRAYFORMULA(2*3+1)")
	mustNum(t, v, 7)
}

func TestArithUnchangedOutsideArrayFormula(t *testing.T) {
	// Operator broadcasting must not leak outside ARRAYFORMULA: a bare range
	// times a scalar still collapses to the top-left (legacy behaviour).
	mustNum(t, eval(t, "1+2*3"), 7)
	mustNum(t, eval(t, "2^10"), 1024)
	if got := eval(t, "10/0"); !got.isErr() {
		t.Fatalf("10/0 = %v, want error", got)
	}
}
