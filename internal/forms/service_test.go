package forms

import (
	"context"
	"testing"
)

func TestBuildSummary_AggregatesAllTypes(t *testing.T) {
	form := Form{
		ID: "f1",
		Questions: []Question{
			{ID: "q1", Type: TypeShortAnswer, Title: "Name"},
			{ID: "q2", Type: TypeMultipleChoice, Title: "Color", Options: []string{"Red", "Blue"}},
			{ID: "q3", Type: TypeCheckboxes, Title: "Pets", Options: []string{"Cat", "Dog", "Fish"}},
			{ID: "q4", Type: TypeLinearScale, Title: "Rating"},
		},
	}
	responses := []Response{
		{Answers: map[string]any{"q1": "Ada", "q2": "Red", "q3": []any{"Cat", "Dog"}, "q4": "5"}},
		{Answers: map[string]any{"q1": "Alan", "q2": "Red", "q3": []any{"Cat"}, "q4": "3"}},
		{Answers: map[string]any{"q1": "", "q2": "Blue", "q3": []any{}, "q4": "5"}},
	}

	sum := buildSummary(form, responses)
	if sum.ResponseCount != 3 {
		t.Fatalf("ResponseCount: got %d want 3", sum.ResponseCount)
	}
	if len(sum.Questions) != 4 {
		t.Fatalf("questions: got %d want 4", len(sum.Questions))
	}

	// q1 text answers: empty strings are dropped.
	q1 := sum.Questions[0]
	if len(q1.TextAnswers) != 2 {
		t.Errorf("q1 text answers: got %v want 2 non-empty", q1.TextAnswers)
	}

	// q2 multiple choice counts.
	q2 := sum.Questions[1]
	if q2.Counts["Red"] != 2 || q2.Counts["Blue"] != 1 {
		t.Errorf("q2 counts: %#v", q2.Counts)
	}

	// q3 checkbox counts (each selected option tallied).
	q3 := sum.Questions[2]
	if q3.Counts["Cat"] != 2 || q3.Counts["Dog"] != 1 {
		t.Errorf("q3 counts: %#v", q3.Counts)
	}
	if _, ok := q3.Counts["Fish"]; ok {
		t.Errorf("q3 should not count unselected Fish: %#v", q3.Counts)
	}

	// q4 linear scale counts.
	q4 := sum.Questions[3]
	if q4.Counts["5"] != 2 || q4.Counts["3"] != 1 {
		t.Errorf("q4 counts: %#v", q4.Counts)
	}
}

func TestParseAnswers(t *testing.T) {
	m, err := parseAnswers(`{"q1":"hi","q2":["a","b"]}`)
	if err != nil {
		t.Fatalf("parseAnswers: %v", err)
	}
	if m["q1"] != "hi" {
		t.Errorf("q1: %#v", m["q1"])
	}
	if got, ok := m["q2"].([]any); !ok || len(got) != 2 {
		t.Errorf("q2: %#v", m["q2"])
	}

	empty, err := parseAnswers("")
	if err != nil || len(empty) != 0 {
		t.Errorf("empty parse: %v %#v", err, empty)
	}

	if _, err := parseAnswers("{not json"); err == nil {
		t.Error("expected error for invalid json")
	}
}

func TestAnswered(t *testing.T) {
	cases := []struct {
		v    any
		want bool
	}{
		{nil, false},
		{"", false},
		{"x", true},
		{[]any{}, false},
		{[]any{"a"}, true},
	}
	for _, c := range cases {
		if got := answered(c.v); got != c.want {
			t.Errorf("answered(%#v): got %v want %v", c.v, got, c.want)
		}
	}
}

// --- Quiz scoring tests ---

func quizForm() Form {
	return Form{
		ID:       "f1",
		Settings: Settings{IsQuiz: true},
		Questions: []Question{
			{ID: "q1", Type: TypeMultipleChoice, Title: "Capital", Options: []string{"Paris", "London", "Berlin"}, Points: 2, CorrectAnswers: []string{"Paris"}},
			{ID: "q2", Type: TypeShortAnswer, Title: "Spell cat", Points: 1, CorrectAnswers: []string{"cat"}},
			{ID: "q3", Type: TypeCheckboxes, Title: "Vowels", Options: []string{"a", "b", "e", "x"}, Points: 3, CorrectAnswers: []string{"a", "e"}},
			{ID: "q4", Type: TypeMultipleChoice, Title: "No key", Options: []string{"X", "Y"}, Points: 1}, // no correct_answers
			{ID: "s1", Type: TypeShortAnswer, IsSection: true, Title: "Section break"},                    // section: not graded
		},
	}
}

