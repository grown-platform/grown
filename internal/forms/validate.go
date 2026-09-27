package forms

// Response validation, text-form masks and section-branching paths.
//
// This mirrors web/app/src/pages/forms/validate.ts: the client validates as
// the respondent types, and SubmitFormResponse re-checks everything here so a
// hand-crafted request can't bypass it. Error strings match the client's so
// the respondent sees the same message either way.
//
// The mask syntax follows OnlyOffice text-form masks (behaviour only; the
// implementation is our own): 9 = digit, a/A = letter, O = digit or letter,
// X = any character, \c = the literal c, anything else is a literal.

import (
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"unicode"
)

// GridKeySep joins a grid row and column in a grid question's answer key
// (CorrectAnswers entries are row + GridKeySep + column).
const GridKeySep = "\x1f"

// Text formats (Question.TextFormat).
const (
	FormatDigits     = "digits"
	FormatLetters    = "letters"
	FormatPhone      = "phone"
	FormatZip        = "zip"
	FormatCreditCard = "credit_card"
	FormatMask       = "mask"
)

// FormatMask returns the effective mask for a text format ("" = no mask).
func formatMask(format, mask string) string {
	switch format {
	case FormatPhone:
		return "(999) 999-9999"
	case FormatZip:
		return "99999"
	case FormatCreditCard:
		return "9999 9999 9999 9999"
	case FormatMask:
		return mask
	}
	return ""
}

// --- masks ---

type maskKind int

const (
	maskLiteral maskKind = iota
	maskDigit
	maskLetter
	maskDigitOrLetter
	maskAny
)

type maskItem struct {
	kind maskKind
	lit  rune
}

func parseMask(mask string) []maskItem {
	var out []maskItem
	rs := []rune(mask)
	for i := 0; i < len(rs); i++ {
		switch r := rs[i]; r {
		case '\\':
			if i+1 < len(rs) {
				i++
				out = append(out, maskItem{maskLiteral, rs[i]})
			}
		case '9':
			out = append(out, maskItem{kind: maskDigit})
		case 'a', 'A':
			out = append(out, maskItem{kind: maskLetter})
		case 'O':
			out = append(out, maskItem{kind: maskDigitOrLetter})
		case 'X':
			out = append(out, maskItem{kind: maskAny})
		default:
			out = append(out, maskItem{maskLiteral, r})
		}
	}
	return out
}

func isDigit(r rune) bool { return r >= '0' && r <= '9' }

func (m maskItem) accepts(r rune) bool {
	switch m.kind {
	case maskDigit:
		return isDigit(r)
	case maskLetter:
		return unicode.IsLetter(r)
	case maskDigitOrLetter:
		return isDigit(r) || unicode.IsLetter(r)
	case maskAny:
		return true
	}
	return m.lit == r
}

// MaskCheck reports whether s fits mask. With full=false a prefix is enough
// (the respondent is still typing); with full=true every mask position must
// be filled.
func MaskCheck(mask, s string, full bool) bool {
	items := parseMask(mask)
	rs := []rune(s)
	if full && len(rs) != len(items) {
		return false
	}
	if len(rs) > len(items) {
		return false
	}
	for i, r := range rs {
		if !items[i].accepts(r) {
			return false
		}
	}
	return true
}

// MaskCorrect fits typed text into mask, inserting literals the respondent
// skipped ("9991231122" -> "(999) 123-1122" for "(999) 999-9999"). Text that
// can't be fitted is returned unchanged; input longer than the mask is cut at
// the mask length.
func MaskCorrect(mask, s string) string {
	items := parseMask(mask)
	in := []rune(s)
	if len(items) == 0 || len(in) == 0 {
		return s
	}
	out := make([]rune, 0, len(items))
	pos := 0
	for _, it := range items {
		if pos < len(in) && it.accepts(in[pos]) {
			out = append(out, in[pos])
			pos++
			continue
		}
		if it.kind == maskLiteral {
			out = append(out, it.lit)
			continue
		}
		break
	}
	if pos == len(in) || len(out) == len(items) {
		return string(out)
	}
	return s
}

// --- validation ---

var (
	numberRe = regexp.MustCompile(`^[+-]?(\d+(\.\d*)?|\.\d+)$`)
	emailRe  = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)
	urlRe    = regexp.MustCompile(`^(?i)(https?://)?([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?([/?#]\S*)?$`)
)

func parseNumber(s string) (float64, bool) {
	s = strings.TrimSpace(s)
	if !numberRe.MatchString(s) {
		return 0, false
	}
	f, err := strconv.ParseFloat(s, 64)
	return f, err == nil
}

func fmtNum(s string) string { return strings.TrimSpace(s) }

