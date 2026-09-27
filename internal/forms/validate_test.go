package forms

import (
	"strings"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// Mask behaviour is ported from OnlyOffice's text-form mask tests (expected
// values only; see validate.go for the syntax). The same table runs in
// web/app/src/pages/forms/validate.test.ts.
func TestMaskCorrect(t *testing.T) {
	t.Run("oo:word/forms/forms.js#Check correction of text mask", func(t *testing.T) {
		cases := []struct{ mask, in, want string }{
			{"", "1234", "1234"},
			{"X", "1234", "1"},
			{"a", "1234", "1234"},
			{"a9", "bc", "bc"},
			{`a\9`, "bc", "b9"},
			{`\a9`, "u", "u"},
			{`\a9`, "9", "a9"},
			{"999-999", "123", "123-"},
			{"999-999", "123456", "123-456"},
			{"(999) 999-9999", "", ""},
			{"(999) 999-9999", "9", "(9"},
			{"(999) 999-9999", "9(99", "9(99"},
			{"(999) 999-9999", "999", "(999) "},
			{"(999) 999-9999", "(999)123", "(999) 123-"},
			{"(999) 999-9999", "9991231122", "(999) 123-1122"},
			{"(999) 999-9999", "(999)123-1122", "(999) 123-1122"},
			{"(999) 999-9999", "333)123-1122", "(333) 123-1122"},
			{"(999) 999-9999", "9)bcs", "9)bcs"},
			{"+7 (999)-999-99-99", "9991112211", "+7 (999)-111-22-11"},
			{"+7 (999)-999-99-99", "999a", "999a"},
			{"XXXXX@aaaa", "index", "index@"},
			{"XXXXX@aaaa", "index1234", "index1234"},
			{"XXXXX@aaaa.ru", "indexmail", "index@mail.ru"},
			{"99.99.99.9.9", "12345678", "12.34.56.7.8"},
			{"99.99.99.9.9", "1234567812345678", "12.34.56.7.8"},
			{`OO-\x`, "12", "12-x"},
			{`OOO-O9O\Oxxx:uuu-y`, "ad949f", "ad9-49fOxxx:uuu-y"},
			{`OOO-O9O\Oxxx:uuu-y`, "ad949fOxxx:uuu-fke3", "ad9-49fOxxx:uuu-y"},
			{`OOO-O9O\Obbb:uuu-y-999`, "ad949b1O", "ad949b1O"},
			{`9-\a-9-b-9-c-9-d`, "1234", "1-a-2-b-3-c-4-d"},
			{"order №OOOOO-99.99.99-aa-9999", "ab54d310822uk1234", "order №ab54d-31.08.22-uk-1234"},
			{"order №OOOOO-99.99.99-aa-9999", "or", "order №"},
			{"OOOO:OOOO:OOOO:OOOO:OOOO:OOOO:OOOO:OOOO", "20010db885a3000000008a2e03707334", "2001:0db8:85a3:0000:0000:8a2e:0370:7334"},
		}
		for _, c := range cases {
			if got := MaskCorrect(c.mask, c.in); got != c.want {
				t.Errorf("MaskCorrect(%q, %q) = %q, want %q", c.mask, c.in, got, c.want)
			}
		}
	})
}

func TestMaskCheck(t *testing.T) {
	t.Run("oo:word/forms/forms.js#Check text form formats", func(t *testing.T) {
		cases := []struct {
			mask, in string
			full     bool
			want     bool
		}{
			{"(999)-99-9999", "123-12-1234", false, false},
			{"(999)-99-9999", "(123)", false, true},
			{"(999)-99-9999", "(123)abc", false, false},
			{"(999)-99-9999", "(123)-12-5555", false, true},
			{`(9\99)-99-9999`, "(1", false, true},
			{`(9\99)-99-9999`, "(123)-12-5555", false, false},
			{`(9\99)-99-9999`, "(193)-12-5555", false, true},
			{`\aabcX`, "aabcd", false, true},
			{`\aabcX`, "qqbcd", false, false},
			{`\aabcX`, "aqbc123", false, false},
			// full check (submission): every position filled
			{"999-aaa", "123", true, false},
			{"999-aaa", "123-ABC", true, true},
			{"999-aaa", "123-A12", true, false},
		}
		for _, c := range cases {
			if got := MaskCheck(c.mask, c.in, c.full); got != c.want {
				t.Errorf("MaskCheck(%q, %q, %v) = %v, want %v", c.mask, c.in, c.full, got, c.want)
			}
		}
	})
}

func v(kind, op, a, b string) *Validation {
	return &Validation{Kind: kind, Op: op, Value: a, Value2: b}
}

func TestValidateAnswer(t *testing.T) {
	short := func(val *Validation) Question { return Question{Type: TypeShortAnswer, Validation: val} }
	cases := []struct {
		name string
		q    Question
		ans  any
		want string // "" = ok, otherwise a substring of the message
	}{
		{"empty is always ok", short(v("number", "gt", "5", "")), "", ""},
		{"gt ok", short(v("number", "gt", "5", "")), "6", ""},
		{"gt fail", short(v("number", "gt", "5", "")), "5", "greater than 5"},
		{"gte", short(v("number", "gte", "5", "")), "5", ""},
		{"lt fail", short(v("number", "lt", "5", "")), "7", "less than 5"},
		{"lte", short(v("number", "lte", "5", "")), "5", ""},
		{"eq", short(v("number", "eq", "2.5", "")), "2.50", ""},
		{"neq fail", short(v("number", "neq", "3", "")), "3", "not equal"},
		{"between ok", short(v("number", "between", "1", "10")), "10", ""},
		{"between fail", short(v("number", "between", "1", "10")), "11", "between 1 and 10"},
		{"not between", short(v("number", "not_between", "1", "10")), "5", "not between"},
		{"is number fail", short(v("number", "is_number", "", "")), "12abc", "Must be a number"},
		{"is number negative", short(v("number", "is_number", "", "")), "-3.5", ""},
		{"not a number with inf", short(v("number", "is_number", "", "")), "Inf", "Must be a number"},
		{"whole ok", short(v("number", "whole_number", "", "")), "42", ""},
		{"whole fail", short(v("number", "whole_number", "", "")), "4.2", "whole number"},
		{"contains", short(v("text", "contains", "@acme", "")), "bob@acme.org", ""},
		{"contains fail", short(v("text", "contains", "@acme", "")), "bob@x.org", `Must contain "@acme"`},
		{"not contains", short(v("text", "not_contains", "spam", "")), "no spam here", "Must not contain"},
		{"email ok", short(v("text", "email", "", "")), "a@b.co", ""},
		{"email fail", short(v("text", "email", "", "")), "a@b", "email"},
		{"url ok", short(v("text", "url", "", "")), "https://grown.haus/forms?x=1", ""},
		{"url bare host", short(v("text", "url", "", "")), "www.example.com", ""},
		{"url fail", short(v("text", "url", "", "")), "not a url", "URL"},
		{"max chars", short(v("length", "max_chars", "3", "")), "abcd", "at most 3"},
		{"max chars runes", short(v("length", "max_chars", "3", "")), "äöü", ""},
		{"min chars", short(v("length", "min_chars", "3", "")), "ab", "at least 3"},
		{"regex matches", short(v("regex", "matches", "[A-Fa-f0-9]+", "")), "12FF", ""},
		{"regex matches fail", short(v("regex", "matches", "[A-Fa-f0-9]+", "")), "Test", "pattern"},
		{"regex contains", short(v("regex", "contains", `\d`, "")), "abc1", ""},
		{"regex not contains", short(v("regex", "not_contains", `\d`, "")), "abc1", "Must not contain a match"},
		{"regex not matches", short(v("regex", "not_matches", `a+`, "")), "aaa", "Must not match"},
		{"regex RE2-incompatible is client-only", short(v("regex", "matches", `(?=x)x`, "")), "y", ""},
		{"custom error text", Question{Type: TypeShortAnswer, Validation: &Validation{Kind: "number", Op: "gt", Value: "0", ErrorText: "Positive please"}}, "-1", "Positive please"},
		{"paragraph length", Question{Type: TypeParagraph, Validation: v("length", "max_chars", "5", "")}, "too long text", "at most 5"},
		{"checkbox at least", Question{Type: TypeCheckboxes, Validation: v("checkbox", "at_least", "2", "")}, []any{"a"}, "at least 2"},
		{"checkbox at most", Question{Type: TypeCheckboxes, Validation: v("checkbox", "at_most", "1", "")}, []any{"a", "b"}, "at most 1"},
		{"checkbox exactly ok", Question{Type: TypeCheckboxes, Validation: v("checkbox", "exactly", "2", "")}, []any{"a", "b"}, ""},
		{"format digits", Question{Type: TypeShortAnswer, TextFormat: FormatDigits}, "12a", "only digits"},
		{"format letters", Question{Type: TypeShortAnswer, TextFormat: FormatLetters}, "привет", ""},
		{"format phone ok", Question{Type: TypeShortAnswer, TextFormat: FormatPhone}, "(555) 123-4567", ""},
		{"format phone short", Question{Type: TypeShortAnswer, TextFormat: FormatPhone}, "(555) 123", "(999) 999-9999"},
		{"format zip", Question{Type: TypeShortAnswer, TextFormat: FormatZip}, "1234a", "99999"},
		{"format credit card", Question{Type: TypeShortAnswer, TextFormat: FormatCreditCard}, "4111 1111 1111 1111", ""},
		{"format custom mask", Question{Type: TypeShortAnswer, TextFormat: FormatMask, Mask: `AB-999`}, "1B-123", "AB-999"},
		{"format custom escaped mask", Question{Type: TypeShortAnswer, TextFormat: FormatMask, Mask: `\A\B-999`}, "AB-123", ""},
		{"rating ok", Question{Type: TypeRating, ScaleMax: 10}, "10", ""},
		{"rating out of range", Question{Type: TypeRating, ScaleMax: 3}, "4", "1 to 3"},
		{"rating default levels", Question{Type: TypeRating}, "5", ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := ValidateAnswer(c.q, c.ans)
			if c.want == "" && got != "" {
				t.Fatalf("got error %q, want ok", got)
			}
			if c.want != "" && !strings.Contains(got, c.want) {
				t.Fatalf("got %q, want it to contain %q", got, c.want)
			}
		})
	}
}

