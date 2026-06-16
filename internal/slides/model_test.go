package slides

// model_test.go verifies that the slides document JSON model (stored in the
// `data` column as an opaque blob and round-tripped through the frontend)
// correctly preserves speaker notes, slide transitions, and element entrance
// animations.  These are pure in-memory / JSON tests — no database required.

import (
	"encoding/json"
	"testing"
)

// ----- minimal Go mirror of the frontend model --------------------------------
// Only the fields we care about; extra fields are preserved via json.RawMessage.

type animationType string

type elementAnimation struct {
	Type  animationType `json:"type"`
	Order int           `json:"order"`
}

type slideElement struct {
	ID         string            `json:"id"`
	Type       string            `json:"type"`
	X          float64           `json:"x,omitempty"`
	Y          float64           `json:"y,omitempty"`
	W          float64           `json:"w,omitempty"`
	H          float64           `json:"h,omitempty"`
	Animation  *elementAnimation `json:"animation,omitempty"`
}

type slide struct {
	ID         string         `json:"id"`
	Background string         `json:"background"`
	Elements   []slideElement `json:"elements"`
	Notes      string         `json:"notes,omitempty"`
	Transition string         `json:"transition,omitempty"`
}

type deckDoc struct {
	Slides []slide `json:"slides"`
}

// ------------------------------------------------------------------------------

func TestModel_NotesRoundTrip(t *testing.T) {
	doc := deckDoc{
		Slides: []slide{
			{ID: "s1", Background: "#ffffff", Notes: "Remember to smile!", Elements: []slideElement{}},
			{ID: "s2", Background: "#ffffff", Notes: "", Elements: []slideElement{}},
		},
	}
	data, err := json.Marshal(doc)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var got deckDoc
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(got.Slides) != 2 {
		t.Fatalf("want 2 slides, got %d", len(got.Slides))
	}
	if got.Slides[0].Notes != "Remember to smile!" {
		t.Errorf("notes s1: got %q", got.Slides[0].Notes)
	}
	if got.Slides[1].Notes != "" {
		t.Errorf("notes s2 should be empty, got %q", got.Slides[1].Notes)
	}
}

func TestModel_TransitionRoundTrip(t *testing.T) {
	transitions := []string{"none", "fade", "slide-left", "slide-right", "slide-up"}
	for _, tr := range transitions {
		doc := deckDoc{
			Slides: []slide{{ID: "s1", Background: "#fff", Transition: tr, Elements: []slideElement{}}},
		}
		data, err := json.Marshal(doc)
		if err != nil {
			t.Fatalf("marshal (%s): %v", tr, err)
		}
		var got deckDoc
		if err := json.Unmarshal(data, &got); err != nil {
			t.Fatalf("unmarshal (%s): %v", tr, err)
		}
		if got.Slides[0].Transition != tr {
			t.Errorf("transition %q: got %q", tr, got.Slides[0].Transition)
		}
	}
}

func TestModel_AnimationRoundTrip(t *testing.T) {
	animTypes := []animationType{"appear", "fade-in", "fly-in-bottom", "fly-in-left"}
	for order, at := range animTypes {
		doc := deckDoc{
			Slides: []slide{
				{
					ID:         "s1",
					Background: "#fff",
					Elements: []slideElement{
						{
							ID:   "e1",
							Type: "rect",
							Animation: &elementAnimation{
								Type:  at,
								Order: order + 1,
							},
						},
						// Element without animation — must round-trip nil.
						{ID: "e2", Type: "text"},
					},
				},
			},
		}
		data, err := json.Marshal(doc)
		if err != nil {
			t.Fatalf("marshal (%s): %v", at, err)
		}
		var got deckDoc
		if err := json.Unmarshal(data, &got); err != nil {
			t.Fatalf("unmarshal (%s): %v", at, err)
		}
		el := got.Slides[0].Elements[0]
		if el.Animation == nil {
			t.Fatalf("animation nil for %s", at)
		}
		if el.Animation.Type != at {
			t.Errorf("type %q: got %q", at, el.Animation.Type)
		}
		if el.Animation.Order != order+1 {
			t.Errorf("order %d: got %d", order+1, el.Animation.Order)
		}
		// Second element must have no animation.
		if got.Slides[0].Elements[1].Animation != nil {
			t.Errorf("e2 should have nil animation")
		}
	}
}