// ValidateAnswer returns the error message for answer v on question q, or ""
// when it is acceptable. Empty answers are always acceptable here (the
// required check is separate), except grid rows under Required.
func ValidateAnswer(q Question, v any) string {
	switch q.Type {
	case TypeShortAnswer, TypeParagraph:
		s := asString(v)
		if s == "" {
			return ""
		}
		if q.Type == TypeShortAnswer {
			if msg := checkTextFormat(q, s); msg != "" {
				return msg
			}
		}
		return withCustom(q.Validation, checkRule(q.Validation, s, nil))
	case TypeCheckboxes:
		sel := asStringSlice(v)
		if len(sel) == 0 {
			return ""
		}
		return withCustom(q.Validation, checkRule(q.Validation, "", sel))
	case TypeMultipleChoiceGrid, TypeCheckboxGrid:
		return checkGrid(q, v)
	case TypeRating:
		s := asString(v)
		if s == "" {
			return ""
		}
		n, err := strconv.Atoi(s)
		if err != nil || n < 1 || n > int(ratingLevels(q)) {
			return fmt.Sprintf("Must be a rating from 1 to %d", ratingLevels(q))
		}
	}
	return ""
}

func ratingLevels(q Question) int32 {
	if q.ScaleMax >= 3 && q.ScaleMax <= 10 {
		return q.ScaleMax
	}
	return 5
}

func withCustom(v *Validation, msg string) string {
	if msg != "" && v != nil && strings.TrimSpace(v.ErrorText) != "" {
		return strings.TrimSpace(v.ErrorText)
	}
	return msg
}

func checkTextFormat(q Question, s string) string {
	switch q.TextFormat {
	case FormatDigits:
		for _, r := range s {
			if !isDigit(r) {
				return "Must contain only digits"
			}
		}
	case FormatLetters:
		for _, r := range s {
			if !unicode.IsLetter(r) {
				return "Must contain only letters"
			}
		}
	default:
		if m := formatMask(q.TextFormat, q.Mask); m != "" && !MaskCheck(m, s, true) {
			return "Must match the format " + maskDisplay(m)
		}
	}
	return ""
}

// maskDisplay renders a mask for an error message: escapes are dropped.
func maskDisplay(mask string) string {
	var b strings.Builder
	rs := []rune(mask)
	for i := 0; i < len(rs); i++ {
		if rs[i] == '\\' && i+1 < len(rs) {
			i++
		}
		b.WriteRune(rs[i])
	}
	return b.String()
}

func checkRule(v *Validation, s string, sel []string) string {
	if v == nil || v.Kind == "" {
		return ""
	}
	switch v.Kind {
	case "number":
		n, ok := parseNumber(s)
		if !ok {
			return "Must be a number"
		}
		a, _ := strconv.ParseFloat(strings.TrimSpace(v.Value), 64)
		b, _ := strconv.ParseFloat(strings.TrimSpace(v.Value2), 64)
		switch v.Op {
		case "gt":
			if !(n > a) {
				return "Must be a number greater than " + fmtNum(v.Value)
			}
		case "gte":
			if !(n >= a) {
				return "Must be a number greater than or equal to " + fmtNum(v.Value)
			}
		case "lt":
			if !(n < a) {
				return "Must be a number less than " + fmtNum(v.Value)
			}
		case "lte":
			if !(n <= a) {
				return "Must be a number less than or equal to " + fmtNum(v.Value)
			}
		case "eq":
			if n != a {
				return "Must be a number equal to " + fmtNum(v.Value)
			}
		case "neq":
			if n == a {
				return "Must be a number not equal to " + fmtNum(v.Value)
			}
		case "between":
			if n < math.Min(a, b) || n > math.Max(a, b) {
				return fmt.Sprintf("Must be a number between %s and %s", fmtNum(v.Value), fmtNum(v.Value2))
			}
		case "not_between":
			if n >= math.Min(a, b) && n <= math.Max(a, b) {
				return fmt.Sprintf("Must be a number not between %s and %s", fmtNum(v.Value), fmtNum(v.Value2))
			}
		case "whole_number":
			if n != math.Trunc(n) || strings.Contains(s, ".") {
				return "Must be a whole number"
			}
		}
	case "text":
		switch v.Op {
		case "contains":
			if !strings.Contains(s, v.Value) {
				return fmt.Sprintf("Must contain %q", v.Value)
			}
		case "not_contains":
			if v.Value != "" && strings.Contains(s, v.Value) {
				return fmt.Sprintf("Must not contain %q", v.Value)
			}
		case "email":
			if !emailRe.MatchString(strings.TrimSpace(s)) {
				return "Must be an email address"
			}
		case "url":
			if !urlRe.MatchString(strings.TrimSpace(s)) {
				return "Must be a URL"
			}
		}
	case "length":
		n, _ := strconv.Atoi(strings.TrimSpace(v.Value))
		l := len([]rune(s))
		switch v.Op {
		case "max_chars":
			if l > n {
				return fmt.Sprintf("Must be at most %d characters", n)
			}
		case "min_chars":
			if l < n {
				return fmt.Sprintf("Must be at least %d characters", n)
			}
		}
	case "regex":
		// JavaScript and RE2 syntax overlap for everyday patterns. A pattern
		// RE2 can't compile (lookaround, backreferences) is only enforced by
		// the client.
		re, err := regexp.Compile(v.Value)
		if err != nil {
			return ""
		}
		full, err := regexp.Compile(`^(?:` + v.Value + `)$`)
		if err != nil {
			return ""
		}
		switch v.Op {
		case "contains":
			if !re.MatchString(s) {
				return "Must contain a match for " + v.Value
			}
		case "not_contains":
			if re.MatchString(s) {
				return "Must not contain a match for " + v.Value
			}
		case "matches":
			if !full.MatchString(s) {
				return "Must match the pattern " + v.Value
			}
		case "not_matches":
			if full.MatchString(s) {
				return "Must not match the pattern " + v.Value
			}
		}
	case "checkbox":
		n, _ := strconv.Atoi(strings.TrimSpace(v.Value))
		c := len(sel)
		switch v.Op {
		case "at_least":
			if c < n {
				return fmt.Sprintf("Must select at least %d options", n)
			}
		case "at_most":
			if c > n {
				return fmt.Sprintf("Must select at most %d options", n)
			}
		case "exactly":
			if c != n {
				return fmt.Sprintf("Must select exactly %d options", n)
			}
		}
	}
	return ""
}