func grid(typ string, required, limit bool) Question {
	return Question{ID: "g", Type: typ, Title: "Grid", Required: required, LimitOnePerColumn: limit,
		Rows: []string{"Mon", "Tue"}, Options: []string{"AM", "PM"}}
}

func TestValidateGrid(t *testing.T) {
	cases := []struct {
		name string
		q    Question
		ans  any
		want string
	}{
		{"mc grid ok", grid(TypeMultipleChoiceGrid, true, false), map[string]any{"Mon": "AM", "Tue": "AM"}, ""},
		{"required needs each row", grid(TypeMultipleChoiceGrid, true, false), map[string]any{"Mon": "AM"}, "one response per row"},
		{"optional partial ok", grid(TypeMultipleChoiceGrid, false, false), map[string]any{"Mon": "AM"}, ""},
		{"limit one per column", grid(TypeMultipleChoiceGrid, false, true), map[string]any{"Mon": "AM", "Tue": "AM"}, "more than one response per column"},
		{"unknown row", grid(TypeMultipleChoiceGrid, false, false), map[string]any{"Wed": "AM"}, "Unknown row"},
		{"unknown column", grid(TypeMultipleChoiceGrid, false, false), map[string]any{"Mon": "Night"}, "Unknown column"},
		{"mc grid one per row", grid(TypeMultipleChoiceGrid, false, false), map[string]any{"Mon": []any{"AM", "PM"}}, "one response per row"},
		{"checkbox grid many per row", grid(TypeCheckboxGrid, true, false), map[string]any{"Mon": []any{"AM", "PM"}, "Tue": []any{"PM"}}, ""},
		{"checkbox grid column limit", grid(TypeCheckboxGrid, false, true), map[string]any{"Mon": []any{"AM"}, "Tue": []any{"AM"}}, "per column"},
		{"not an object", grid(TypeCheckboxGrid, false, false), "AM", "Invalid grid answer"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := ValidateAnswer(c.q, c.ans)
			if c.want == "" && got != "" {
				t.Fatalf("got error %q, want ok", got)
			}
			if c.want != "" && !strings.Contains(got, c.want) {
				t.Fatalf("got %q, want it to contain %q", got, c.want)
			}
		})
	}
}

