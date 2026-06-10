// Package forms is the data-access + service layer for Forms (Google
// Forms–style surveys & quizzes). A form is a title/description plus an
// ordered list of questions stored as JSON; responses are individual
// submissions stored as a JSON answers map.
package forms

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned when no form/response matches the given id (within org).
var ErrNotFound = errors.New("form not found")

// Question types supported by the editor / fill view.
const (
	TypeShortAnswer    = "short_answer"
	TypeParagraph      = "paragraph"
	TypeMultipleChoice = "multiple_choice"
	TypeCheckboxes     = "checkboxes"
	TypeDropdown       = "dropdown"
	TypeLinearScale    = "linear_scale"
	TypeDate           = "date"
	TypeTime           = "time"
	TypeFileUpload     = "file_upload"
)

// SubmitTarget is the special go_to_section value meaning "submit the form".
const SubmitTarget = "__submit__"

// Question is one question within a form. Stored as a JSON element of the
// form's `questions` array.
type Question struct {
	ID            string   `json:"id"`
	Type          string   `json:"type"`
	Title         string   `json:"title"`
	Description   string   `json:"description"`
	Required      bool     `json:"required"`
	Options       []string `json:"options,omitempty"`
	ScaleMin      int32    `json:"scale_min,omitempty"`
	ScaleMax      int32    `json:"scale_max,omitempty"`
	ScaleMinLabel string   `json:"scale_min_label,omitempty"`
	ScaleMaxLabel string   `json:"scale_max_label,omitempty"`
	// Quiz fields.
	Points         int32    `json:"points,omitempty"`
	CorrectAnswers []string `json:"correct_answers,omitempty"`
	// Section branching: maps option value -> target section id (or SubmitTarget).
	GoToSection map[string]string `json:"go_to_section,omitempty"`
	// IsSection: when true this is a section divider, not a real question.
	IsSection bool `json:"is_section,omitempty"`
}

// Settings holds per-form behaviour toggles.
type Settings struct {
	CollectEmail        bool   `json:"collect_email"`
	LimitOneResponse    bool   `json:"limit_one_response"`
	ShowProgressBar     bool   `json:"show_progress_bar"`
	ShuffleQuestions    bool   `json:"shuffle_questions"`
	ConfirmationMessage string `json:"confirmation_message"`
	IsQuiz              bool   `json:"is_quiz"`
}