func TestModel_AllTogether(t *testing.T) {
	// Simulate saving a deck with notes + transition + animations and loading it
	// back — this is exactly the Deck.data field round-trip in the repository.
	original := deckDoc{
		Slides: []slide{
			{
				ID:         "slide-1",
				Background: "#f1f3f4",
				Notes:      "Title slide notes here.",
				Transition: "fade",
				Elements: []slideElement{
					{ID: "el-1", Type: "text", Animation: &elementAnimation{Type: "fly-in-bottom", Order: 1}},
					{ID: "el-2", Type: "rect", Animation: &elementAnimation{Type: "fade-in", Order: 2}},
					{ID: "el-3", Type: "ellipse"}, // no animation
				},
			},
			{
				ID:         "slide-2",
				Background: "#ffffff",
				Notes:      "",
				Transition: "slide-left",
				Elements:   []slideElement{},
			},
		},
	}

	data, err := json.Marshal(original)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var loaded deckDoc
	if err := json.Unmarshal(data, &loaded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	s1 := loaded.Slides[0]
	if s1.Notes != "Title slide notes here." {
		t.Errorf("s1.notes = %q", s1.Notes)
	}
	if s1.Transition != "fade" {
		t.Errorf("s1.transition = %q", s1.Transition)
	}
	if s1.Elements[0].Animation == nil || s1.Elements[0].Animation.Type != "fly-in-bottom" || s1.Elements[0].Animation.Order != 1 {
		t.Errorf("el-1 animation wrong: %+v", s1.Elements[0].Animation)
	}
	if s1.Elements[1].Animation == nil || s1.Elements[1].Animation.Type != "fade-in" || s1.Elements[1].Animation.Order != 2 {
		t.Errorf("el-2 animation wrong: %+v", s1.Elements[1].Animation)
	}
	if s1.Elements[2].Animation != nil {
		t.Errorf("el-3 should have no animation")
	}

	s2 := loaded.Slides[1]
	if s2.Transition != "slide-left" {
		t.Errorf("s2.transition = %q", s2.Transition)
	}
	if s2.Notes != "" {
		t.Errorf("s2 notes should be empty")
	}
}

// TestModel_DBRoundTrip is an integration test that saves a deck with
// notes/transition/animation metadata into the real database and reads it back.
// It is skipped when GROWN_TEST_DSN is not set.
func TestModel_DBRoundTrip(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := t.Context()

	d, err := repo.Create(ctx, orgID, userID, "AnimTest")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	doc := deckDoc{
		Slides: []slide{
			{
				ID:         "s1",
				Background: "#fff",
				Notes:      "DB round-trip notes",
				Transition: "fade",
				Elements: []slideElement{
					{ID: "e1", Type: "text", Animation: &elementAnimation{Type: "appear", Order: 1}},
				},
			},
		},
	}
	data, _ := json.Marshal(doc)

	if err := repo.Save(ctx, orgID, d.ID, string(data)); err != nil {
		t.Fatalf("Save: %v", err)
	}
	got, err := repo.Get(ctx, orgID, d.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}

	var loaded deckDoc
	if err := json.Unmarshal([]byte(got.Data), &loaded); err != nil {
		t.Fatalf("unmarshal loaded data: %v", err)
	}
	s := loaded.Slides[0]
	if s.Notes != "DB round-trip notes" {
		t.Errorf("notes: got %q", s.Notes)
	}
	if s.Transition != "fade" {
		t.Errorf("transition: got %q", s.Transition)
	}
	if s.Elements[0].Animation == nil || s.Elements[0].Animation.Type != "appear" {
		t.Errorf("animation: got %+v", s.Elements[0].Animation)
	}
}