// branchingForm: page 0 asks "Pet?"; Cat jumps to section Cats, Dog to Dogs,
// None submits. Cats continues to Dogs by default; Dogs submits after itself.
func branchingForm() Form {
	return Form{Questions: []Question{
		{ID: "name", Type: TypeShortAnswer, Title: "Name", Required: true},
		{ID: "pet", Type: TypeMultipleChoice, Title: "Pet?", Options: []string{"Cat", "Dog", "None"},
			GoToSection: map[string]string{"Cat": "s-cats", "Dog": "s-dogs", "None": SubmitTarget}},
		{ID: "s-cats", IsSection: true, Title: "Cats", AfterSection: SubmitTarget},
		{ID: "cat", Type: TypeShortAnswer, Title: "Cat name", Required: true},
		{ID: "s-dogs", IsSection: true, Title: "Dogs"},
		{ID: "dog", Type: TypeShortAnswer, Title: "Dog name", Required: true},
		{ID: "s-end", IsSection: true, Title: "End"},
		{ID: "extra", Type: TypeParagraph, Title: "Anything else?"},
	}}
}

func TestVisitedQuestions(t *testing.T) {
	f := branchingForm()
	cases := []struct {
		name    string
		answers map[string]any
		want    []string
	}{
		{"cat branch then after-section submit", map[string]any{"pet": "Cat"}, []string{"name", "pet", "cat"}},
		{"dog branch continues to end", map[string]any{"pet": "Dog"}, []string{"name", "pet", "dog", "extra"}},
		{"none submits", map[string]any{"pet": "None"}, []string{"name", "pet"}},
		{"no answer walks every page in order", map[string]any{}, []string{"name", "pet", "cat"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := VisitedQuestions(f, c.answers)
			if len(got) != len(c.want) {
				t.Fatalf("visited %v, want %v", got, c.want)
			}
			for _, id := range c.want {
				if !got[id] {
					t.Fatalf("visited %v, want %v", got, c.want)
				}
			}
		})
	}
	t.Run("after first section setting", func(t *testing.T) {
		f := branchingForm()
		f.Questions[1].GoToSection = nil
		f.Settings.AfterFirstSection = "s-end"
		got := VisitedQuestions(f, map[string]any{})
		if !got["extra"] || got["cat"] || got["dog"] {
			t.Fatalf("visited %v", got)
		}
	})
	t.Run("loop back terminates", func(t *testing.T) {
		f := branchingForm()
		f.Questions[2].AfterSection = "s-cats" // Cats -> Cats forever
		got := VisitedQuestions(f, map[string]any{"pet": "Cat"})
		if !got["cat"] || got["dog"] {
			t.Fatalf("visited %v", got)
		}
	})
}

