package forms

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
	"code.pick.haus/grown/grown/internal/auth"
)

// Service implements grownv1.FormsServiceServer over a Repository.
type Service struct {
	repo *Repository
}

// NewService constructs a Service.
func NewService(repo *Repository) *Service { return &Service{repo: repo} }

func callerOrg(ctx context.Context) (string, error) {
	if _, ok := auth.UserFromContext(ctx); !ok {
		return "", status.Error(codes.Unauthenticated, "no session")
	}
	o, ok := auth.OrgFromContext(ctx)
	if !ok {
		return "", status.Error(codes.Internal, "missing org context")
	}
	return o.ID, nil
}

// --- proto <-> model conversion ---

func questionToProto(q Question) *grownv1.FormQuestion {
	return &grownv1.FormQuestion{
		Id:             q.ID,
		Type:           q.Type,
		Title:          q.Title,
		Description:    q.Description,
		Required:       q.Required,
		Options:        q.Options,
		ScaleMin:       q.ScaleMin,
		ScaleMax:       q.ScaleMax,
		ScaleMinLabel:  q.ScaleMinLabel,
		ScaleMaxLabel:  q.ScaleMaxLabel,
		Points:         q.Points,
		CorrectAnswers: q.CorrectAnswers,
		GoToSection:    q.GoToSection,
		IsSection:      q.IsSection,
	}
}

func questionFromProto(q *grownv1.FormQuestion) Question {
	return Question{
		ID:             q.GetId(),
		Type:           q.GetType(),
		Title:          q.GetTitle(),
		Description:    q.GetDescription(),
		Required:       q.GetRequired(),
		Options:        q.GetOptions(),
		ScaleMin:       q.GetScaleMin(),
		ScaleMax:       q.GetScaleMax(),
		ScaleMinLabel:  q.GetScaleMinLabel(),
		ScaleMaxLabel:  q.GetScaleMaxLabel(),
		Points:         q.GetPoints(),
		CorrectAnswers: q.GetCorrectAnswers(),
		GoToSection:    q.GetGoToSection(),
		IsSection:      q.GetIsSection(),
	}
}

func questionsFromProto(qs []*grownv1.FormQuestion) []Question {
	out := make([]Question, 0, len(qs))
	for _, q := range qs {
		out = append(out, questionFromProto(q))
	}
	return out
}

func settingsToProto(s Settings) *grownv1.FormSettings {
	return &grownv1.FormSettings{
		CollectEmail:        s.CollectEmail,
		LimitOneResponse:    s.LimitOneResponse,
		ShowProgressBar:     s.ShowProgressBar,
		ShuffleQuestions:    s.ShuffleQuestions,
		ConfirmationMessage: s.ConfirmationMessage,
		IsQuiz:              s.IsQuiz,
	}
}

func settingsFromProto(s *grownv1.FormSettings) Settings {
	if s == nil {
		return Settings{}
	}
	return Settings{
		CollectEmail:        s.GetCollectEmail(),
		LimitOneResponse:    s.GetLimitOneResponse(),
		ShowProgressBar:     s.GetShowProgressBar(),
		ShuffleQuestions:    s.GetShuffleQuestions(),
		ConfirmationMessage: s.GetConfirmationMessage(),
		IsQuiz:              s.GetIsQuiz(),
	}
}

