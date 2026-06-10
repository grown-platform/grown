package pdf

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"image"
	_ "image/png" // Register PNG decoder
	"io"
	"strings"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"
)

// SignatureField represents a signature image to embed in the PDF
type SignatureField struct {
	PageNumber int
	X          float64 // 0-1 normalized
	Y          float64 // 0-1 normalized
	Width      float64 // 0-1 normalized
	Height     float64 // 0-1 normalized
	ImageData  string  // base64 encoded PNG
	SignerName string
	SignedAt   string
}

// TextField represents a text value to embed in the PDF
type TextField struct {
	PageNumber int
	X          float64 // 0-1 normalized
	Y          float64 // 0-1 normalized
	Width      float64 // 0-1 normalized
	Height     float64 // 0-1 normalized
	Text       string
	FontSize   int // Font size in points (default 12)
}

// Generator handles PDF generation with embedded signatures
type Generator struct{}

// New creates a new PDF generator
func New() *Generator {
	return &Generator{}
}

// EmbedSignatures takes a PDF and embeds signature images at the specified locations
func (g *Generator) EmbedSignatures(ctx context.Context, pdfReader io.Reader, signatures []SignatureField, textFields []TextField) (io.Reader, error) {
	// Read the entire PDF into memory
	pdfData, err := io.ReadAll(pdfReader)
	if err != nil {
		return nil, fmt.Errorf("failed to read PDF: %w", err)
	}

	// If no fields, just return the original
	if len(signatures) == 0 && len(textFields) == 0 {
		return bytes.NewReader(pdfData), nil
	}

	// Create a configuration
	conf := model.NewDefaultConfiguration()

	// Read the PDF
	inBuf := bytes.NewReader(pdfData)

	// Standard US Letter is 612x792 points
	pageWidth := 612.0
	pageHeight := 792.0

	// Embed signature images
	for _, sig := range signatures {
		if sig.ImageData == "" {
			continue
		}

		// Decode the base64 image
		imgData, err := decodeBase64Image(sig.ImageData)
		if err != nil {
			return nil, fmt.Errorf("failed to decode signature image: %w", err)
		}

		// Get image dimensions to calculate proper scaling
		imgConfig, _, err := image.DecodeConfig(bytes.NewReader(imgData))
		if err != nil {
			fmt.Printf("Warning: failed to decode image config: %v, using default scale\n", err)
			imgConfig.Width = 300
			imgConfig.Height = 100
		}

		// Create a buffer for the image
		imgBuf := bytes.NewReader(imgData)

		// Convert normalized coordinates to absolute
		// Note: PDF coordinates start from bottom-left, our Y is from top
		absX := sig.X * pageWidth
		absY := (1 - sig.Y - sig.Height) * pageHeight // Flip Y and account for height

		// Calculate target dimensions in points
		targetWidth := sig.Width * pageWidth    // e.g., 0.25 * 612 = 153 points
		targetHeight := sig.Height * pageHeight // e.g., 0.06 * 792 = 47.5 points

		// Calculate scale factors based on fitting image within field bounds
		// pdfcpu scalefactor is relative to page WIDTH, so we need to account for that
		// If image is 300px wide and we want it to be 153pt wide:
		// scalefactor = targetWidth / pageWidth = 153 / 612 = 0.25
		scaleByWidth := targetWidth / pageWidth
		// For height: we need to find what scalefactor would make the image height fit
		// If image is 100px tall, and scalefactor:0.25 makes it 0.25*612 = 153pt wide,
		// then the height would be 100/300 * 153 = 51pt
		// To make it 47.5pt, we need: scalefactor = 47.5 / (imgHeight/imgWidth * pageWidth)
		imgAspect := float64(imgConfig.Height) / float64(imgConfig.Width)
		scaleByHeight := targetHeight / (imgAspect * pageWidth)

		// Use the smaller scale factor to ensure image fits within both dimensions
		scaleFactor := scaleByWidth
		if scaleByHeight < scaleByWidth {
			scaleFactor = scaleByHeight
		}

		if scaleFactor > 1.0 {
			scaleFactor = 1.0
		}
		if scaleFactor < 0.01 {
			scaleFactor = 0.01
		}

		fmt.Printf("Signature: imgSize=%dx%d, field=%.3fx%.3f, targetPts=%.1fx%.1f, scale=%.4f\n",
			imgConfig.Width, imgConfig.Height, sig.Width, sig.Height, targetWidth, targetHeight, scaleFactor)

		// Use scalefactor parameter (relative to page width)
		wmDesc := fmt.Sprintf("position:bl, offset:%.1f %.1f, scalefactor:%.4f, rotation:0", absX, absY, scaleFactor)

		wm, err := api.ImageWatermarkForReader(
			imgBuf,
			wmDesc,
			true,  // onTop
			false, // update
			types.POINTS,
		)
		if err != nil {
			fmt.Printf("Warning: failed to create watermark (desc=%s): %v\n", wmDesc, err)
			continue
		}

		// Apply watermark to specific page
		pages := []string{fmt.Sprintf("%d", sig.PageNumber)}
		outBuf := &bytes.Buffer{}

		if err := api.AddWatermarks(inBuf, outBuf, pages, wm, conf); err != nil {
			fmt.Printf("Warning: failed to add signature watermark: %v\n", err)
			continue
		}

		// Use output as input for next iteration
		pdfData = outBuf.Bytes()
		inBuf = bytes.NewReader(pdfData)
	}

	// Embed text fields (date, text, etc.)
	for _, tf := range textFields {
		if tf.Text == "" {
			continue
		}

		// Convert normalized coordinates to absolute
		absX := tf.X * pageWidth
		absY := (1 - tf.Y - tf.Height) * pageHeight

		// Use font size from field, default to 12 if not set
		fontSize := tf.FontSize
		if fontSize <= 0 {
			fontSize = 12
		}

		// pdfcpu text watermark uses "points" for font size
		// IMPORTANT: Must set "scalefactor:1 abs" to override the default 0.5 relative scale
		// Without this, the text gets scaled to 50% of page width regardless of font size
		wmDesc := fmt.Sprintf("position:bl, offset:%.1f %.1f, points:%d, scalefactor:1 abs, rotation:0", absX, absY, fontSize)
		fmt.Printf("Text watermark: text=%q, fontSize=%d, desc=%s\n", tf.Text, fontSize, wmDesc)

		wm, err := api.TextWatermark(tf.Text, wmDesc, true, false, types.POINTS)
		if err != nil {
			fmt.Printf("Warning: failed to create text watermark (desc=%s): %v\n", wmDesc, err)
			continue
		}

		pages := []string{fmt.Sprintf("%d", tf.PageNumber)}
		outBuf := &bytes.Buffer{}

		if err := api.AddWatermarks(inBuf, outBuf, pages, wm, conf); err != nil {
			fmt.Printf("Warning: failed to add text watermark: %v\n", err)
			continue
		}

		pdfData = outBuf.Bytes()
		inBuf = bytes.NewReader(pdfData)
	}

	return bytes.NewReader(pdfData), nil
}

