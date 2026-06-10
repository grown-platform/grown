package pdf

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/color"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"
)

// Annotation mirrors the on-disk JSONB shape produced by the tibui
// PDFEditor (frontend). Only the fields we know how to bake are typed;
// unknown fields are ignored. All coordinates are normalized 0-1 over
// the page width/height with origin at the top-left (image-space
// convention used by the frontend).
type Annotation struct {
	ID          string          `json:"id"`
	Type        string          `json:"type"`
	PageNumber  int             `json:"pageNumber"`
	Bounds      AnnotationBox   `json:"bounds"`
	Points      []AnnotPoint    `json:"points,omitempty"`     // freehand
	StartPoint  *AnnotPoint     `json:"startPoint,omitempty"` // arrow
	EndPoint    *AnnotPoint     `json:"endPoint,omitempty"`   // arrow
	Rects       []AnnotationBox `json:"rects,omitempty"`      // highlight
	Content     string          `json:"content,omitempty"`    // text
	StrokeColor string          `json:"strokeColor,omitempty"`
	StrokeWidth float64         `json:"strokeWidth,omitempty"`
	FillColor   string          `json:"fillColor,omitempty"`
	FillOpacity float64         `json:"fillOpacity,omitempty"`
	FontSize    int             `json:"fontSize,omitempty"`
	FontColor   string          `json:"fontColor,omitempty"`
	Color       string          `json:"color,omitempty"`   // highlight
	Opacity     float64         `json:"opacity,omitempty"` // highlight
}

// AnnotationBox is a normalized (0-1) rectangle, top-left origin.
type AnnotationBox struct {
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

// AnnotPoint is a normalized (0-1) point, top-left origin.
type AnnotPoint struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// BakeAnnotations parses the JSON array of frontend annotations and
// embeds them into pdfBytes as native PDF annotations using pdfcpu. The
// returned reader yields a PDF that includes the annotations as part of
// its page content (Ink, Square, Circle, PolyLine, FreeText, Highlight).
//
// We intentionally embed BEFORE cryptographic signing so the resulting
// digital signature covers the baked annotations — any post-signing
// modification would invalidate the signature.
//
// If annotationsJSON is empty or "[]" the original pdfBytes are returned
// unchanged. Per-annotation failures are logged and skipped; we never
// fail the whole call for a single bad annotation.
func (g *Generator) BakeAnnotations(pdfBytes []byte, annotationsJSON []byte) ([]byte, error) {
	if len(annotationsJSON) == 0 {
		return pdfBytes, nil
	}
	trimmed := bytes.TrimSpace(annotationsJSON)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("[]")) || bytes.Equal(trimmed, []byte("null")) {
		return pdfBytes, nil
	}

	var anns []Annotation
	if err := json.Unmarshal(annotationsJSON, &anns); err != nil {
		return nil, fmt.Errorf("parse annotations JSON: %w", err)
	}
	if len(anns) == 0 {
		return pdfBytes, nil
	}

	conf := model.NewDefaultConfiguration()

	// Page dimensions in PDF user space (points). pdfcpu returns one
	// entry per page; we index by 1-based pageNumber.
	dims, err := api.PageDims(bytes.NewReader(pdfBytes), conf)
	if err != nil {
		return nil, fmt.Errorf("read page dimensions: %w", err)
	}

	// Group annotations by page and convert to pdfcpu renderers.
	byPage := map[int][]model.AnnotationRenderer{}
	skipped := 0
	for _, a := range anns {
		if a.PageNumber < 1 || a.PageNumber > len(dims) {
			slog.Warn("BakeAnnotations: annotation has out-of-range pageNumber",
				"pageNumber", a.PageNumber, "type", a.Type, "id", a.ID)
			skipped++
			continue
		}
		pageDim := dims[a.PageNumber-1]
		renderers, err := renderAnnotation(a, pageDim)
		if err != nil {
			slog.Warn("BakeAnnotations: skipping annotation",
				"id", a.ID, "type", a.Type, "error", err)
			skipped++
			continue
		}
		byPage[a.PageNumber] = append(byPage[a.PageNumber], renderers...)
	}

	if len(byPage) == 0 {
		slog.Info("BakeAnnotations: no annotations to embed after filtering",
			"input", len(anns), "skipped", skipped)
		return pdfBytes, nil
	}

	out := &bytes.Buffer{}
	if err := api.AddAnnotationsMap(bytes.NewReader(pdfBytes), out, byPage, conf); err != nil {
		return nil, fmt.Errorf("pdfcpu AddAnnotationsMap: %w", err)
	}

	slog.Info("BakeAnnotations: embedded annotations",
		"input", len(anns), "skipped", skipped, "pages", len(byPage))

	return out.Bytes(), nil
}