func formToProto(f Form) *grownv1.Form {
	qs := make([]*grownv1.FormQuestion, 0, len(f.Questions))
	for _, q := range f.Questions {
		qs = append(qs, questionToProto(q))
	}
	return &grownv1.Form{
		Id:            f.ID,
		OrgId:         f.OrgID,
		OwnerId:       f.OwnerID,
		Title:         f.Title,
		Description:   f.Description,
		Questions:     qs,
		Settings:      settingsToProto(f.Settings),
		Accepting:     f.Accepting,
		ResponseCount: f.ResponseCount,
		CreatedAt:     f.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:     f.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

func responseToProto(r Response) *grownv1.FormResponse {
	b, _ := json.Marshal(r.Answers)
	p := &grownv1.FormResponse{
		Id:              r.ID,
		FormId:          r.FormID,
		RespondentEmail: r.RespondentEmail,
		AnswersJson:     string(b),
		CreatedAt:       r.CreatedAt.UTC().Format(time.RFC3339),
	}
	if r.Score != nil {
		p.Score = float32(*r.Score)
	}
	if r.MaxScore != nil {
		p.MaxScore = float32(*r.MaxScore)
	}
	return p
}

// --- Form RPCs ---

func (s *Service) ListForms(ctx context.Context, _ *grownv1.ListFormsRequest) (*grownv1.ListFormsResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	list, err := s.repo.List(ctx, orgID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list forms: %v", err)
	}
	resp := &grownv1.ListFormsResponse{Forms: make([]*grownv1.Form, 0, len(list))}
	for _, f := range list {
		resp.Forms = append(resp.Forms, formToProto(f))
	}
	return resp, nil
}

func (s *Service) CreateForm(ctx context.Context, req *grownv1.CreateFormRequest) (*grownv1.Form, error) {
	u, ok := auth.UserFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.Unauthenticated, "no session")
	}
	o, ok := auth.OrgFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.Internal, "missing org context")
	}
	f, err := s.repo.Create(ctx, o.ID, u.ID, Fields{
		Title:       req.GetTitle(),
		Description: req.GetDescription(),
		Questions:   questionsFromProto(req.GetQuestions()),
		Accepting:   true,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "create form: %v", err)
	}
	return formToProto(f), nil
}

func (s *Service) GetForm(ctx context.Context, req *grownv1.GetFormRequest) (*grownv1.Form, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	f, err := s.repo.Get(ctx, orgID, req.GetId())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "form not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "get form: %v", err)
	}
	return formToProto(f), nil
}

func (s *Service) UpdateForm(ctx context.Context, req *grownv1.UpdateFormRequest) (*grownv1.Form, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	f, err := s.repo.Update(ctx, orgID, req.GetId(), Fields{
		Title:       req.GetTitle(),
		Description: req.GetDescription(),
		Questions:   questionsFromProto(req.GetQuestions()),
		Settings:    settingsFromProto(req.GetSettings()),
		Accepting:   req.GetAccepting(),
	})
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "form not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "update form: %v", err)
	}
	return formToProto(f), nil
}

func (s *Service) TrashForm(ctx context.Context, req *grownv1.TrashFormRequest) (*grownv1.TrashFormResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	err = s.repo.Trash(ctx, orgID, req.GetId())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "form not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "trash form: %v", err)
	}
	return &grownv1.TrashFormResponse{}, nil
}

// --- Response RPCs ---

// parseAnswers decodes the answers_json blob into a map[string]any, accepting
// either string scalars or []string lists per question.
func parseAnswers(raw string) (map[string]any, error) {
	if raw == "" {
		return map[string]any{}, nil
	}
	var m map[string]any
	if err := json.Unmarshal([]byte(raw), &m); err != nil {
		return nil, fmt.Errorf("invalid answers_json: %w", err)
	}
	return m, nil
}

