# PDF Editor Competitive Feature Research

**Purpose:** Reference for a product team building a browser-based PDF editor. This catalogs the concrete *editing / creation / annotation* capabilities of the leading PDF tools, then ranks what a browser-based editor should implement by value vs. effort, flagging what is realistically doable client-side (pdf-lib + pdf.js) vs. what needs a backend or native libraries.

**Last updated:** 2026-07 · **Scope:** capabilities only, not pricing.

---

## 1. Products surveyed

| Product | Platform | Positioning | Engine / notes |
|---|---|---|---|
| **Adobe Acrobat Pro** | Win/Mac desktop + web + mobile | The gold standard; defines the feature ceiling | Adobe's own PDF Library; AI-assisted edit engine, AI Assistant, Liquid Mode |
| **Foxit PDF Editor (Pro)** | Win/Mac + web + mobile | Closest full-featured Acrobat challenger | Foxit's own engine; strong on collaboration, ConnectedPDF, AIP |
| **Nitro PDF Pro** | Win/Mac + web (Nitro Sign) | Business-focused Acrobat alternative | Own engine; Nitro Sign e-sign platform, AI Smart Redact |
| **PDF-XChange Editor** | Windows only | Power-user favorite, lightweight, deep feature set | ABBYY FineReader OCR engine; free tier with watermark on premium tools |
| **Sejda PDF** | Web + desktop | Simple, privacy-friendly web editor | Server-side processing; task/hour limits on free tier |
| **Smallpdf** | Web + desktop + mobile | Polished web tool *suite* (30+ discrete tools) | Server-side; task-per-day limits on free |
| **iLovePDF** | Web + desktop + mobile | Web tool *suite* (25+ tools), developer API | Server-side; also an API product |
| **Xodo (by Apryse)** | Web + desktop + mobile | Web editor built on a commercial SDK | Apryse (PDFTron) WebViewer SDK; much runs in-browser (WASM) |
| **PDFescape** | Web + desktop | Lightweight free form-filler / annotator | Server-side; 10 MB / 100-page free cap; real editing only in desktop tier |
| **Apple Preview** | macOS (bundled) | Lightweight baseline everyone already has | Apple PDFKit; no existing-text editing, but solid markup/forms/signing |

Two archetypes matter for us: **monolithic editors** (Acrobat, Foxit, Nitro, PDF-XChange, Xodo) that open one document into a rich editing canvas, and **tool suites** (Smallpdf, iLovePDF) that expose each operation — merge, split, compress, sign — as a separate single-purpose web tool. A browser product can blend both: a canvas editor plus a "tools" launcher.

---

## 2. Capability deep-dive by area

### 2.1 Viewing / navigation

The leaders (Acrobat, Foxit, PDF-XChange, Nitro) all provide: page **thumbnails** panel, **bookmarks/outline** panel, **single-page / continuous scroll / two-up (facing) / cover** layouts, **zoom** (fit-width, fit-page, fit-visible, marquee zoom, actual size, custom %), **rotate view**, **full-screen / presentation** mode, and a distraction-free **Read Mode**. Acrobat adds **Liquid Mode** — AI-driven responsive reflow that re-lays-out a PDF for phone screens with collapsible sections and adjustable font size. PDF-XChange has an unusually powerful **Loupe** and **Pan & Zoom** window, plus split-view (horizontal/vertical/spreadsheet-style tabs). Foxit offers **split view** and a **rendition/reflow** view. Apple Preview covers thumbnails, contact-sheet, continuous scroll, and zoom but is comparatively minimal. Xodo (web) provides thumbnails, continuous scroll, zoom, and a night/reading mode in-browser.

**Common baseline:** thumbnails, continuous scroll, zoom modes, rotate-view, search, outline navigation, page-number "go to".

### 2.2 Text: editing existing text, adding text, rich text

This is the hardest and most differentiating area.

