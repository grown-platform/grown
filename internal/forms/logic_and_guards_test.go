package forms

import (
	"context"
	"reflect"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
	"code.pick.haus/grown/grown/internal/auth"
	"code.pick.haus/grown/grown/internal/orgs"
	"code.pick.haus/grown/grown/internal/users"
)

// --- asString ---

func TestAsString(t *testing.T) {
	cases := []struct {
		name string
		in   any
		want string
	}{
		{"string", "hello", "hello"},
		{"empty string", "", ""},
		{"float whole", float64(5), "5"},
		{"float fractional", 3.25, "3.25"},
		{"bool true", true, "true"},
		{"bool false", false, "false"},
		{"nil", nil, ""},
		{"slice unsupported", []any{"x"}, ""},
		{"int unsupported", 7, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := asString(c.in); got != c.want {
				t.Errorf("asString(%#v): got %q want %q", c.in, got, c.want)
			}
		})
	}
}

// --- asStringSlice ---

func TestAsStringSlice(t *testing.T) {
	cases := []struct {
		name string
		in   any
		want []string
	}{
		{"slice of strings", []any{"a", "b"}, []string{"a", "b"}},
		{"slice with float", []any{float64(1), "b"}, []string{"1", "b"}},
		{"single string promoted", "solo", []string{"solo"}},
		{"empty slice", []any{}, []string{}},
		{"nil", nil, nil},
		{"unsupported type", 42, nil},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := asStringSlice(c.in)
			if !reflect.DeepEqual(got, c.want) {
				t.Errorf("asStringSlice(%#v): got %#v want %#v", c.in, got, c.want)
			}
		})
	}
}

// --- isGradable ---

func TestIsGradable(t *testing.T) {
	gradable := []string{TypeMultipleChoice, TypeCheckboxes, TypeDropdown, TypeShortAnswer}
	for _, ty := range gradable {
		if !isGradable(ty) {
			t.Errorf("isGradable(%q): got false want true", ty)
		}
	}
	notGradable := []string{TypeParagraph, TypeLinearScale, TypeDate, TypeTime, TypeFileUpload, "unknown"}
	for _, ty := range notGradable {
		if isGradable(ty) {
			t.Errorf("isGradable(%q): got true want false", ty)
		}
	}
}

// --- gradeQuestion ---

func TestGradeQuestion_Checkboxes(t *testing.T) {
	q := Question{Type: TypeCheckboxes, Points: 4, CorrectAnswers: []string{"a", "e"}}
	cases := []struct {
		name   string
		answer any
		want   float64
	}{
		{"exact match", []any{"a", "e"}, 4},
		{"exact match reordered", []any{"e", "a"}, 4},
		{"partial subset", []any{"a"}, 0},
		{"superset", []any{"a", "e", "x"}, 0},
		{"wrong same size", []any{"a", "x"}, 0},
		{"empty", []any{}, 0},
		{"nil", nil, 0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := gradeQuestion(q, c.answer); got != c.want {
				t.Errorf("gradeQuestion(%#v): got %v want %v", c.answer, got, c.want)
			}
		})
	}
}

func TestGradeQuestion_SingleAnswer(t *testing.T) {
	q := Question{Type: TypeShortAnswer, Points: 2, CorrectAnswers: []string{"Cat", "Feline"}}
	cases := []struct {
		name   string
		answer any
		want   float64
	}{
		{"exact", "Cat", 2},
		{"case insensitive", "CAT", 2},
		{"with surrounding space", "  cat  ", 2},
		{"second valid key", "feline", 2},
		{"wrong", "dog", 0},
		{"empty", "", 0},
		{"non-string", float64(3), 0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := gradeQuestion(q, c.answer); got != c.want {
				t.Errorf("gradeQuestion(%#v): got %v want %v", c.answer, got, c.want)
			}
		})
	}
}

// --- computeScore edge cases not covered elsewhere ---

func TestComputeScore_SkipsIneligibleQuestions(t *testing.T) {
	questions := []Question{
		{ID: "section", Type: TypeShortAnswer, IsSection: true, Points: 5, CorrectAnswers: []string{"x"}},
		{ID: "nongrade", Type: TypeLinearScale, Points: 5, CorrectAnswers: []string{"5"}},
		{ID: "zeropts", Type: TypeShortAnswer, Points: 0, CorrectAnswers: []string{"x"}},
		{ID: "nokey", Type: TypeShortAnswer, Points: 5},
		{ID: "good", Type: TypeShortAnswer, Points: 3, CorrectAnswers: []string{"yes"}},
	}
	answers := map[string]any{
		"section":  "x",
		"nongrade": "5",
		"zeropts":  "x",
		"nokey":    "anything",
		"good":     "yes",
	}
	// Only "good" contributes its 3 points; all others are ineligible.
	if got := computeScore(questions, answers); got != 3 {
		t.Errorf("computeScore: got %v want 3", got)
	}
}