func (s *Service) SubmitFormResponse(ctx context.Context, req *grownv1.SubmitFormResponseRequest) (*grownv1.FormResponse, error) {
	// Submissions require an authenticated org member; the form must belong to
	// the caller's org, exist, and be accepting responses.
	u, ok := auth.UserFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.Unauthenticated, "no session")
	}
	o, ok := auth.OrgFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.Internal, "missing org context")
	}
	form, err := s.repo.Get(ctx, o.ID, req.GetFormId())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "form not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "get form: %v", err)
	}
	if !form.Accepting {
		return nil, status.Error(codes.FailedPrecondition, "form is not accepting responses")
	}
	answers, err := parseAnswers(req.GetAnswersJson())
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, err.Error())
	}
	// Validate required questions are answered.
	for _, q := range form.Questions {
		if q.IsSection || !q.Required {
			continue
		}
		if !answered(answers[q.ID]) {
			return nil, status.Errorf(codes.InvalidArgument, "question %q is required", q.Title)
		}
	}
	email := req.GetRespondentEmail()
	if email == "" && form.Settings.CollectEmail {
		email = u.Email
	}

	// Auto-grade if the form is a quiz.
	var score *float64
	maxScore := computeMaxScore(form.Questions)
	if form.Settings.IsQuiz {
		s := computeScore(form.Questions, answers)
		score = &s
	}

	resp, err := s.repo.SubmitResponse(ctx, o.ID, form.ID, u.ID, email, answers, score)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "submit response: %v", err)
	}
	// Attach max_score so the caller can display it even when score is 0.
	if form.Settings.IsQuiz {
		resp.MaxScore = &maxScore
	}
	return responseToProto(resp), nil
}

func answered(v any) bool {
	switch t := v.(type) {
	case nil:
		return false
	case string:
		return t != ""
	case []any:
		return len(t) > 0
	default:
		return true
	}
}

func (s *Service) ListFormResponses(ctx context.Context, req *grownv1.ListFormResponsesRequest) (*grownv1.ListFormResponsesResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	// Ensure the form belongs to the caller's org before exposing responses.
	if _, err := s.repo.Get(ctx, orgID, req.GetFormId()); err != nil {
		if errors.Is(err, ErrNotFound) {
			return nil, status.Error(codes.NotFound, "form not found")
		}
		return nil, status.Errorf(codes.Internal, "get form: %v", err)
	}
	list, err := s.repo.ListResponses(ctx, orgID, req.GetFormId())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list responses: %v", err)
	}
	resp := &grownv1.ListFormResponsesResponse{Responses: make([]*grownv1.FormResponse, 0, len(list))}
	for _, r := range list {
		resp.Responses = append(resp.Responses, responseToProto(r))
	}
	return resp, nil
}

func (s *Service) GetFormResponseSummary(ctx context.Context, req *grownv1.GetFormResponseSummaryRequest) (*grownv1.FormResponseSummary, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	form, err := s.repo.Get(ctx, orgID, req.GetFormId())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "form not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "get form: %v", err)
	}
	responses, err := s.repo.ListResponses(ctx, orgID, form.ID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list responses: %v", err)
	}
	return buildSummary(form, responses), nil
}

// buildSummary aggregates responses per question. Choice/checkbox/dropdown/
// scale answers are tallied into counts; free-text answers are collected.
func buildSummary(form Form, responses []Response) *grownv1.FormResponseSummary {
	out := &grownv1.FormResponseSummary{
		FormId:        form.ID,
		ResponseCount: int32(len(responses)),
		Questions:     make([]*grownv1.FormQuestionSummary, 0, len(form.Questions)),
	}
	for _, q := range form.Questions {
		if q.IsSection {
			continue // section dividers are not answered
		}
		qs := &grownv1.FormQuestionSummary{
			QuestionId: q.ID,
			Type:       q.Type,
			Title:      q.Title,
		}
		isText := q.Type == TypeShortAnswer || q.Type == TypeParagraph || q.Type == TypeDate || q.Type == TypeTime || q.Type == TypeFileUpload
		if !isText {
			qs.Counts = map[string]int32{}
		}
		for _, r := range responses {
			v, ok := r.Answers[q.ID]
			if !ok {
				continue
			}
			switch q.Type {
			case TypeShortAnswer, TypeParagraph, TypeDate, TypeTime, TypeFileUpload:
				if str := asString(v); str != "" {
					qs.TextAnswers = append(qs.TextAnswers, str)
				}
			case TypeCheckboxes:
				for _, item := range asStringSlice(v) {
					if item != "" {
						qs.Counts[item]++
					}
				}
			default: // multiple_choice, dropdown, linear_scale
				if str := asString(v); str != "" {
					qs.Counts[str]++
				}
			}
		}
		out.Questions = append(out.Questions, qs)
	}
	return out
}