func TestComputeMaxScore(t *testing.T) {
	f := quizForm()
	got := computeMaxScore(f.Questions)
	// q1=2, q2=1, q3=3, q4 has no correct answers so it doesn't add, s1 is section
	// maxScore counts points for questions WITH correct answers: q1(2)+q2(1)+q3(3)=6
	// q4 has points but no CorrectAnswers, so isGradable passes (MC is gradable) but
	// computeMaxScore only counts points > 0 on gradable types; q4 has Points=1 + no key:
	// actually computeMaxScore counts ALL gradable+points questions, q4=1 included.
	// Expected: 2+1+3+1 = 7
	if got != 7 {
		t.Errorf("computeMaxScore: got %v want 7", got)
	}
}

func TestComputeScore_AllCorrect(t *testing.T) {
	f := quizForm()
	answers := map[string]any{
		"q1": "Paris",
		"q2": "cat",
		"q3": []any{"a", "e"},
	}
	got := computeScore(f.Questions, answers)
	// q1=2, q2=1, q3=3 = 6
	if got != 6 {
		t.Errorf("AllCorrect: got %v want 6", got)
	}
}

func TestComputeScore_AllIncorrect(t *testing.T) {
	f := quizForm()
	answers := map[string]any{
		"q1": "London",
		"q2": "dog",
		"q3": []any{"b", "x"},
	}
	got := computeScore(f.Questions, answers)
	if got != 0 {
		t.Errorf("AllIncorrect: got %v want 0", got)
	}
}

func TestComputeScore_PartialCheckboxes(t *testing.T) {
	f := quizForm()
	// Checkboxes: selecting only "a" (not the full correct set "a","e") = 0 pts.
	answers := map[string]any{
		"q1": "Paris",
		"q2": "cat",
		"q3": []any{"a"},
	}
	got := computeScore(f.Questions, answers)
	// q1=2, q2=1, q3=0 = 3
	if got != 3 {
		t.Errorf("PartialCheckboxes: got %v want 3", got)
	}
}

func TestComputeScore_CaseInsensitive(t *testing.T) {
	f := quizForm()
	answers := map[string]any{
		"q2": "CAT",
	}
	got := computeScore(f.Questions, answers)
	if got != 1 {
		t.Errorf("CaseInsensitive: got %v want 1", got)
	}
}

func TestComputeScore_TableDriven(t *testing.T) {
	cases := []struct {
		name    string
		answers map[string]any
		want    float64
	}{
		{"empty", map[string]any{}, 0},
		{"only q1 correct", map[string]any{"q1": "Paris"}, 2},
		{"q1+q2 correct", map[string]any{"q1": "Paris", "q2": "cat"}, 3},
		{"all correct", map[string]any{"q1": "Paris", "q2": "cat", "q3": []any{"a", "e"}}, 6},
		{"q1 wrong q2 correct", map[string]any{"q1": "Berlin", "q2": "CAT"}, 1},
	}
	f := quizForm()
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := computeScore(f.Questions, c.answers)
			if got != c.want {
				t.Errorf("got %v want %v", got, c.want)
			}
		})
	}
}

// --- Section branching tests ---

func TestResolveBranch(t *testing.T) {
	q := Question{
		ID:      "q1",
		Type:    TypeMultipleChoice,
		Options: []string{"Yes", "No"},
		GoToSection: map[string]string{
			"Yes": "section-2",
			"No":  SubmitTarget,
		},
	}

	cases := []struct {
		answer string
		want   string
	}{
		{"Yes", "section-2"},
		{"No", SubmitTarget},
		{"Maybe", ""}, // not configured
		{"", ""},
	}
	for _, c := range cases {
		got := ResolveBranch(q, c.answer)
		if got != c.want {
			t.Errorf("ResolveBranch(%q): got %q want %q", c.answer, got, c.want)
		}
	}
}

func TestResolveBranch_NoBranching(t *testing.T) {
	q := Question{ID: "q1", Type: TypeMultipleChoice, Options: []string{"A", "B"}}
	if got := ResolveBranch(q, "A"); got != "" {
		t.Errorf("no branching: got %q want empty", got)
	}
}

// --- New question types in buildSummary ---