func TestCheckSubmission(t *testing.T) {
	code := func(err error) codes.Code { return status.Code(err) }
	f := branchingForm()

	t.Run("required on a skipped branch is not enforced", func(t *testing.T) {
		kept, err := checkSubmission(f, map[string]any{"name": "Ann", "pet": "Cat", "cat": "Tom"})
		if err != nil {
			t.Fatal(err)
		}
		if kept["cat"] != "Tom" {
			t.Fatalf("kept %v", kept)
		}
	})
	t.Run("required on the taken branch is enforced", func(t *testing.T) {
		_, err := checkSubmission(f, map[string]any{"name": "Ann", "pet": "Dog"})
		if code(err) != codes.InvalidArgument || !strings.Contains(err.Error(), "Dog name") {
			t.Fatalf("err = %v", err)
		}
	})
	t.Run("answers on skipped sections are dropped", func(t *testing.T) {
		kept, err := checkSubmission(f, map[string]any{"name": "Ann", "pet": "Cat", "cat": "Tom", "dog": "Rex", "extra": "hi", "meta": "x"})
		if err != nil {
			t.Fatal(err)
		}
		if _, ok := kept["dog"]; ok {
			t.Fatalf("dog answer kept: %v", kept)
		}
		if _, ok := kept["extra"]; ok {
			t.Fatalf("extra answer kept: %v", kept)
		}
		if kept["meta"] != "x" {
			t.Fatalf("non-question key dropped: %v", kept)
		}
	})
	t.Run("validation is enforced server side", func(t *testing.T) {
		g := Form{Questions: []Question{{ID: "age", Type: TypeShortAnswer, Title: "Age",
			Validation: &Validation{Kind: "number", Op: "between", Value: "18", Value2: "99", ErrorText: "Adults only"}}}}
		_, err := checkSubmission(g, map[string]any{"age": "12"})
		if code(err) != codes.InvalidArgument || !strings.Contains(err.Error(), "Adults only") {
			t.Fatalf("err = %v", err)
		}
		if _, err := checkSubmission(g, map[string]any{"age": "30"}); err != nil {
			t.Fatal(err)
		}
	})
	// Mirrors OnlyOffice's required-forms check: required fields must be
	// filled, and a filled masked field only counts when the mask is complete.
	t.Run("oo:word/forms/forms.js#Check filling out the required forms", func(t *testing.T) {
		g := Form{Questions: []Question{
			{ID: "cb", Type: TypeCheckboxes, Title: "Agree", Options: []string{"Yes"}},
			{ID: "t1", Type: TypeShortAnswer, Title: "Text"},
			{ID: "t2", Type: TypeShortAnswer, Title: "Masked", TextFormat: FormatMask, Mask: "999-aaa"},
		}}
		if _, err := checkSubmission(g, map[string]any{}); err != nil {
			t.Fatalf("nothing required: %v", err)
		}
		g.Questions[0].Required = true
		if _, err := checkSubmission(g, map[string]any{}); err == nil {
			t.Fatal("required checkbox empty: want error")
		}
		g.Questions[1].Required = true
		ok := map[string]any{"cb": []any{"Yes"}, "t1": "AB"}
		if _, err := checkSubmission(g, ok); err != nil {
			t.Fatalf("filled: %v", err)
		}
		for in, wantOK := range map[string]bool{"123": false, "123-ABC": true, "123-A12": false, "": true} {
			ok["t2"] = in
			_, err := checkSubmission(g, ok)
			if (err == nil) != wantOK {
				t.Errorf("mask 999-aaa with %q: err=%v wantOK=%v", in, err, wantOK)
			}
		}
		g.Questions[2].TextFormat = ""
		g.Questions[2].Validation = &Validation{Kind: "regex", Op: "matches",
			Value: `https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)`}
		ok["t2"] = "123-AAB"
		if _, err := checkSubmission(g, ok); err == nil {
			t.Error("hyperlink regexp with 123-AAB: want error")
		}
		ok["t2"] = "https://www.onlyoffice.com/"
		if _, err := checkSubmission(g, ok); err != nil {
			t.Errorf("hyperlink regexp with a URL: %v", err)
		}
	})
}