func TestComputeScore_MissingAnswerKey(t *testing.T) {
	questions := []Question{
		{ID: "q1", Type: TypeShortAnswer, Points: 5, CorrectAnswers: []string{"a"}},
	}
	// Respondent did not answer q1 at all -> no points.
	if got := computeScore(questions, map[string]any{}); got != 0 {
		t.Errorf("computeScore missing answer: got %v want 0", got)
	}
}

func TestComputeMaxScore_IgnoresNonGradableAndSections(t *testing.T) {
	questions := []Question{
		{ID: "s", Type: TypeShortAnswer, IsSection: true, Points: 10},
		{ID: "scale", Type: TypeLinearScale, Points: 10}, // not gradable
		{ID: "para", Type: TypeParagraph, Points: 10},    // not gradable
		{ID: "mc", Type: TypeMultipleChoice, Points: 4},  // gradable
		{ID: "drop", Type: TypeDropdown, Points: 6},      // gradable
		{ID: "zero", Type: TypeShortAnswer, Points: 0},   // gradable but no points
	}
	if got := computeMaxScore(questions); got != 10 {
		t.Errorf("computeMaxScore: got %v want 10", got)
	}
}

// --- buildSummary: dropdown / date and missing-answer handling ---

func TestBuildSummary_DropdownDateAndMissing(t *testing.T) {
	form := Form{
		ID: "f1",
		Questions: []Question{
			{ID: "q1", Type: TypeDropdown, Title: "Pick"},
			{ID: "q2", Type: TypeDate, Title: "When"},
		},
	}
	responses := []Response{
		{Answers: map[string]any{"q1": "A", "q2": "2024-01-01"}},
		{Answers: map[string]any{"q1": "A"}}, // q2 missing -> skipped
		{Answers: map[string]any{"q1": "B", "q2": ""}},
	}
	sum := buildSummary(form, responses)
	if sum.ResponseCount != 3 {
		t.Fatalf("ResponseCount: got %d want 3", sum.ResponseCount)
	}
	q1 := sum.Questions[0]
	if q1.Counts["A"] != 2 || q1.Counts["B"] != 1 {
		t.Errorf("dropdown counts: %#v", q1.Counts)
	}
	q2 := sum.Questions[1]
	// One real date; missing + empty-string answers dropped.
	if len(q2.TextAnswers) != 1 || q2.TextAnswers[0] != "2024-01-01" {
		t.Errorf("date text answers: %#v", q2.TextAnswers)
	}
	// Text questions must not carry a Counts map.
	if q2.Counts != nil {
		t.Errorf("date question should have nil Counts: %#v", q2.Counts)
	}
	// Choice questions get an initialized Counts map.
	if q1.Counts == nil {
		t.Error("dropdown question should have non-nil Counts")
	}
}

func TestBuildSummary_NoResponses(t *testing.T) {
	form := Form{
		ID: "f1",
		Questions: []Question{
			{ID: "q1", Type: TypeMultipleChoice, Title: "MC"},
			{ID: "s1", Type: TypeShortAnswer, IsSection: true, Title: "Sec"},
		},
	}
	sum := buildSummary(form, nil)
	if sum.ResponseCount != 0 {
		t.Errorf("ResponseCount: got %d want 0", sum.ResponseCount)
	}
	// Section excluded, one question summarized.
	if len(sum.Questions) != 1 {
		t.Fatalf("questions: got %d want 1", len(sum.Questions))
	}
	if sum.Questions[0].Counts == nil || len(sum.Questions[0].Counts) != 0 {
		t.Errorf("empty counts map expected: %#v", sum.Questions[0].Counts)
	}
}

// --- RPC auth-guard short-circuits (nil repo: must return before repo access) ---

func noAuthCtx() context.Context { return context.Background() }

// userOnlyCtx has a user but no org -> exercises the "missing org context" path.
func userOnlyCtx() context.Context {
	return auth.WithUser(context.Background(), users.User{ID: "u1", OrgID: "o1", Email: "u@test.me"})
}

func orgOnlyCtx() context.Context {
	return auth.WithOrg(context.Background(), orgs.Org{ID: "o1", Slug: "default"})
}

