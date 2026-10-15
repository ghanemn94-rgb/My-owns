# packages/reporting — `@mth/reporting` (P5)

Report exporters for the stored report snapshots (ADR-0045, ADR-0046): pure renderer functions run by the worker,
with bilingual labels, spreadsheet formula-injection neutralisation and the export-file store. See ADR-0002 and
ADR-0046 §1.

- `@mth/reporting` (worker only): `render(document, options)`. CSV and XLSX ship with T-DG5-BE-M; PDF, DOCX and PPTX
  are added by T-DG5-BE-N (until then a request for them fails with `export.render_failed`).
- `@mth/reporting/storage` (dependency-free; the API imports only this): the filesystem export-file store under
  `exports/` of the evidence-store root.