- **Editing existing PDF text (in place):** Acrobat, Foxit, Nitro, and PDF-XChange can click into an existing text block, retype, and have the paragraph **reflow** within its bounding box; they attempt **font matching** (detect the font, and if the exact font isn't installed, substitute or offer to use a matched font). Acrobat's newest AI edit engine improves detection of text blocks, images and fonts, and auto-reflows paragraphs. Foxit advertises "text that automatically reflows as you type, just like a word processor," including paragraph-mode editing across lines. PDF-XChange edits text and can **change font, size, color, and spacing** of existing content.
- **Sejda** offers a lighter form: it edits existing text (bold/italic, font size, family, color) and **find & replace**, but explicitly **cannot edit scanned/image PDFs** and struggles with complex embedded fonts — it often adds a new text layer rather than truly reflowing.
- **Smallpdf / iLovePDF / PDFescape (free) / Xodo / Apple Preview:** effectively **cannot edit existing body text**. They let you **add** a new text box on top (overlay). PDFescape's *desktop/premium* tier and Xodo (via the Apryse SDK) do offer real existing-text editing; the free web tiers do not. Apple Preview has no existing-text editing at all.
- **Adding new text:** universal — every product can drop a text box with chosen font, size, color, alignment.
- **Rich text / lists / paragraph controls:** Acrobat and Foxit support bulleted/numbered **lists**, line spacing, horizontal scaling, and multi-column awareness. Most web tools offer only basic font/size/color/bold/italic.
- **Fonts & Unicode:** Acrobat/Foxit/PDF-XChange embed and subset fonts and handle Unicode / non-Latin scripts (with the right fonts). A critical client-side gotcha: **pdf-lib's standard fonts are Helvetica-family Latin-only**; non-Latin text requires embedding a Unicode font (e.g., via `fontkit`).

### 2.3 Objects / annotations / markup

All serious editors converge on a rich annotation set (these are the PDF standard annotation types, so they're portable):

| Annotation | Acrobat | Foxit | Nitro | PDF-XChange | Sejda | Xodo | PDFescape | Preview |
|---|---|---|---|---|---|---|---|---|
| Highlight / underline / strikeout / squiggly (text markup) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Sticky note / text comment | ✅ | ✅ | ✅ | ✅ | ~ | ✅ | ✅ | ✅ |
| Freehand / ink drawing | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ~ | ✅ |
| Shapes (rect, ellipse, line, arrow, polygon, polyline, cloud) | ✅ | ✅ | ✅ | ✅ | ~ (rect/ellipse) | ✅ | ✅ | ✅ (some) |
| Callout / text box with leader | ✅ | ✅ | ✅ | ✅ | ✗ | ~ | ~ | ✗ |
| Stamps (static + **dynamic** date/user) | ✅ | ✅ | ✅ | ✅ (JS dynamic stamps) | ~ | ✅ | ~ | ✗ |
| Custom / image stamps | ✅ | ✅ | ✅ | ✅ | ✗ | ✅ | ✗ | ✗ |
| Measure tools (distance/perimeter/area, scale calibration) | ✅ | ✅ | ~ | ✅ | ✗ | ✅ | ✗ | ✗ |
| Attach file / attach audio | ✅ | ✅ | ~ | ✅ | ✗ | ~ | ✗ | ✗ |
| Text-callout "whiteout"/redact-look cover | ✅ | ✅ | ✅ | ✅ | ✅ (whiteout) | ✅ | ~ | ✗ |

Notes: Acrobat, Foxit, and PDF-XChange all support **dynamic stamps** that inject the current date/author/time via JavaScript. PDF-XChange lets you **build a stamp from selected page content**. Measure tools (with scale calibration) matter for engineering/CAD users and are present in Acrobat, Foxit, PDF-XChange, and Xodo. Apple Preview covers the everyday markup subset (highlight, notes, shapes, freehand, signature) but lacks callouts, dynamic stamps, and measure.

### 2.4 Images & links

- **Insert/replace/resize/crop/rotate/flip images:** Acrobat, Foxit, Nitro, PDF-XChange full support; Sejda and Xodo can insert (and Xodo edit) images; Smallpdf/iLovePDF handle image↔PDF conversion but not in-place image editing; Preview can drag images onto a page.
- **Image extraction / export all images:** Acrobat, Foxit, PDF-XChange.
- **Links:** create/edit **hyperlinks** (URL, go-to-page, named destination, run action), auto-detect URLs, and **web-to-PDF link preservation** in Acrobat/Foxit/PDF-XChange/Nitro. Sejda can add/edit links. Most web suites don't offer link editing.

### 2.5 Pages / document assembly

Nearly universal, and the **highest-ROI, lowest-risk** area for a web editor.

| Operation | Acrobat | Foxit | Nitro | PDF-XChange | Sejda | Smallpdf | iLovePDF | Xodo | PDFescape | Preview |
|---|---|---|---|---|---|---|---|---|---|---|
| Insert / delete / reorder pages | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Rotate pages (persisted) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Merge / combine (multi-file, reorder) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ~ | ✅ |
| Split (by count / bookmarks / size / ranges) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ~ | ~ |
| Extract pages to new PDF | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ~ | ✅ |
| Crop pages / set boxes | ✅ | ✅ | ✅ | ✅ | ✅ | ✗ | ✗ | ✅ | ~ | ✅ (crop) |
| Page numbering (Bates) | ✅ (**Bates**) | ✅ (Bates) | ✅ | ✅ (Bates) | ✅ (basic) | ✗ | ✅ (basic) | ~ | ✗ | ✗ |
| Headers / footers | ✅ | ✅ | ✅ | ✅ | ✅ | ✗ | ✗ | ~ | ✗ | ✗ |
| Watermark (text/image) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ~ | ✗ |
| Backgrounds | ✅ | ✅ | ✅ | ✅ | ~ | ✗ | ✗ | ~ | ✗ | ✗ |

**Bates numbering** (legal-grade sequential IDs across a document set, with prefix/suffix and configurable digits) is a differentiator present in Acrobat, Foxit, Nitro, and PDF-XChange. Acrobat can apply Bates across a *batch* of files. This is a distinctly professional/legal feature.

### 2.6 Forms (AcroForm)

- **Field types:** text, checkbox, radio, list box, combo/dropdown, push button, signature field, and (legacy) barcode. Full support: Acrobat, Foxit, Nitro, PDF-XChange (Plus tier), Xodo. Sejda and PDFescape support the common set (text, checkbox, radio, dropdown, list, buttons). Apple Preview **fills** forms (incl. macOS AutoFill of name/address) but does not **create** fields.
- **Form creation:** design fields with properties (tooltip, default value, formatting category — number/date/percent/special, validation, appearance).
- **Auto field detection:** Acrobat's "Prepare Form" auto-detects likely fields (including from flat/scanned forms via OCR). Foxit and PDF-XChange have equivalents ("Run Form Field Recognition" / "Identify Form Fields" converting flat forms to interactive).
- **Field calculations / JavaScript:** Acrobat, Foxit, PDF-XChange support calculation order, simple field arithmetic, and full document/field-level **JavaScript**. This powers auto-totaling invoices, conditional logic, etc.
- **XFA:** Acrobat and Foxit can *render/fill* XFA (LiveCycle) forms; most others (and pdf-lib) do not.
- **Form data:** import/export **FDF, XFDF**, and often CSV; Acrobat can aggregate many returned forms into a spreadsheet. This is important for round-tripping filled data without shipping whole PDFs.
- **Fill & Sign:** a simplified "type anywhere + checkmarks + signature" mode exists in Acrobat, Foxit, Nitro, Sejda, Xodo, PDFescape, and (via AutoFill) Preview.

### 2.7 Signatures

Two distinct things, often conflated:

1. **Electronic signature (drawn/typed/image "wet" signature or e-sign workflow):** everyone. Apple Preview captures signatures via trackpad, camera, or iPhone. Nitro Sign, Xodosign, Acrobat Sign, and Foxit eSign add **multi-party request-signature workflows** with audit trails, envelopes, and status tracking.
2. **Digital / certificate signatures (cryptographic, PKI):** Acrobat, Foxit, Nitro, PDF-XChange sign with a digital ID (PKCS#12), embed the certificate, support **document timestamps (RFC 3161 TSA)**, **LTV (long-term validation)**, and **signature validation** against trust stores. Nitro Sign advertises tiered assurance (SES / AES / QES). These are eIDAS/legal-grade. Web suites and Preview generally do **not** do certificate signing.

### 2.8 Redaction (true content removal)

- **True redaction** (permanently removing the underlying text/image, not just drawing a black box): Acrobat, Foxit, Nitro, PDF-XChange, and Xodo. Acrobat offers **Find Text & Redact** with built-in patterns (SSN, phone, email, credit-card, dates) and redaction "profiles." Nitro's **AI Smart Redact** auto-detects 30+ PII types. Foxit supports search-and-redact profiles and pixelation; PDF-XChange offers blurred/pixelated overlays.
- **Sanitize / remove hidden data:** strip metadata, hidden layers, embedded scripts, attachments, comments, form data, deleted-but-recoverable content. Acrobat "Sanitize Document" / "Remove Hidden Information"; Foxit and Nitro have equivalents.
- **Web/free tools:** PDFescape free and Smallpdf/iLovePDF do **not** do true redaction (a drawn box that still has selectable text underneath is a common, dangerous fake-redaction pitfall). Sejda offers whiteout (cosmetic) not true redaction.

### 2.9 OCR (scanned → searchable/editable)

- **Full OCR:** Acrobat (multi-language, handwriting in newest engine), Foxit (industry OCR + "Find All Suspect" correction UI, 25+/many languages), Nitro (upgraded engine, noisy-scan tolerant), PDF-XChange (**ABBYY FineReader** engine, 190+ languages incl. Arabic/Hebrew, table detection). Xodo/Apryse and Sejda offer OCR. Smallpdf and iLovePDF offer OCR on **premium** tiers.
- **Two modes:** "searchable image" (invisible text layer over the scan, preserves appearance) vs. "editable" (reconstruct fonts/layout for editing). Acrobat/Foxit/PDF-XChange do both.
- **Apple Preview / PDFescape free:** no OCR (though macOS Live Text can copy text from images system-wide, that's not Preview making a searchable PDF).

### 2.10 Compare, organize, optimize/compress, Office export, PDF/A

- **Compare two documents:** Acrobat (side-by-side, content + formatting diff report), Foxit, Nitro (review report, light/dark). Not in the lightweight/web tools generally.
- **Optimize / compress:** reduce image resolution, subset fonts, discard objects. Acrobat "PDF Optimizer" + "Reduce File Size"; Foxit, Nitro, PDF-XChange; and this is a flagship **web-suite** tool (Smallpdf, iLovePDF, Sejda all compress).
- **Export to Office (Word/Excel/PowerPoint) & images:** Acrobat, Foxit, Nitro, PDF-XChange (to Word), plus web suites (Smallpdf, iLovePDF) — usually **server-side conversion**. Fidelity varies; tables/columns are the hard part.
- **Create PDF from Office/images/web/scanner:** Acrobat, Foxit, Nitro (virtual printer + native converters); web suites convert uploads.
- **PDF/A (archival) and PDF/UA (accessibility) conformance + Preflight:** Acrobat Pro has a full **Preflight** engine (profiles, fixups, standards validation, conversion to PDF/A-1/2/3, PDF/X). Foxit and PDF-XChange offer PDF/A conversion/validation. This is a pro/enterprise differentiator.

### 2.11 Accessibility

Acrobat is far ahead: **auto-tag**, **Reading Order tool** (touch-up reading order, mark regions as heading/text/figure/table), **alt text** for figures, **table editor**, **Accessibility Checker** (full report against PDF/UA & WCAG), and **Action Wizard** to batch-tag/set-reading-order/add-alt-text for compliance. Foxit and Nitro have accessibility checkers and tagging; PDF-XChange is weaker here. Web tools and Preview essentially don't address structural accessibility. Accessibility is **hard** (semantic structure, not just visuals) and a genuine moat feature.

### 2.12 Collaboration / comments / review

Acrobat: **shared reviews** (comment collection, @mentions, cloud "Share for comments"), comment list with filters/status/reply threads, comment summary export. Foxit: **ConnectedPDF** and shared review, strong real-time/team collaboration positioning. Nitro and Xodo: cloud sharing + comment collection and e-sign routing. Web suites are largely single-user. Threaded comments with reply/status/@mention is table-stakes for a modern collaborative editor.

### 2.13 Security

- **Password protection:** open (user) password + permissions (owner) password. Acrobat, Foxit, Nitro, PDF-XChange, Sejda, Smallpdf, iLovePDF (protect/unlock tools), Xodo, Preview (export with password).
- **Encryption:** RC4/AES-128/**AES-256**; certificate-based encryption (encrypt for specific recipients' public keys) in Acrobat/Foxit.
- **Permissions:** restrict printing (and print quality), copying, editing, form-filling, commenting, extraction for accessibility.
- **Enterprise DRM:** Acrobat + Adobe Experience Manager / LiveCycle Rights Management; Foxit + **Microsoft AIP** (Azure Information Protection) integration.

### 2.14 Automation / actions / batch

Acrobat **Action Wizard**: record a sequence (OCR → optimize → watermark → Bates → redact-pattern → save/export) and run it across folders of files, with prompts. Foxit and PDF-XChange have batch/command-line processing. Web suites are inherently per-tool but iLovePDF and Smallpdf expose **developer APIs** for programmatic batch. Acrobat also exposes a **JavaScript API** and (historically) an SDK/IAC for scripting. Nitro offers workflow automation around signing.

---

## 3. Master feature × product matrix (headline capabilities)

Legend: ✅ full · ~ partial/limited/premium-gated · ✗ none

| Capability | Acrobat Pro | Foxit | Nitro | PDF-XChange | Sejda | Smallpdf | iLovePDF | Xodo | PDFescape | Preview |
|---|---|---|---|---|---|---|---|---|---|---|
| Edit existing text (reflow, font-match) | ✅ | ✅ | ✅ | ✅ | ~ | ✗ | ✗ | ✅ | ~ (desktop) | ✗ |
| Add text / images overlay | ✅ | ✅ | ✅ | ✅ | ✅ | ~ | ~ | ✅ | ✅ | ✅ |
| Annotations & markup (full set) | ✅ | ✅ | ✅ | ✅ | ~ | ~ | ~ | ✅ | ~ | ~ |
| Page assembly (merge/split/reorder/rotate/crop) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ~ | ~ |
| Watermark / header-footer / Bates | ✅ | ✅ | ✅ | ✅ | ~ | ~ | ~ | ~ | ✗ | ✗ |
| Form fill | ✅ | ✅ | ✅ | ✅ | ✅ | ~ | ~ | ✅ | ✅ | ✅ |
| Form creation + auto-detect + JS calc | ✅ | ✅ | ✅ | ✅ | ~ | ✗ | ✗ | ~ | ~ | ✗ |
| E-signature (draw/type) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Certificate/digital signing + timestamp | ✅ | ✅ | ✅ | ✅ | ✗ | ✗ | ✗ | ~ | ✗ | ✗ |
| Request-signature workflow | ✅ | ✅ | ✅ | ~ | ✗ | ✅ | ~ | ✅ | ✗ | ✗ |
| True redaction | ✅ | ✅ | ✅ | ✅ | ✗ | ✗ | ✗ | ✅ | ~ (desktop) | ✗ |
| Sanitize / remove hidden data | ✅ | ✅ | ✅ | ~ | ✗ | ✗ | ✗ | ~ | ✗ | ✗ |
| OCR | ✅ | ✅ | ✅ | ✅ (ABBYY) | ✅ | ~ | ~ | ✅ | ✗ | ✗ |
| Compare documents | ✅ | ✅ | ✅ | ~ | ✗ | ✗ | ✗ | ~ | ✗ | ✗ |
| Compress / optimize | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ~ | ~ |
| Export to Office | ✅ | ✅ | ✅ | ~ | ~ | ✅ | ✅ | ✅ | ✗ | ✗ |
| PDF/A + Preflight | ✅ | ✅ | ~ | ✅ | ✗ | ✗ | ✗ | ~ | ✗ | ✗ |
| Accessibility (tag/reading-order/checker) | ✅ | ✅ | ~ | ~ | ✗ | ✗ | ✗ | ~ | ✗ | ✗ |
| Comments / shared review | ✅ | ✅ | ✅ | ~ | ~ | ~ | ✗ | ✅ | ~ | ✗ |
| Passwords / permissions / AES-256 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ~ | ~ |
| Batch / actions / automation | ✅ | ✅ | ~ | ✅ | ~ | API | API | ~ | ✗ | ✗ |

---

## 4. What a browser-based editor should implement — ranked by value vs. effort

The strategic question is what runs **client-side** (pdf-lib for writing/manipulating the PDF byte stream, pdf.js for rendering + text/annotation layers) vs. what needs a **backend/native** service. Client-side is cheaper to run, private (files never leave the browser — a real selling point à la Xodo/Sejda), and offline-capable; backend is unavoidable for OCR, high-fidelity Office conversion, and heavy image processing.

### 4.1 Feasibility reference

| Feature | Client-side with pdf-lib + pdf.js? | Notes |
|---|---|---|
| Render, zoom, thumbnails, continuous scroll, search | ✅ pdf.js core | pdf.js is purpose-built for this |
| Page assembly (merge/split/reorder/delete/rotate/extract) | ✅ pdf-lib | `copyPages`, `removePage`, `insertPage`, `setRotation` — rock solid |
| Crop pages | ✅ pdf-lib | set `CropBox`/`MediaBox` |
| Add text/image overlays, shapes, lines | ✅ pdf-lib `drawText/drawImage/drawRectangle` + pdf.js overlay UI | embed fonts via `fontkit` for Unicode |
| Watermark / header-footer / page numbers / Bates | ✅ pdf-lib | draw on each page; Bates is just formatted counters |
| Annotations (highlight, note, ink, shapes, stamps) | ✅ pdf.js editor layer + pdf-lib to persist as real annotation objects | pdf.js's built-in editor persists a *subset* (freetext, ink, highlight, stamp); for full fidelity/portability, write standard annotation dicts via pdf-lib |
| Form **filling** (set field values, flatten) | ✅ pdf-lib `PDFForm` | text/checkbox/radio/dropdown/listbox supported |
| Form **creation** (add fields) | ✅ pdf-lib | can create fields + basic appearances; **no XFA** |
| Form field JS calculations | ~ partial | you can *store* JS actions, but executing calc logic = your own JS engine; pdf-lib won't run it |
| Drawn/typed/image e-signature (visual) | ✅ pdf-lib | draw signature image + optional signature field |
| Password / permissions / encryption | ~ | pdf-lib's encryption support is limited; robust **AES-256 + permissions** is safer server-side or via a WASM lib |
| **Certificate (PKI) digital signing + timestamp** | ~/✗ | needs crypto + TSA calls; doable with WASM/JS crypto but complex; often backend |
| **Edit EXISTING text (reflow, font-match)** | ✗ (mostly) | pdf-lib explicitly **cannot edit page text outside form fields**; pdf.js can't either. This is the single biggest gap — needs a heavy engine (WASM like Apryse/PDFium-based, or backend). "Redact-and-retype" hacks are brittle |
| **True redaction** (remove underlying content) | ~/✗ | drawing a box is easy and **wrong**; truly removing text/image operators from content streams needs deep parsing — realistically a WASM/native or backend job |
| **OCR** | ~ | Tesseract.js (WASM) works client-side but is slow/heavy for large docs; a backend (Tesseract/ABBYY/cloud) is better for quality + speed |
| **Export to Office (Word/Excel/PPT)** | ✗ | high-fidelity layout reconstruction — backend/native or 3rd-party API |
| Compress/optimize (image downsampling, font subsetting) | ~ | font-subsetting works client-side; aggressive image recompression better with backend/WASM codecs |
| Compare documents | ~ | text-diff via pdf.js text extraction is feasible client-side; visual/pixel diff heavier |
| Accessibility tagging / reading order | ~/✗ | pdf-lib can write structure tags but there's no ergonomic tooling; genuinely hard, likely a later native/backend effort |
| Sanitize / remove hidden data | ~ | can strip metadata/attachments/JS with pdf-lib; thorough sanitize is nuanced |

### 4.2 Recommended build order (value ÷ effort)

**Tier 1 — Do first (high value, low effort, fully client-side).** These match what Smallpdf/iLovePDF/Sejda built their businesses on, and they're where pdf-lib + pdf.js shine:

1. **Viewer** — thumbnails, continuous scroll, zoom modes, search, outline. (pdf.js) Foundation for everything.
2. **Page organizer** — merge, split, reorder (drag thumbnails), delete, rotate, extract, crop. Highest ROI feature in the entire space; nearly every product has it and users constantly need it.
3. **Add text & image overlays** + basic **shapes/lines**. Covers the "add a note / fill a flat form / stamp a logo" long tail. Embed a Unicode font from day one.
4. **Annotations & markup** — highlight/underline/strikeout, sticky notes, freehand ink, rectangle/ellipse/arrow, using pdf.js's editor layer, persisted as real PDF annotations.
5. **Watermark, header/footer, page numbering (incl. Bates)**. Cheap to build, professionally valuable (Bates especially for legal).
6. **Form fill + flatten**. pdf-lib handles it; huge everyday utility.
7. **Draw/type/upload e-signature + Fill & Sign mode**. Universally expected; visual (not PKI) signing is easy.
8. **Compress / optimize** (font subset client-side; offer a backend path for heavy image recompression).
9. **Passwords / permissions** (basic protect & unlock).

**Tier 2 — Differentiators (medium effort).**

10. **Form builder** — add fields with properties + **auto field-detection** for flat forms (detection ideally backend/ML). Form-field calculations as a later add.
11. **Comments / shared review** — threaded comments, reply, status, @mention. Needs your own collaboration backend but is a strong modern-editor selling point and where the incumbents feel dated.
12. **Compare documents** (text diff client-side, visual diff later).
13. **FDF/XFDF import-export** for round-tripping form data.
14. **Sanitize / remove metadata & hidden data**.

**Tier 3 — Hard but high-value moats (need backend or WASM/native).** Prioritize by your target user:

15. **Edit existing text with reflow + font matching** — the #1 thing users expect from a "real PDF editor" and the hardest to do client-side. Requires a heavy engine (PDFium/WASM, a commercial SDK like Apryse — the same one Xodo uses — or a backend). If you want to compete with Acrobat/Foxit head-on, this is the gate.
16. **True redaction + sanitize** — must actually remove content; do it server-side or via WASM. Ship redaction *only* when it genuinely removes data, or you create a security-liability feature.
17. **OCR** — Tesseract.js for a free client-side tier; backend/cloud OCR for quality and large files. Enables searchable scans + editing scanned docs.
18. **Export to Office** — backend/3rd-party conversion; users want it but it's rarely their primary tool.
19. **Certificate/PKI digital signatures + timestamps + LTV**, and **PDF/A + Preflight**, and **accessibility tagging/reading-order/checker** — enterprise/legal/compliance moats; build only when chasing those segments. Accessibility in particular is a growing regulatory requirement (WCAG/PDF-UA, EU accessibility act) and a defensible differentiator few web tools touch.

### 4.3 Strategic notes

- **Privacy as positioning:** Xodo and Sejda advertise "files processed in your browser / not stored on our servers." Doing Tier 1 fully client-side lets you make the same claim — a real differentiator vs. Smallpdf/iLovePDF, whose everything is a server upload.
- **Blend the two archetypes:** ship a canvas editor *and* a "tools" grid (merge, split, compress, sign…) so single-task users and power users are both served.
- **Fonts are the first landmine:** wire in `@pdf-lib/fontkit` and bundle at least one broad-Unicode font before you let users type, or non-Latin/emoji input silently breaks.
- **Don't ship fake redaction.** A black rectangle over still-extractable text is the classic embarrassing PDF failure. Gate the redaction UI behind real content removal (backend/WASM).
- **The existing-text-editing gap is decisive.** If the product must feel like "a real PDF editor," budget for a heavy engine early; if it's positioned as "annotate, assemble, fill, sign, and organize" (Tier 1+2), you can be excellent entirely client-side and skip that cost.

---

## 5. Sources

- Adobe Acrobat Pro: [acrobat-pro](https://www.adobe.com/acrobat/acrobat-pro.html), [redaction help](https://helpx.adobe.com/acrobat/desktop/protect-documents/redact-pdfs/text-redaction-properties.html), [reading order tool](https://helpx.adobe.com/acrobat/using/touch-reading-order-tool-pdfs.html), [accessibility](https://helpx.adobe.com/acrobat/using/create-verify-pdf-accessibility.html), [Bates numbering](https://helpx.adobe.com/acrobat/desktop/edit-documents/apply-bates-numbering/add-bates.html), [batch/Action Wizard](https://mapsoft.com/posts/batch-processing-acrobat.html), [Acrobat review 2025](https://www.techbloat.com/adobe-acrobat-pro-review-2025-new-features.html)
- Foxit PDF Editor: [advanced editing](https://www.foxit.com/pdf-editor/advanced-editing/), [Pro datasheet](https://cdn01.foxitsoftware.com/pub/foxit/datasheet/phantom/en_us/Foxit-PDF-Editor-Pro.pdf), [version history](https://www.foxit.com/pdf-editor/version-history.html)
- Nitro PDF Pro: [OCR](https://www.gonitro.com/ocr), [PDF editor](https://www.gonitro.com/pdf-editor), [review](https://thebusinessdive.com/nitro-pdf-pro-review)
- PDF-XChange Editor: [features](https://www.pdf-xchange.com/product/pdf-xchange-editor/features-group/4/features), [v11 notes](https://www.neowin.net/software/pdf-xchange-editor-11000/)
- Sejda: [PDF editor](https://www.sejda.com/pdf-editor), [OCR](https://www.sejda.com/ocr-pdf)
- Smallpdf: [tools](https://smallpdf.com/pdf-tools) · iLovePDF: [home](https://www.ilovepdf.com/)
- Xodo/Apryse: [online editor](https://xodo.com/pdf-editor), [Apryse product](https://apryse.com/products/xodo)
- PDFescape: [features](https://www.pdfescape.com/what/features/)
- Apple Preview: [annotate](https://support.apple.com/guide/preview/annotate-a-pdf-prvw11580/mac), [fill & sign forms](https://support.apple.com/guide/preview/fill-out-and-sign-pdf-forms-prvw35725/mac)
- pdf-lib: [GitHub/README](https://github.com/Hopding/pdf-lib), [PDFForm API](https://pdf-lib.js.org/docs/api/classes/pdfform) · pdf.js: [FAQ](https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions)