func TestRPCs_Unauthenticated(t *testing.T) {
	svc := NewService(nil) // nil repo: guards must short-circuit before use
	ctx := noAuthCtx()

	cases := []struct {
		name string
		call func() error
	}{
		{"ListForms", func() error { _, e := svc.ListForms(ctx, &grownv1.ListFormsRequest{}); return e }},
		{"CreateForm", func() error { _, e := svc.CreateForm(ctx, &grownv1.CreateFormRequest{}); return e }},
		{"GetForm", func() error { _, e := svc.GetForm(ctx, &grownv1.GetFormRequest{Id: "x"}); return e }},
		{"UpdateForm", func() error { _, e := svc.UpdateForm(ctx, &grownv1.UpdateFormRequest{Id: "x"}); return e }},
		{"TrashForm", func() error { _, e := svc.TrashForm(ctx, &grownv1.TrashFormRequest{Id: "x"}); return e }},
		{"SubmitFormResponse", func() error {
			_, e := svc.SubmitFormResponse(ctx, &grownv1.SubmitFormResponseRequest{FormId: "x"})
			return e
		}},
		{"ListFormResponses", func() error {
			_, e := svc.ListFormResponses(ctx, &grownv1.ListFormResponsesRequest{FormId: "x"})
			return e
		}},
		{"GetFormResponseSummary", func() error {
			_, e := svc.GetFormResponseSummary(ctx, &grownv1.GetFormResponseSummaryRequest{FormId: "x"})
			return e
		}},
		{"DeleteFormResponses", func() error {
			_, e := svc.DeleteFormResponses(ctx, &grownv1.DeleteFormResponsesRequest{FormId: "x"})
			return e
		}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := c.call()
			if status.Code(err) != codes.Unauthenticated {
				t.Errorf("%s without session: got %v want Unauthenticated", c.name, err)
			}
		})
	}
}

func TestRPCs_MissingOrgContext(t *testing.T) {
	svc := NewService(nil)
	ctx := userOnlyCtx() // user present, no org -> Internal "missing org context"

	cases := []struct {
		name string
		call func() error
	}{
		{"ListForms", func() error { _, e := svc.ListForms(ctx, &grownv1.ListFormsRequest{}); return e }},
		{"CreateForm", func() error { _, e := svc.CreateForm(ctx, &grownv1.CreateFormRequest{}); return e }},
		{"GetForm", func() error { _, e := svc.GetForm(ctx, &grownv1.GetFormRequest{Id: "x"}); return e }},
		{"UpdateForm", func() error { _, e := svc.UpdateForm(ctx, &grownv1.UpdateFormRequest{Id: "x"}); return e }},
		{"TrashForm", func() error { _, e := svc.TrashForm(ctx, &grownv1.TrashFormRequest{Id: "x"}); return e }},
		{"SubmitFormResponse", func() error {
			_, e := svc.SubmitFormResponse(ctx, &grownv1.SubmitFormResponseRequest{FormId: "x"})
			return e
		}},
		{"ListFormResponses", func() error {
			_, e := svc.ListFormResponses(ctx, &grownv1.ListFormResponsesRequest{FormId: "x"})
			return e
		}},
		{"GetFormResponseSummary", func() error {
			_, e := svc.GetFormResponseSummary(ctx, &grownv1.GetFormResponseSummaryRequest{FormId: "x"})
			return e
		}},
		{"DeleteFormResponses", func() error {
			_, e := svc.DeleteFormResponses(ctx, &grownv1.DeleteFormResponsesRequest{FormId: "x"})
			return e
		}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := c.call()
			if status.Code(err) != codes.Internal {
				t.Errorf("%s without org: got %v want Internal", c.name, err)
			}
		})
	}
}

func TestCallerOrg(t *testing.T) {
	// no user
	if _, err := callerOrg(noAuthCtx()); status.Code(err) != codes.Unauthenticated {
		t.Errorf("callerOrg no user: got %v want Unauthenticated", err)
	}
	// user but no org
	if _, err := callerOrg(userOnlyCtx()); status.Code(err) != codes.Internal {
		t.Errorf("callerOrg no org: got %v want Internal", err)
	}
	// org present but no user still fails on user check first
	if _, err := callerOrg(orgOnlyCtx()); status.Code(err) != codes.Unauthenticated {
		t.Errorf("callerOrg org-only: got %v want Unauthenticated", err)
	}
	// fully authed
	full := auth.WithOrg(userOnlyCtx(), orgs.Org{ID: "o-xyz", Slug: "default"})
	got, err := callerOrg(full)
	if err != nil || got != "o-xyz" {
		t.Errorf("callerOrg authed: got %q err=%v want o-xyz", got, err)
	}
}