// renderAnnotation converts one frontend annotation into one or more
// pdfcpu annotation renderers. Most types map 1:1; highlight may
// expand to multiple quads.
func renderAnnotation(a Annotation, pageDim types.Dim) ([]model.AnnotationRenderer, error) {
	pageW := pageDim.Width
	pageH := pageDim.Height

	// Convert top-left-origin normalized bounds to PDF user-space
	// bottom-left-origin rectangle.
	pdfRect := func(b AnnotationBox) types.Rectangle {
		llx := b.X * pageW
		lly := (1 - b.Y - b.Height) * pageH
		urx := (b.X + b.Width) * pageW
		ury := (1 - b.Y) * pageH
		return *types.NewRectangle(llx, lly, urx, ury)
	}

	strokeCol := parseHexColorOr(a.StrokeColor, defaultStrokeColor())
	fillCol := parseHexColorOrNil(a.FillColor)
	bw := a.StrokeWidth
	if bw <= 0 {
		bw = 1
	}

	switch strings.ToLower(a.Type) {
	case "freehand":
		// Map points (normalized, top-left origin) into a single InkPath
		// of alternating x,y user-space coordinates.
		if len(a.Points) < 2 {
			return nil, fmt.Errorf("freehand requires >=2 points (got %d)", len(a.Points))
		}
		path := make(model.InkPath, 0, len(a.Points)*2)
		for _, p := range a.Points {
			path = append(path, p.X*pageW, (1-p.Y)*pageH)
		}
		ann := model.NewInkAnnotation(
			pdfRect(a.Bounds),
			0,              // apObjNr
			"",             // contents
			a.ID,           // id
			"",             // modDate
			model.AnnPrint, // flags
			&strokeCol,
			"pdf", // title
			nil,       // popup
			nil,       // ca
			"",        // rc
			"",        // subject
			[]model.InkPath{path},
			bw,
			model.BSSolid,
		)
		return []model.AnnotationRenderer{ann}, nil

	case "rectangle":
		ann := model.NewSquareAnnotation(
			pdfRect(a.Bounds), 0, "", a.ID, "", model.AnnPrint, &strokeCol,
			"pdf", nil, nil, "", "",
			fillCol,
			0, 0, 0, 0,
			bw, model.BSSolid, false, 0,
		)
		return []model.AnnotationRenderer{ann}, nil

	case "circle":
		ann := model.NewCircleAnnotation(
			pdfRect(a.Bounds), 0, "", a.ID, "", model.AnnPrint, &strokeCol,
			"pdf", nil, nil, "", "",
			fillCol,
			0, 0, 0, 0,
			bw, model.BSSolid, false, 0,
		)
		return []model.AnnotationRenderer{ann}, nil

	case "arrow":
		if a.StartPoint == nil || a.EndPoint == nil {
			return nil, fmt.Errorf("arrow requires startPoint and endPoint")
		}
		p1 := types.NewPoint(a.StartPoint.X*pageW, (1-a.StartPoint.Y)*pageH)
		p2 := types.NewPoint(a.EndPoint.X*pageW, (1-a.EndPoint.Y)*pageH)
		endStyle := model.LEClosedArrow
		beginStyle := model.LENone
		// Enclosing rect from the two points; pad by stroke width.
		llx, urx := p1.X, p2.X
		if llx > urx {
			llx, urx = urx, llx
		}
		lly, ury := p1.Y, p2.Y
		if lly > ury {
			lly, ury = ury, lly
		}
		pad := bw + 6
		rect := *types.NewRectangle(llx-pad, lly-pad, urx+pad, ury+pad)
		ann := model.NewLineAnnotation(
			rect, 0, "", a.ID, "", model.AnnPrint, &strokeCol,
			"pdf", nil, nil, "", "",
			p1, p2,
			&beginStyle, &endStyle,
			0, 0, 0,
			nil, nil,
			false, false, 0, 0,
			&strokeCol,
			bw, model.BSSolid,
		)
		return []model.AnnotationRenderer{ann}, nil

	case "text":
		text := a.Content
		if text == "" {
			return nil, fmt.Errorf("text annotation has no content")
		}
		fontCol := parseHexColorOr(a.FontColor, defaultTextColor())
		fontSize := a.FontSize
		if fontSize <= 0 {
			fontSize = 12
		}
		// Free text annotations need both a rect AND visible defaults.
		ann := model.NewFreeTextAnnotation(
			pdfRect(a.Bounds), 0, text, a.ID, "", model.AnnPrint, &strokeCol,
			"pdf", nil, nil, "", "",
			text,
			0, // hAlign left
			"Helvetica", fontSize, &fontCol,
			"",  // DS
			nil, // intent
			nil, // callout
			nil, // callout ending
			0, 0, 0, 0,
			0, model.BSSolid, false, 0,
		)
		return []model.AnnotationRenderer{ann}, nil

	case "highlight":
		// Highlight may carry several sub-rects (one per text line).
		// Fall back to bounds if rects is empty.
		boxes := a.Rects
		if len(boxes) == 0 {
			boxes = []AnnotationBox{a.Bounds}
		}
		hlCol := parseHexColorOr(a.Color, defaultHighlightColor())
		var out []model.AnnotationRenderer
		for _, b := range boxes {
			r := pdfRect(b)
			quad := types.QuadPoints{*types.NewQuadLiteralForRect(&r)}
			hl := model.NewHighlightAnnotation(
				r, 0, "", a.ID, "", model.AnnPrint, &hlCol,
				0, 0, 0,
				"pdf", nil, nil, "", "",
				quad,
			)
			out = append(out, hl)
		}
		return out, nil

	case "stamp":
		// Stamps from the frontend can be text or image; we don't have a
		// generic baker for arbitrary stamp content yet. Skip with a
		// warning so the rest of the page is preserved.
		return nil, fmt.Errorf("stamp annotations are not yet bakeable")
	}

	return nil, fmt.Errorf("unsupported annotation type %q", a.Type)
}

// parseHexColorOr parses "#rrggbb" (or "rrggbb") and falls back to dflt
// on any error.
func parseHexColorOr(s string, dflt color.SimpleColor) color.SimpleColor {
	c := parseHexColorOrNil(s)
	if c == nil {
		return dflt
	}
	return *c
}

func parseHexColorOrNil(s string) *color.SimpleColor {
	if s == "" {
		return nil
	}
	hex := strings.TrimSpace(s)
	if !strings.HasPrefix(hex, "#") {
		hex = "#" + hex
	}
	c, err := color.NewSimpleColorForHexCode(hex)
	if err != nil {
		return nil
	}
	return &c
}

func defaultStrokeColor() color.SimpleColor {
	// black
	return color.SimpleColor{R: 0, G: 0, B: 0}
}

func defaultTextColor() color.SimpleColor {
	return color.SimpleColor{R: 0, G: 0, B: 0}
}

func defaultHighlightColor() color.SimpleColor {
	// yellow
	return color.SimpleColor{R: 1, G: 1, B: 0}
}
