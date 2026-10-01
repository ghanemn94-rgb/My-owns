# ADR-0011 — Report snapshots and genuine Office/PDF outputs

- Status: Accepted · Date: 2026-09-29
- Requirements: spec §11, AT-24

## Decision
Reports are generated in two steps: (1) a `report_snapshot` freezes the figures (payload JSON + content hash; immutable
by trigger); (2) renderers produce files *from the snapshot only*: XLSX (exceljs), DOCX (docx, with RTL paragraphs for
Arabic), PPTX (pptxgenjs, rtlMode for Arabic), PDF (HTML template → headless Chromium with bundled Arabic/Latin fonts).
Outputs are validated by parsing (zip/OOXML parts, PDF header) in tests; Arabic PDFs are rasterized for visual checks.
Permissions are re-checked on every snapshot view/export.

## Amendment (P6 implementation, 2026-10-01)
- **One generation route.** `POST /api/v1/projects/:projectId/report-snapshots` with `{ kind, workstreamId?, meetingId? }`
  replaces the per-type `…/reports/{type}/generate` routes named in the traceability matrix (same kinds: executive summary,
  committee pack, weekly workstream, look-ahead, Day-1, TSA exit, JV closing, health & data quality, minutes). Committee
  packs and minutes are committee records and also need `reports.snapshot.create`.
- **Generation runs in the request, files in the worker.** A snapshot is built synchronously inside the requester's own
  transaction, so every query applies the requester's visibility, workstream reach and clearance in SQL (RLS on top); no
  queued job ever holds another principal's access. Tables keep at most 200 rows (`totalRows` / `truncated` say so). File
  rendering is a worker job (`reporting.render_export`) that re-resolves the requester before rendering and again before
  publishing (AT-19); without current access the export is cancelled and nothing is stored.
- **Access model — per section, re-checked on every read.** Each section of the payload records the read permission(s)
  of its records, their highest classification, the finance domain where relevant and the workstream reach it was built
  with (`report_snapshot.sections`). Reading, listing, comparing, exporting and downloading re-check the viewer's CURRENT
  access per section: a section the viewer no longer covers is returned as `included: false` with no content (no counts,
  titles or figures); outside the project, without `reports.snapshot.read`, or with no section left → 404. This is how
  "access requires current permission for the snapshot's classifications" (REQ-RPT-017) is applied without leaking
  anything: the classification shown is the maximum of the sections the viewer may see.
- **Downloads** go through `GET …/report-exports/:exportId/download` (session cookie, audited), only for the requester,
  after re-checking every section the file contains and the stored SHA-256; responses are attachments with `nosniff`,
  `Content-Security-Policy: sandbox` and `no-store`. No pre-signed or public URL is issued (instead of the "short-lived
  authorized URL" of the matrix); nothing is ever sent outside the platform (REQ-INT-011).
- **Fonts and PDF.** IBM Plex Sans / IBM Plex Sans Arabic (SIL OFL, `@fontsource/*`) are embedded into the HTML as data
  URLs; Chromium runs offline (every request aborted). Production needs the `api-chromium` image (`HUB_CHROMIUM_PATH`) for
  the worker; without it PDF requests are refused with `report.export_format_unavailable` (422) — never a fake file.
  Glyphs outside the bundled subsets (e.g. "→") fall back to a system font.
- **Labels.** Files and the Reports screen use the same texts: `apps/api/src/modules/reporting/render/labels.ts` and
  `apps/web/src/i18n/messages/{en,ar}/reports.json` (`content`) are kept identical by `report-labels.spec.ts`.
- **BI.** Read-only `bi` views for a restricted `hub_bi` database role, exposed per project by its sponsor
  (docs/architecture/bi-views.md). No BI connection is ever reported as working.
- **Governance meeting packs** (`report_snapshot` rows written by the governance module without `schema_version`) stay
  governance records: the reporting routes neither list nor export them.
