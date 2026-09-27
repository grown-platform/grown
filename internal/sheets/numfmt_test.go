package sheets

// Replays testdata/numfmt/*.json, the fixtures shared with the vitest suite
// web/app/src/pages/sheets/__parity__/numberFormat.parity.test.ts, through the
// Go port. Case ids are the OnlyOffice `oo:` tags (or `grown:` for Grown's own
// cases). Checks marked "pending" are skipped, as in the TS suite.

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type nfFormatCase struct {
	ID     string            `json:"id"`
	Values []json.RawMessage `json:"values"`
	Checks []struct {
		Format  string            `json:"format"`
		Value   json.RawMessage   `json:"value"`
		Values  []json.RawMessage `json:"values"`
		Expect  json.RawMessage   `json:"expect"`
		Pending string            `json:"pending"`
	} `json:"checks"`
}

type nfParseCase struct {
	ID     string `json:"id"`
	Checks []struct {
		Fn         string                           `json:"fn"`
		Args       []json.RawMessage                `json:"args"`
		Input      *string                          `json:"input"`
		PDF        bool                             `json:"pdf"`
		Culture    *struct{ Decimal, Group string } `json:"culture"`
		CellFormat string                           `json:"cellFormat"`
		Date1904   bool                             `json:"date1904"`
		Expect     json.RawMessage                  `json:"expect"`
		Pending    string                           `json:"pending"`
	} `json:"checks"`
}

// nfFixtureValue decodes a fixture value: a JSON number or string.
func nfFixtureValue(raw json.RawMessage) interface{} {
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	var f float64
	if json.Unmarshal(raw, &f) == nil {
		return f
	}
	var b bool
	_ = json.Unmarshal(raw, &b)
	return b
}

func nfFixtureFiles(t *testing.T, kind string) []string {
	files, err := filepath.Glob(filepath.Join("testdata", "numfmt", "*.json"))
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, f := range files {
		b, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		isParse := strings.Contains(string(b), `"input"`) || strings.Contains(string(b), `"fn"`)
		if (kind == "parse") == isParse {
			out = append(out, f)
		}
	}
	return out
}

func TestNumFmtFormatFixtures(t *testing.T) {
	for _, file := range nfFixtureFiles(t, "format") {
		b, _ := os.ReadFile(file)
		var doc struct {
			Cases []nfFormatCase `json:"cases"`
		}
		if err := json.Unmarshal(b, &doc); err != nil {
			t.Fatalf("%s: %v", file, err)
		}
		for _, c := range doc.Cases {
			c := c
			t.Run(c.ID, func(t *testing.T) {
				live := 0
				for i, chk := range c.Checks {
					if chk.Pending != "" {
						continue
					}
					live++
					values := chk.Values
					if values == nil && chk.Value != nil {
						values = []json.RawMessage{chk.Value}
					}
					if values == nil {
						values = c.Values
					}
					var want []string
					if err := json.Unmarshal(chk.Expect, &want); err != nil {
						var one string
						if err := json.Unmarshal(chk.Expect, &one); err != nil {
							t.Fatalf("check %d: bad expect %s", i, chk.Expect)
						}
						want = []string{one}
					}
					for k, raw := range values {
						v := nfFixtureValue(raw)
						runs, _ := nfFormatRuns(v, chk.Format, false)
						if got := nfRunsText(runs); got != want[k] {
							t.Errorf("check %d: format %q value %v: want %q got %q", i, chk.Format, v, want[k], got)
						}
					}
				}
				if live == 0 {
					t.Skip("all checks pending")
				}
			})
		}
	}
}