func TestBuildSummary_NewTypes(t *testing.T) {
	form := Form{
		ID: "f1",
		Questions: []Question{
			{ID: "q1", Type: TypeTime, Title: "What time?"},
			{ID: "q2", Type: TypeFileUpload, Title: "Upload file"},
			{ID: "s1", Type: TypeShortAnswer, IsSection: true, Title: "Section"},
		},
	}
	responses := []Response{
		{Answers: map[string]any{"q1": "09:30", "q2": "blob://key1"}},
		{Answers: map[string]any{"q1": "14:00", "q2": "blob://key2"}},
	}
	sum := buildSummary(form, responses)
	// Section dividers should not appear in summary.
	if len(sum.Questions) != 2 {
		t.Fatalf("questions in summary: got %d want 2", len(sum.Questions))
	}
	q1 := sum.Questions[0]
	if len(q1.TextAnswers) != 2 {
		t.Errorf("time answers: got %v want 2", q1.TextAnswers)
	}
	q2 := sum.Questions[1]
	if len(q2.TextAnswers) != 2 {
		t.Errorf("file_upload answers: got %v want 2", q2.TextAnswers)
	}
}

// --- Persistence tests (GROWN_TEST_DSN-guarded) ---

func TestRepository_Quiz_ScorePersistedAndRetrieved(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	f, err := repo.Create(ctx, orgID, userID, Fields{
		Title:     "Quiz",
		Questions: quizQuestions(),
		Settings:  Settings{IsQuiz: true},
		Accepting: true,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	score := 5.0
	resp, err := repo.SubmitResponse(ctx, orgID, f.ID, userID, "quiz@test.com", map[string]any{"q1": "Paris"}, &score)
	if err != nil {
		t.Fatalf("SubmitResponse: %v", err)
	}
	if resp.Score == nil || *resp.Score != 5.0 {
		t.Errorf("score: got %v want 5.0", resp.Score)
	}

	list, err := repo.ListResponses(ctx, orgID, f.ID)
	if err != nil {
		t.Fatalf("ListResponses: %v", err)
	}
	if len(list) != 1 || list[0].Score == nil || *list[0].Score != 5.0 {
		t.Errorf("listed score: %v", list)
	}
}

func TestRepository_NewTypes_Persistence(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	qs := []Question{
		{ID: "t1", Type: TypeTime, Title: "Time"},
		{ID: "f1", Type: TypeFileUpload, Title: "File"},
		{ID: "s1", Type: TypeShortAnswer, IsSection: true, Title: "Section"},
	}
	form, err := repo.Create(ctx, orgID, userID, Fields{Title: "NewTypes", Questions: qs, Accepting: true})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	// Verify round-trip of new question types in the JSONB.
	got, err := repo.Get(ctx, orgID, form.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	typeSet := make(map[string]bool)
	for _, q := range got.Questions {
		typeSet[q.Type] = true
	}
	if !typeSet[TypeTime] {
		t.Error("TypeTime not round-tripped")
	}
	if !typeSet[TypeFileUpload] {
		t.Error("TypeFileUpload not round-tripped")
	}
	foundSection := false
	for _, q := range got.Questions {
		if q.IsSection {
			foundSection = true
		}
	}
	if !foundSection {
		t.Error("IsSection not round-tripped")
	}

	// Submit response with time + file_upload answers.
	_, err = repo.SubmitResponse(ctx, orgID, form.ID, userID, "a@b.com", map[string]any{
		"t1": "14:30",
		"f1": "blob://abc123",
	}, nil)
	if err != nil {
		t.Fatalf("SubmitResponse with new types: %v", err)
	}
}

func TestRepository_BranchingQuestions_Persistence(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	qs := []Question{
		{
			ID:      "q1",
			Type:    TypeMultipleChoice,
			Title:   "Branch question",
			Options: []string{"Yes", "No"},
			GoToSection: map[string]string{
				"Yes": "section-2",
				"No":  SubmitTarget,
			},
		},
		{ID: "s2", Type: TypeShortAnswer, IsSection: true, Title: "Section 2"},
	}
	f, err := repo.Create(ctx, orgID, userID, Fields{Title: "BranchForm", Questions: qs, Accepting: true})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	got, err := repo.Get(ctx, orgID, f.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if len(got.Questions) == 0 {
		t.Fatal("no questions returned")
	}
	q := got.Questions[0]
	if q.GoToSection["Yes"] != "section-2" {
		t.Errorf("GoToSection[Yes]: got %q want section-2", q.GoToSection["Yes"])
	}
	if q.GoToSection["No"] != SubmitTarget {
		t.Errorf("GoToSection[No]: got %q want %s", q.GoToSection["No"], SubmitTarget)
	}
}

func quizQuestions() []Question {
	return []Question{
		{ID: "q1", Type: TypeMultipleChoice, Title: "Capital", Options: []string{"Paris", "London"}, Points: 5, CorrectAnswers: []string{"Paris"}},
	}
}
