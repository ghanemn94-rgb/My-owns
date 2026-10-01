# P6 report exports — file validation and visual inspection (AT-24, REQ-RPT-007..010)

Recorded 2026-10-01 by the integration-reporting engineer. All data shown is the synthetic Demo sandbox (badged "Demo"
in every file); nothing here is real Mobily information.

## Automated checks (independent parsers, executed)

| What | Test | Parser |
|---|---|---|
| XLSX: genuine workbook, formula triggers stored as text, numbers as numbers, RTL sheets in Arabic | `apps/api/test/reporting/report-exports.spec.ts` | own ZIP reader + XML well-formedness (`test/reporting/ooxml.ts`) |
| PDF en/ar: `%PDF`, bundled IBM Plex fonts embedded, Arabic shaped (contextual forms) and right to left, every section title / record code / figure, classification + page n/N on every page; executive summary one page | `apps/api/test/reporting/at-24-report-exports.spec.ts` | pdf.js (`pdfjs-dist` 5.4.394, dev dependency) |
| PPTX en/ar: OOXML presentation, `rtl="1"` presentation and paragraphs + `lang="ar-SA"` in Arabic, figures and decision codes = snapshot, footer layout with classification and Demo label | same file | own ZIP reader |
| DOCX en/ar minutes: OOXML document (not renamed HTML), `w:bidi` / `w:rtl` / `w:bidiVisual` in Arabic, meeting, attendance, agenda, minutes text and decisions = snapshot, footer with classification and PAGE field | same file | own ZIP reader |
| From the screen (both languages): files requested in the Reports screen, rendered by the worker, downloaded from the screen; bytes identical to the stored file; PDF signature; PPTX / DOCX parts, RTL markup and section titles in Arabic | `e2e/tests/p6-reports.spec.ts` | minimal ZIP reader in the spec |

When no Chromium is available (CI integration job), the PDF tests assert the honest refusal
(`report.export_format_unavailable`, 422) instead of a file; in this environment Chromium is available
(`/opt/pw-browsers/chromium-1194`) and the PDF assertions ran.

## Visual inspection (rendered to PNG and looked at)

Rasterizer: pdf.js 5.4.394 with `@napi-rs/canvas` (system font faces disabled so the embedded fonts are drawn).
Office files: LibreOffice 24.2.7.2 headless (`--convert-to pdf`), then the same rasterizer. LibreOffice has no Arial /
Arabic Office fonts here and substitutes DejaVu, so glyph shapes in the Office images differ from what PowerPoint /
Word show; layout, direction, ordering and completeness are what was inspected.

| File inspected | How it was produced | Image (this folder: `p6-reports/`) | What was seen |
|---|---|---|---|
| Executive summary PDF, Arabic | latest `executive_summary` snapshot of the integration-test database rendered with the worker's code (`buildRenderDoc` + `renderPdf`) | `pdf-executive-summary-ar-p1.png` | One A4 page. Arabic shaped (joined letters, correct initial/medial/final forms) and laid out right to left: headings, metadata block, figure cards and table columns start at the right; Latin codes (G0, DEC-003, ESC-001) and the SHA-256 hash stay left-to-right inside the RTL lines. Classification and Demo chips at the top, "التصنيف: سري · تجريبي …" and "1 / 1" in the footer. Source references now in Arabic ("سجل المعالم · سجل المهام"). Checked at 3× zoom: the first letter of right-edge headings ("أبعاد الحالة", "مراجع المصادر") is not clipped. Long descriptions wrap inside their cells; nothing overlaps. |
| Executive summary PDF, English | same, `en` | `pdf-executive-summary-en-p1.png` | One A4 page, left to right; same sections and figures as the Arabic page (1 / 6 / 3, 0 / 0 / 0 / 0, 2 / 0, 2 / 0); long titles clipped with "…" only in this one-page layout, as designed; footer "Classification: Confidential · Demo — … 1 / 1". |
| Committee pack PDF, Arabic (5 pages) | latest `committee_pack` snapshot, worker code | `pdf-committee-pack-ar-p1.png`, `-p3.png`, `-p5.png` | Every section present in snapshot order with its classification chip; tables repeat their header row on each page; readiness blockers table (p3) with 18 rows wraps Arabic titles cleanly; English demo record texts (evidence notes, decision titles) keep their own direction inside RTL cells; "1 أكتوبر 2026، 5:56 م" ordered correctly; footer with classification and "n / 5" on every page. Observation (data, not rendering): readiness codes such as `employees-employee_arrangements_` are cut because `readiness_check.code` is `varchar(32)` (readiness module). The "→" glyph is not in the bundled subsets and is drawn by a system fallback font. |
| Committee pack PPTX, Arabic (29 slides) | the file the worker produced and the e2e test downloaded from the Reports screen | `pptx-committee-pack-ar-slide1.png`, `-slide4.png` | Title slide right-aligned with classification and Demo lines; metadata as label/value pairs with labels on the right; table slides with the first column at the right (columns mirrored), header row shaded, Arabic cell text wrapped inside the cells, no text outside the slide; footer layout with classification + Demo label and the slide number on every slide. |
| Minutes DOCX, Arabic (2 pages) | the file the worker produced and the e2e test downloaded | `docx-minutes-ar-p1.png` | Right-to-left document: title "المحضر", metadata table and every table with the first column at the right (`bidiVisual`); attendance, agenda and the minutes text (English demo text kept left-to-right in its own paragraph, right-aligned); internal-approval note "اعتماد إلكتروني داخلي — وليس توقيعاً معتمداً قانونياً."; footer "التصنيف: سري · تجريبي …" with the PAGE / NUMPAGES fields (drawn "2 / 1", i.e. read right to left as page 1 of 2; the PDF footers print "n / N" left to right). |

Earlier iterations inspected the same way led to fixes before this record: executive summary reduced to one page (compact
layout), word breaking inside words in PDF tables removed, PPTX column widths sized to the longest word, English
paragraphs inside Arabic DOCX/PPTX given their own direction (punctuation in place), register names in source references
translated (an Arabic file printed "RAID register").

## Screens

The Reports screen in both languages (list, generate / export / BI dialogs, snapshot view, KPI catalogue, BI access) is
captured by `e2e/tests/p6-reports.spec.ts` in `e2e/screenshots/p6/`; the Arabic screens pass the untranslated-text
detector (`e2e/tests/qa-rtl-detector.ts`) and every screen and dialog passes axe (WCAG 2.0/2.1 A + AA, no serious or
critical violation).