func TestNumFmtParseFixtures(t *testing.T) {
	for _, file := range nfFixtureFiles(t, "parse") {
		b, _ := os.ReadFile(file)
		var doc struct {
			Year  int           `json:"year"`
			Cases []nfParseCase `json:"cases"`
		}
		if err := json.Unmarshal(b, &doc); err != nil {
			t.Fatalf("%s: %v", file, err)
		}
		for _, c := range doc.Cases {
			c := c
			t.Run(c.ID, func(t *testing.T) {
				live := 0
				for i, chk := range c.Checks {
					if chk.Pending != "" {
						continue
					}
					live++
					if chk.Fn != "" {
						got := nfCallFixtureFn(chk.Fn, chk.Args)
						var want interface{}
						_ = json.Unmarshal(chk.Expect, &want)
						if fmt.Sprint(got) != fmt.Sprint(want) {
							t.Errorf("check %d: %s(%s): want %v got %v", i, chk.Fn, chk.Args, want, got)
						}
						continue
					}
					o := nfParseOpts{cellFormat: chk.CellFormat, date1904: chk.Date1904, year: doc.Year, pdf: chk.PDF}
					if chk.Culture != nil {
						o.culture = &nfCulture{chk.Culture.Decimal, chk.Culture.Group}
					}
					var got nfParsed
					var ok bool
					if chk.PDF {
						v, hasTime, pok := nfParseDatePDF(*chk.Input, o)
						got, ok = nfParsed{value: v, date: pok, time: hasTime}, pok
					} else {
						got, ok = nfParseInput(*chk.Input, o)
					}
					if err := nfCheckParse(got, ok, chk.Expect); err != "" {
						t.Errorf("check %d: %q in %q: %s", i, *chk.Input, chk.CellFormat, err)
					}
				}
				if live == 0 {
					t.Skip("all checks pending")
				}
			})
		}
	}
}

func nfCheckParse(got nfParsed, ok bool, raw json.RawMessage) string {
	if string(raw) == "null" {
		if ok {
			return fmt.Sprintf("want text, got %+v", got)
		}
		return ""
	}
	var e struct {
		Value    *float64 `json:"value"`
		Tol      *float64 `json:"tol"`
		Format   *string  `json:"format"`
		Percent  bool     `json:"percent"`
		Currency bool     `json:"currency"`
		Date     bool     `json:"date"`
		Time     bool     `json:"time"`
		Lt       *float64 `json:"lt"`
		Gt       *float64 `json:"gt"`
		IfParsed bool     `json:"ifParsed"`
	}
	if err := json.Unmarshal(raw, &e); err != nil {
		return err.Error()
	}
	if !ok {
		if e.IfParsed {
			return ""
		}
		return "want a value, got text"
	}
	if e.Format != nil && got.format != *e.Format {
		return fmt.Sprintf("format want %q got %q", *e.Format, got.format)
	}
	if e.Value != nil {
		if e.Tol != nil {
			if math.Abs(got.value-*e.Value) >= *e.Tol {
				return fmt.Sprintf("value want %v got %v", *e.Value, got.value)
			}
		} else if got.value != *e.Value {
			return fmt.Sprintf("value want %v got %v", *e.Value, got.value)
		}
	}
	if (e.Percent && !got.percent) || (e.Currency && !got.currency) || (e.Date && !got.date) || (e.Time && !got.time) {
		return fmt.Sprintf("kind flags: want %+v got %+v", e, got)
	}
	if e.Lt != nil && !(got.value < *e.Lt) {
		return fmt.Sprintf("want < %v got %v", *e.Lt, got.value)
	}
	if e.Gt != nil && !(got.value > *e.Gt) {
		return fmt.Sprintf("want > %v got %v", *e.Gt, got.value)
	}
	return ""
}

func nfCallFixtureFn(fn string, args []json.RawMessage) interface{} {
	num := func(i int) int {
		var f float64
		_ = json.Unmarshal(args[i], &f)
		return int(f)
	}
	str := func(i int) string {
		var s string
		_ = json.Unmarshal(args[i], &s)
		return s
	}
	switch fn {
	case "isLeapYear":
		return nfIsLeapYear(num(0))
	case "isValidDay":
		return nfIsValidDay(num(0), num(1), num(2))
	case "isValidDate":
		return nfIsValidDate(num(0), num(1), num(2))
	case "isValidDatePDF":
		return nfIsValidDatePDF(num(0), num(1), num(2))
	case "isLocaleNumber":
		return nfIsLocaleNumber(str(0), nil)
	case "parseLocaleNumber":
		return nfParseLocaleNumber(str(0), nil)
	case "strcmp":
		a, b, start, n := str(0), str(1), num(2), num(3)
		bStart := 0
		if len(args) > 4 {
			bStart = num(4)
		}
		if n <= 0 {
			return false
		}
		for i := 0; i < n; i++ {
			if start+i >= len(a) || bStart+i >= len(b) || a[start+i] != b[bStart+i] {
				return false
			}
		}
		return true
	}
	return nil
}