// Form is the in-memory representation of a grown.forms row.
type Form struct {
	ID            string
	OrgID         string
	OwnerID       string
	Title         string
	Description   string
	Questions     []Question
	Settings      Settings
	Accepting     bool
	ResponseCount int32
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

// Fields bundles the editable attributes of a form (used by Create/Update).
type Fields struct {
	Title       string
	Description string
	Questions   []Question
	Settings    Settings
	Accepting   bool
}

// Response is one respondent's submission.
type Response struct {
	ID              string
	FormID          string
	RespondentEmail string
	// Answers maps question id -> answer. A value is either a string (text,
	// choice, dropdown, scale, date, time) or a []string (checkboxes).
	// For file_upload questions the answer is a blob key string.
	Answers map[string]any
	// Score is nil for non-quiz forms; set on quiz submissions.
	Score     *float64
	MaxScore  *float64
	CreatedAt time.Time
}

// ResponseFile holds metadata for a file uploaded with a file_upload question.
type ResponseFile struct {
	ID          string
	ResponseID  string
	QuestionID  string
	OrgID       string
	BlobKey     string
	Filename    string
	ContentType string
	SizeBytes   int64
	CreatedAt   time.Time
}

// Repository reads and writes forms and their responses.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository constructs a Repository over the given pool.
func NewRepository(pool *pgxpool.Pool) *Repository { return &Repository{pool: pool} }

const formColumns = `f.id::text, f.org_id::text, f.owner_id::text, f.title, f.description,
	f.questions, f.settings, f.accepting, f.created_at, f.updated_at,
	(SELECT count(*) FROM grown.form_responses r WHERE r.form_id = f.id)`

func marshalQuestions(qs []Question) []byte {
	if qs == nil {
		qs = []Question{}
	}
	b, _ := json.Marshal(qs)
	return b
}

func marshalSettings(s Settings) []byte {
	b, _ := json.Marshal(s)
	return b
}

func scanForm(row pgx.Row) (Form, error) {
	var f Form
	var questions, settings []byte
	err := row.Scan(&f.ID, &f.OrgID, &f.OwnerID, &f.Title, &f.Description,
		&questions, &settings, &f.Accepting, &f.CreatedAt, &f.UpdatedAt, &f.ResponseCount)
	if err != nil {
		return Form{}, err
	}
	if len(questions) > 0 {
		_ = json.Unmarshal(questions, &f.Questions)
	}
	if len(settings) > 0 {
		_ = json.Unmarshal(settings, &f.Settings)
	}
	if f.Questions == nil {
		f.Questions = []Question{}
	}
	return f, nil
}

// Create inserts a new form.
func (r *Repository) Create(ctx context.Context, orgID, ownerID string, fl Fields) (Form, error) {
	// formColumns is aliased "f."; wrap the INSERT in a CTE so the alias applies.
	q := `WITH f AS (
		INSERT INTO grown.forms (org_id, owner_id, title, description, questions, settings, accepting)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		RETURNING *
	) SELECT ` + formColumns + ` FROM f`
	f, err := scanForm(r.pool.QueryRow(ctx, q, orgID, ownerID, fl.Title, fl.Description,
		marshalQuestions(fl.Questions), marshalSettings(fl.Settings), fl.Accepting))
	if err != nil {
		return Form{}, fmt.Errorf("forms.Create: %w", err)
	}
	return f, nil
}

// Get returns a form within orgID, or ErrNotFound.
func (r *Repository) Get(ctx context.Context, orgID, id string) (Form, error) {
	q := `SELECT ` + formColumns + ` FROM grown.forms f WHERE f.id=$1 AND f.org_id=$2 AND f.trashed_at IS NULL`
	f, err := scanForm(r.pool.QueryRow(ctx, q, id, orgID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Form{}, ErrNotFound
	}
	if err != nil {
		return Form{}, fmt.Errorf("forms.Get: %w", err)
	}
	return f, nil
}

// GetForFill returns a form by id regardless of org (used by the public fill
// view), as long as it is not trashed and is accepting responses is checked by
// the caller. Only non-trashed forms are returned.
func (r *Repository) GetForFill(ctx context.Context, id string) (Form, error) {
	q := `SELECT ` + formColumns + ` FROM grown.forms f WHERE f.id=$1 AND f.trashed_at IS NULL`
	f, err := scanForm(r.pool.QueryRow(ctx, q, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return Form{}, ErrNotFound
	}
	if err != nil {
		return Form{}, fmt.Errorf("forms.GetForFill: %w", err)
	}
	return f, nil
}

// List returns all non-trashed forms in orgID, newest first.
func (r *Repository) List(ctx context.Context, orgID string) ([]Form, error) {
	q := `SELECT ` + formColumns + ` FROM grown.forms f
		WHERE f.org_id=$1 AND f.trashed_at IS NULL
		ORDER BY f.updated_at DESC`
	rows, err := r.pool.Query(ctx, q, orgID)
	if err != nil {
		return nil, fmt.Errorf("forms.List: %w", err)
	}
	defer rows.Close()
	var out []Form
	for rows.Next() {
		f, err := scanForm(rows)
		if err != nil {
			return nil, fmt.Errorf("forms.List scan: %w", err)
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// Update replaces the editable fields of a form within orgID.
func (r *Repository) Update(ctx context.Context, orgID, id string, fl Fields) (Form, error) {
	q := `WITH f AS (
		UPDATE grown.forms SET
			title=$3, description=$4, questions=$5, settings=$6, accepting=$7, updated_at=now()
		WHERE id=$1 AND org_id=$2 AND trashed_at IS NULL
		RETURNING *
	) SELECT ` + formColumns + ` FROM f`
	f, err := scanForm(r.pool.QueryRow(ctx, q, id, orgID, fl.Title, fl.Description,
		marshalQuestions(fl.Questions), marshalSettings(fl.Settings), fl.Accepting))
	if errors.Is(err, pgx.ErrNoRows) {
		return Form{}, ErrNotFound
	}
	if err != nil {
		return Form{}, fmt.Errorf("forms.Update: %w", err)
	}
	return f, nil
}

// Trash soft-deletes a form within orgID.
func (r *Repository) Trash(ctx context.Context, orgID, id string) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE grown.forms SET trashed_at=now(), updated_at=now()
		 WHERE id=$1 AND org_id=$2 AND trashed_at IS NULL`, id, orgID)
	if err != nil {
		return fmt.Errorf("forms.Trash: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// --- Responses ---

func marshalAnswers(a map[string]any) []byte {
	if a == nil {
		a = map[string]any{}
	}
	b, _ := json.Marshal(a)
	return b
}

func scanResponse(row pgx.Row) (Response, error) {
	var r Response
	var answers []byte
	err := row.Scan(&r.ID, &r.FormID, &r.RespondentEmail, &answers, &r.CreatedAt, &r.Score)
	if err != nil {
		return Response{}, err
	}
	if len(answers) > 0 {
		_ = json.Unmarshal(answers, &r.Answers)
	}
	if r.Answers == nil {
		r.Answers = map[string]any{}
	}
	return r, nil
}

// SubmitResponse records a submission for a form. orgID/respondentID are stored
// for ownership/auditing; respondentID may be empty for anonymous submissions.
// score is nil for non-quiz forms.
func (r *Repository) SubmitResponse(ctx context.Context, orgID, formID, respondentID, email string, answers map[string]any, score *float64) (Response, error) {
	var rid any
	if respondentID != "" {
		rid = respondentID
	}
	q := `INSERT INTO grown.form_responses (form_id, org_id, respondent_id, respondent_email, answers, score)
		VALUES ($1,$2,$3,$4,$5,$6)
		RETURNING id::text, form_id::text, respondent_email, answers, created_at, score`
	resp, err := scanResponse(r.pool.QueryRow(ctx, q, formID, orgID, rid, email, marshalAnswers(answers), score))
	if err != nil {
		return Response{}, fmt.Errorf("forms.SubmitResponse: %w", err)
	}
	return resp, nil
}

// ListResponses returns all responses for a form within orgID, newest first.
func (r *Repository) ListResponses(ctx context.Context, orgID, formID string) ([]Response, error) {
	q := `SELECT id::text, form_id::text, respondent_email, answers, created_at, score
		FROM grown.form_responses
		WHERE form_id=$1 AND org_id=$2
		ORDER BY created_at DESC`
	rows, err := r.pool.Query(ctx, q, formID, orgID)
	if err != nil {
		return nil, fmt.Errorf("forms.ListResponses: %w", err)
	}
	defer rows.Close()
	var out []Response
	for rows.Next() {
		resp, err := scanResponse(rows)
		if err != nil {
			return nil, fmt.Errorf("forms.ListResponses scan: %w", err)
		}
		out = append(out, resp)
	}
	return out, rows.Err()
}

// DeleteResponses deletes all responses for a form within orgID, returning the
// number deleted.
func (r *Repository) DeleteResponses(ctx context.Context, orgID, formID string) (int64, error) {
	tag, err := r.pool.Exec(ctx,
		`DELETE FROM grown.form_responses WHERE form_id=$1 AND org_id=$2`, formID, orgID)
	if err != nil {
		return 0, fmt.Errorf("forms.DeleteResponses: %w", err)
	}
	return tag.RowsAffected(), nil
}

// --- ResponseFiles (file_upload question type) ---

// AddResponseFile stores metadata for a file uploaded with a file_upload question.
func (r *Repository) AddResponseFile(ctx context.Context, rf ResponseFile) (ResponseFile, error) {
	q := `INSERT INTO grown.form_response_files
		(response_id, question_id, org_id, blob_key, filename, content_type, size_bytes)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		RETURNING id::text, response_id::text, question_id, org_id::text, blob_key, filename, content_type, size_bytes, created_at`
	var out ResponseFile
	err := r.pool.QueryRow(ctx, q, rf.ResponseID, rf.QuestionID, rf.OrgID, rf.BlobKey, rf.Filename, rf.ContentType, rf.SizeBytes).
		Scan(&out.ID, &out.ResponseID, &out.QuestionID, &out.OrgID, &out.BlobKey, &out.Filename, &out.ContentType, &out.SizeBytes, &out.CreatedAt)
	if err != nil {
		return ResponseFile{}, fmt.Errorf("forms.AddResponseFile: %w", err)
	}
	return out, nil
}

// ListResponseFiles returns all file-upload attachments for a response.
func (r *Repository) ListResponseFiles(ctx context.Context, responseID string) ([]ResponseFile, error) {
	q := `SELECT id::text, response_id::text, question_id, org_id::text, blob_key, filename, content_type, size_bytes, created_at
		FROM grown.form_response_files
		WHERE response_id=$1
		ORDER BY created_at`
	rows, err := r.pool.Query(ctx, q, responseID)
	if err != nil {
		return nil, fmt.Errorf("forms.ListResponseFiles: %w", err)
	}
	defer rows.Close()
	var out []ResponseFile
	for rows.Next() {
		var f ResponseFile
		if err := rows.Scan(&f.ID, &f.ResponseID, &f.QuestionID, &f.OrgID, &f.BlobKey, &f.Filename, &f.ContentType, &f.SizeBytes, &f.CreatedAt); err != nil {
			return nil, fmt.Errorf("forms.ListResponseFiles scan: %w", err)
		}
		out = append(out, f)
	}
	return out, rows.Err()
}
