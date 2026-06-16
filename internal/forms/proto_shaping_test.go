package forms

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
)

// --- question proto round-trip ---

func TestQuestionProtoRoundTrip(t *testing.T) {
	q := Question{
		ID:             "q1",
		Type:           TypeMultipleChoice,
		Title:          "Capital?",
		Description:    "pick one",
		Required:       true,
		Options:        []string{"Paris", "London"},
		ScaleMin:       1,
		ScaleMax:       5,
		ScaleMinLabel:  "low",
		ScaleMaxLabel:  "high",
		Points:         3,
		CorrectAnswers: []string{"Paris"},
		GoToSection:    map[string]string{"Paris": "s2", "London": SubmitTarget},
		IsSection:      false,
	}

	got := questionFromProto(questionToProto(q))
	if !reflect.DeepEqual(got, q) {
		t.Errorf("round-trip mismatch:\n got %+v\nwant %+v", got, q)
	}
}

func TestQuestionToProto_FieldMapping(t *testing.T) {
	q := Question{
		ID:            "q9",
		Type:          TypeLinearScale,
		Title:         "Rate",
		ScaleMin:      0,
		ScaleMax:      10,
		ScaleMinLabel: "bad",
		ScaleMaxLabel: "good",
		IsSection:     true,
	}
	p := questionToProto(q)
	if p.GetId() != "q9" || p.GetType() != TypeLinearScale || p.GetTitle() != "Rate" {
		t.Errorf("basic fields: %+v", p)
	}
	if p.GetScaleMin() != 0 || p.GetScaleMax() != 10 {
		t.Errorf("scale: min=%d max=%d", p.GetScaleMin(), p.GetScaleMax())
	}
	if p.GetScaleMinLabel() != "bad" || p.GetScaleMaxLabel() != "good" {
		t.Errorf("scale labels: %+v", p)
	}
	if !p.GetIsSection() {
		t.Error("IsSection not propagated")
	}
}

func TestQuestionsFromProto(t *testing.T) {
	in := []*grownv1.FormQuestion{
		{Id: "a", Type: TypeShortAnswer, Title: "A"},
		{Id: "b", Type: TypeParagraph, Title: "B"},
	}
	got := questionsFromProto(in)
	if len(got) != 2 {
		t.Fatalf("len: got %d want 2", len(got))
	}
	if got[0].ID != "a" || got[1].ID != "b" {
		t.Errorf("ids: %+v", got)
	}

	if empty := questionsFromProto(nil); len(empty) != 0 {
		t.Errorf("nil input: got %d want 0", len(empty))
	}
}

// --- settings proto ---

func TestSettingsProtoRoundTrip(t *testing.T) {
	s := Settings{
		CollectEmail:        true,
		LimitOneResponse:    true,
		ShowProgressBar:     true,
		ShuffleQuestions:    true,
		ConfirmationMessage: "thanks!",
		IsQuiz:              true,
	}
	got := settingsFromProto(settingsToProto(s))
	if !reflect.DeepEqual(got, s) {
		t.Errorf("settings round-trip:\n got %+v\nwant %+v", got, s)
	}
}

func TestSettingsFromProto_Nil(t *testing.T) {
	got := settingsFromProto(nil)
	if got != (Settings{}) {
		t.Errorf("nil settings: got %+v want zero value", got)
	}
}

func TestSettingsToProto_Fields(t *testing.T) {
	p := settingsToProto(Settings{CollectEmail: true, IsQuiz: true, ConfirmationMessage: "ok"})
	if !p.GetCollectEmail() || !p.GetIsQuiz() || p.GetConfirmationMessage() != "ok" {
		t.Errorf("settings proto: %+v", p)
	}
	if p.GetLimitOneResponse() || p.GetShowProgressBar() || p.GetShuffleQuestions() {
		t.Errorf("unexpected true flags: %+v", p)
	}
}

// --- form proto ---