func TestGradeGrid(t *testing.T) {
	k := func(r, c string) string { return r + GridKeySep + c }
	mc := Question{ID: "g", Type: TypeMultipleChoiceGrid, Points: 4, Rows: []string{"1+1", "2+2"}, Options: []string{"2", "4"},
		CorrectAnswers: []string{k("1+1", "2"), k("2+2", "4")}}
	cb := Question{ID: "c", Type: TypeCheckboxGrid, Points: 2, Rows: []string{"Primes", "Even"}, Options: []string{"2", "3", "4"},
		CorrectAnswers: []string{k("Primes", "2"), k("Primes", "3"), k("Even", "2"), k("Even", "4")}}
	cases := []struct {
		name string
		q    Question
		ans  any
		want float64
	}{
		{"mc all rows", mc, map[string]any{"1+1": "2", "2+2": "4"}, 4},
		{"mc one row", mc, map[string]any{"1+1": "2", "2+2": "2"}, 2},
		{"mc none", mc, map[string]any{}, 0},
		{"cb exact sets", cb, map[string]any{"Primes": []any{"3", "2"}, "Even": []any{"2", "4"}}, 2},
		{"cb one row subset", cb, map[string]any{"Primes": []any{"2"}, "Even": []any{"2", "4"}}, 1},
		{"cb superset wrong", cb, map[string]any{"Primes": []any{"2", "3", "4"}}, 0},
		{"no key", Question{Type: TypeMultipleChoiceGrid, Points: 3}, map[string]any{"a": "b"}, 0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := gradeQuestion(c.q, c.ans); got != c.want {
				t.Fatalf("got %v want %v", got, c.want)
			}
		})
	}
	t.Run("score and max include grids, not scale/rating", func(t *testing.T) {
		qs := []Question{mc, cb,
			{ID: "s", Type: TypeLinearScale, Points: 5, CorrectAnswers: []string{"3"}},
			{ID: "r", Type: TypeRating, Points: 5, CorrectAnswers: []string{"3"}},
		}
		if got := computeMaxScore(qs); got != 6 {
			t.Fatalf("max = %v, want 6", got)
		}
		ans := map[string]any{"g": map[string]any{"1+1": "2"}, "c": map[string]any{"Even": []any{"4", "2"}}, "s": "3", "r": "3"}
		if got := computeScore(qs, ans); got != 3 {
			t.Fatalf("score = %v, want 3", got)
		}
	})
}

