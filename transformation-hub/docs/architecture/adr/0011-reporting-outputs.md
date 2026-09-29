# ADR-0011 — Report snapshots and genuine Office/PDF outputs

- Status: Accepted · Date: 2026-09-29
- Requirements: spec §11, AT-24

## Decision
Reports are generated in two steps: (1) a `report_snapshot` freezes the figures (payload JSON + content hash; immutable
by trigger); (2) renderers produce files *from the snapshot only*: XLSX (exceljs), DOCX (docx, with RTL paragraphs for
Arabic), PPTX (pptxgenjs, rtlMode for Arabic), PDF (HTML template → headless Chromium with bundled Arabic/Latin fonts).
Outputs are validated by parsing (zip/OOXML parts, PDF header) in tests; Arabic PDFs are rasterized for visual checks.
Permissions are re-checked on every snapshot view/export.