// decodeBase64Image decodes a base64 data URL to raw PNG bytes
func decodeBase64Image(dataURL string) ([]byte, error) {
	// Handle data URL format: data:image/png;base64,xxxxx
	if strings.HasPrefix(dataURL, "data:") {
		parts := strings.SplitN(dataURL, ",", 2)
		if len(parts) != 2 {
			return nil, fmt.Errorf("invalid data URL format")
		}
		dataURL = parts[1]
	}

	return base64.StdEncoding.DecodeString(dataURL)
}

// AddSignaturePage adds a signature summary page to the end of the PDF
func (g *Generator) AddSignaturePage(ctx context.Context, pdfReader io.Reader, signers []SignerInfo) (io.Reader, error) {
	// For now, just return the PDF as-is
	// A full implementation would add a summary page with all signer details
	pdfData, err := io.ReadAll(pdfReader)
	if err != nil {
		return nil, err
	}
	return bytes.NewReader(pdfData), nil
}

// SignerInfo contains information about a signer for the summary page
type SignerInfo struct {
	Name      string
	Email     string
	SignedAt  string
	IPAddress string
}

// ValidatePDF checks if the input is a valid PDF
func (g *Generator) ValidatePDF(pdfReader io.Reader) error {
	data, err := io.ReadAll(pdfReader)
	if err != nil {
		return err
	}

	conf := model.NewDefaultConfiguration()
	return api.Validate(bytes.NewReader(data), conf)
}

// GetPageCount returns the number of pages in a PDF
func (g *Generator) GetPageCount(pdfReader io.Reader) (int, error) {
	data, err := io.ReadAll(pdfReader)
	if err != nil {
		return 0, err
	}

	conf := model.NewDefaultConfiguration()
	ctx, err := api.ReadContext(bytes.NewReader(data), conf)
	if err != nil {
		return 0, err
	}

	return ctx.PageCount, nil
}