// gridAnswer decodes a grid answer (a JSON object keyed by row) into
// row -> selected columns.
func gridAnswer(v any) map[string][]string {
	m, ok := v.(map[string]any)
	if !ok {
		return nil
	}
	out := make(map[string][]string, len(m))
	for row, cell := range m {
		var cols []string
		for _, c := range asStringSlice(cell) {
			if c != "" {
				cols = append(cols, c)
			}
		}
		if len(cols) > 0 {
			out[row] = cols
		}
	}
	return out
}

func checkGrid(q Question, v any) string {
	if v != nil {
		if _, ok := v.(map[string]any); !ok {
			return "Invalid grid answer"
		}
	}
	ans := gridAnswer(v)
	rows := make(map[string]bool, len(q.Rows))
	for _, r := range q.Rows {
		rows[r] = true
	}
	cols := make(map[string]bool, len(q.Options))
	for _, c := range q.Options {
		cols[c] = true
	}
	used := map[string]bool{}
	for row, sel := range ans {
		if !rows[row] {
			return fmt.Sprintf("Unknown row %q", row)
		}
		if q.Type == TypeMultipleChoiceGrid && len(sel) > 1 {
			return "Select one response per row"
		}
		for _, c := range sel {
			if !cols[c] {
				return fmt.Sprintf("Unknown column %q", c)
			}
			if q.LimitOnePerColumn {
				if used[c] {
					return "Please don't select more than one response per column"
				}
				used[c] = true
			}
		}
	}
	if q.Required && len(ans) > 0 && len(ans) < len(q.Rows) {
		return "This question requires one response per row"
	}
	return ""
}

// --- section branching path ---

// page is one respondent page: the questions before the first divider, then
// each divider with the questions that follow it.
type page struct {
	section   *Question // nil for the first, implicit section
	questions []Question
}

func buildPages(qs []Question) []page {
	pages := []page{{}}
	for i := range qs {
		if qs[i].IsSection {
			pages = append(pages, page{section: &qs[i]})
			continue
		}
		pages[len(pages)-1].questions = append(pages[len(pages)-1].questions, qs[i])
	}
	return pages
}

// nextPage resolves where the respondent goes after page idx: -1 = submit.
// A go-to-section answer on the page wins (the last one, like Google Forms),
// then the section's "after section" setting, then the next page.
func nextPage(form Form, pages []page, idx int, answers map[string]any) int {
	target := ""
	for _, q := range pages[idx].questions {
		if len(q.GoToSection) == 0 || (q.Type != TypeMultipleChoice && q.Type != TypeDropdown) {
			continue
		}
		if t := ResolveBranch(q, asString(answers[q.ID])); t != "" {
			target = t
		}
	}
	if target == "" {
		if pages[idx].section == nil {
			target = form.Settings.AfterFirstSection
		} else {
			target = pages[idx].section.AfterSection
		}
	}
	if target == SubmitTarget {
		return -1
	}
	if target != "" {
		for i, p := range pages {
			if p.section != nil && p.section.ID == target {
				return i
			}
		}
	}
	if idx+1 >= len(pages) {
		return -1
	}
	return idx + 1
}

// VisitedQuestions returns the ids of the questions a respondent with these
// answers actually saw, following section branching from the first page. A
// jump back to a page already visited ends the walk (the respondent can't
// submit from a loop, so it never reaches a real submission).
func VisitedQuestions(form Form, answers map[string]any) map[string]bool {
	pages := buildPages(form.Questions)
	seen := map[int]bool{}
	out := map[string]bool{}
	for idx := 0; idx >= 0 && !seen[idx]; idx = nextPage(form, pages, idx, answers) {
		seen[idx] = true
		for _, q := range pages[idx].questions {
			out[q.ID] = true
		}
	}
	return out
}

// answeredFor is answered() that also understands grid objects.
func answeredFor(q Question, v any) bool {
	if q.Type == TypeMultipleChoiceGrid || q.Type == TypeCheckboxGrid {
		return len(gridAnswer(v)) > 0
	}
	return answered(v)
}