func TestSummaryGridAndSkipped(t *testing.T) {
	f := branchingForm()
	f.Questions = append(f.Questions, Question{ID: "g", Type: TypeMultipleChoiceGrid, Title: "When",
		Rows: []string{"Mon", "Tue"}, Options: []string{"AM", "PM"}})
	resps := []Response{
		{Answers: map[string]any{"name": "A", "pet": "Cat", "cat": "Tom"}},
		{Answers: map[string]any{"name": "B", "pet": "Dog", "dog": "Rex", "g": map[string]any{"Mon": "AM", "Tue": "PM"}}},
		{Answers: map[string]any{"name": "C", "pet": "Dog", "dog": "Fido", "g": map[string]any{"Mon": "AM"}}},
	}
	s := buildSummary(f, resps)
	byID := map[string]int{}
	for i, q := range s.Questions {
		byID[q.QuestionId] = i
	}
	cat := s.Questions[byID["cat"]]
	if cat.AnsweredCount != 1 || cat.SkippedCount != 2 {
		t.Fatalf("cat answered=%d skipped=%d", cat.AnsweredCount, cat.SkippedCount)
	}
	g := s.Questions[byID["g"]]
	if g.SkippedCount != 1 || g.AnsweredCount != 2 {
		t.Fatalf("grid answered=%d skipped=%d", g.AnsweredCount, g.SkippedCount)
	}
	if len(g.GridRows) != 2 || g.GridRows[0].Row != "Mon" || g.GridRows[0].Counts["AM"] != 2 || g.GridRows[1].Counts["PM"] != 1 {
		t.Fatalf("grid rows = %v", g.GridRows)
	}
}