func TestFormToProto(t *testing.T) {
	created := time.Date(2024, 1, 2, 3, 4, 5, 0, time.UTC)
	updated := time.Date(2024, 6, 7, 8, 9, 10, 0, time.UTC)
	f := Form{
		ID:          "f1",
		OrgID:       "o1",
		OwnerID:     "u1",
		Title:       "Survey",
		Description: "desc",
		Questions: []Question{
			{ID: "q1", Type: TypeShortAnswer, Title: "Name"},
			{ID: "q2", Type: TypeMultipleChoice, Title: "Color"},
		},
		Settings:      Settings{CollectEmail: true},
		Accepting:     true,
		ResponseCount: 7,
		CreatedAt:     created,
		UpdatedAt:     updated,
	}
	p := formToProto(f)
	if p.GetId() != "f1" || p.GetOrgId() != "o1" || p.GetOwnerId() != "u1" {
		t.Errorf("ids: %+v", p)
	}
	if p.GetTitle() != "Survey" || p.GetDescription() != "desc" {
		t.Errorf("title/desc: %+v", p)
	}
	if len(p.GetQuestions()) != 2 {
		t.Errorf("questions: got %d want 2", len(p.GetQuestions()))
	}
	if !p.GetAccepting() || p.GetResponseCount() != 7 {
		t.Errorf("accepting/count: %+v", p)
	}
	if !p.GetSettings().GetCollectEmail() {
		t.Error("settings not propagated")
	}
	if p.GetCreatedAt() != "2024-01-02T03:04:05Z" {
		t.Errorf("created_at: got %q", p.GetCreatedAt())
	}
	if p.GetUpdatedAt() != "2024-06-07T08:09:10Z" {
		t.Errorf("updated_at: got %q", p.GetUpdatedAt())
	}
}

func TestFormToProto_LocalTimeNormalizedToUTC(t *testing.T) {
	// A non-UTC time must be formatted as UTC (Z suffix).
	loc := time.FixedZone("UTC+2", 2*3600)
	f := Form{
		CreatedAt: time.Date(2024, 1, 1, 12, 0, 0, 0, loc),
		UpdatedAt: time.Date(2024, 1, 1, 12, 0, 0, 0, loc),
	}
	p := formToProto(f)
	if p.GetCreatedAt() != "2024-01-01T10:00:00Z" {
		t.Errorf("created_at not UTC-normalized: got %q", p.GetCreatedAt())
	}
}

func TestFormToProto_EmptyQuestions(t *testing.T) {
	p := formToProto(Form{ID: "f", CreatedAt: time.Now(), UpdatedAt: time.Now()})
	if p.GetQuestions() == nil {
		t.Error("questions slice should be non-nil")
	}
	if len(p.GetQuestions()) != 0 {
		t.Errorf("questions: got %d want 0", len(p.GetQuestions()))
	}
}

// --- response proto ---

func TestResponseToProto_NoScore(t *testing.T) {
	created := time.Date(2024, 5, 6, 7, 8, 9, 0, time.UTC)
	r := Response{
		ID:              "r1",
		FormID:          "f1",
		RespondentEmail: "a@b.com",
		Answers:         map[string]any{"q1": "hi", "q2": []any{"x", "y"}},
		CreatedAt:       created,
	}
	p := responseToProto(r)
	if p.GetId() != "r1" || p.GetFormId() != "f1" || p.GetRespondentEmail() != "a@b.com" {
		t.Errorf("fields: %+v", p)
	}
	if p.GetCreatedAt() != "2024-05-06T07:08:09Z" {
		t.Errorf("created_at: got %q", p.GetCreatedAt())
	}
	// Score/MaxScore default to 0 when nil.
	if p.GetScore() != 0 || p.GetMaxScore() != 0 {
		t.Errorf("score/maxscore should default 0: %+v", p)
	}
	// answers_json must be valid JSON containing both answers.
	var decoded map[string]any
	if err := json.Unmarshal([]byte(p.GetAnswersJson()), &decoded); err != nil {
		t.Fatalf("answers_json invalid: %v (%q)", err, p.GetAnswersJson())
	}
	if decoded["q1"] != "hi" {
		t.Errorf("q1 answer: %#v", decoded["q1"])
	}
}

func TestResponseToProto_WithScore(t *testing.T) {
	score := 4.5
	max := 10.0
	r := Response{
		ID:        "r1",
		FormID:    "f1",
		Answers:   map[string]any{},
		Score:     &score,
		MaxScore:  &max,
		CreatedAt: time.Now(),
	}
	p := responseToProto(r)
	if p.GetScore() != 4.5 {
		t.Errorf("score: got %v want 4.5", p.GetScore())
	}
	if p.GetMaxScore() != 10.0 {
		t.Errorf("max_score: got %v want 10.0", p.GetMaxScore())
	}
}

func TestResponseToProto_NilAnswers(t *testing.T) {
	p := responseToProto(Response{ID: "r1", CreatedAt: time.Now()})
	// nil map marshals to "null"; verify it is at least set and parseable.
	if p.GetAnswersJson() == "" {
		t.Error("answers_json should not be empty")
	}
}