// --- Quiz scoring ---

// computeMaxScore returns the total points across all quiz-gradable questions.
func computeMaxScore(questions []Question) float64 {
	var total float64
	for _, q := range questions {
		if q.IsSection {
			continue
		}
		if isGradable(q.Type) && q.Points > 0 {
			total += float64(q.Points)
		}
	}
	return total
}

// isGradable returns true for question types that support an answer key.
func isGradable(qtype string) bool {
	switch qtype {
	case TypeMultipleChoice, TypeCheckboxes, TypeDropdown, TypeShortAnswer:
		return true
	}
	return false
}

// computeScore grades a submission against the answer keys, returning the
// number of points earned.
func computeScore(questions []Question, answers map[string]any) float64 {
	var total float64
	for _, q := range questions {
		if q.IsSection || !isGradable(q.Type) || q.Points <= 0 || len(q.CorrectAnswers) == 0 {
			continue
		}
		v, ok := answers[q.ID]
		if !ok {
			continue
		}
		pts := gradeQuestion(q, v)
		total += pts
	}
	return total
}

// gradeQuestion returns the points earned for a single question answer.
// For checkboxes, partial credit is given proportionally (full points only for
// exact match of the correct set). For other types full-or-nothing.
func gradeQuestion(q Question, answer any) float64 {
	switch q.Type {
	case TypeCheckboxes:
		// Full points only if the respondent selected exactly the correct set.
		selected := asStringSlice(answer)
		correct := make(map[string]bool, len(q.CorrectAnswers))
		for _, c := range q.CorrectAnswers {
			correct[c] = true
		}
		got := make(map[string]bool, len(selected))
		for _, s := range selected {
			got[s] = true
		}
		if len(got) == len(correct) {
			match := true
			for k := range correct {
				if !got[k] {
					match = false
					break
				}
			}
			if match {
				return float64(q.Points)
			}
		}
		return 0
	default:
		// single-answer: case-insensitive exact match against any correct answer.
		given := strings.TrimSpace(strings.ToLower(asString(answer)))
		for _, c := range q.CorrectAnswers {
			if strings.TrimSpace(strings.ToLower(c)) == given {
				return float64(q.Points)
			}
		}
		return 0
	}
}

// --- Section branching ---

// ResolveBranch returns the section id to navigate to after the respondent
// picks `answer` on question `q`. Returns "" if no branching is defined.
// Returns SubmitTarget ("__submit__") if the form should be submitted.
func ResolveBranch(q Question, answer string) string {
	if len(q.GoToSection) == 0 {
		return ""
	}
	target, ok := q.GoToSection[answer]
	if !ok {
		return ""
	}
	return target
}

func asString(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case float64:
		return strconv.FormatFloat(t, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(t)
	default:
		return ""
	}
}

func asStringSlice(v any) []string {
	switch t := v.(type) {
	case []any:
		out := make([]string, 0, len(t))
		for _, e := range t {
			out = append(out, asString(e))
		}
		return out
	case string:
		return []string{t}
	default:
		return nil
	}
}

func (s *Service) DeleteFormResponses(ctx context.Context, req *grownv1.DeleteFormResponsesRequest) (*grownv1.DeleteFormResponsesResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	if _, err := s.repo.Get(ctx, orgID, req.GetFormId()); err != nil {
		if errors.Is(err, ErrNotFound) {
			return nil, status.Error(codes.NotFound, "form not found")
		}
		return nil, status.Errorf(codes.Internal, "get form: %v", err)
	}
	n, err := s.repo.DeleteResponses(ctx, orgID, req.GetFormId())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "delete responses: %v", err)
	}
	return &grownv1.DeleteFormResponsesResponse{Deleted: int32(n)}, nil
}
