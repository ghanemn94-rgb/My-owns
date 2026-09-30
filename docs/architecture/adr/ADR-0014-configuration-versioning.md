# ADR-0014: Configuration versioning: methodology, form and formula versions pinned per transformation (outline)

- **Status:** Proposed outline for DG1. It fixes the data shape so later stages add tables without breaking P1 contracts. The detailed design comes in P2 (methodology/forms) and P4/P5 (formulas, Studio).
- **Date:** 2026-09-30. **Author:** solution-architect.
- **Requirements:** REQ-S16-010, REQ-S16-012 (increment), REQ-S16-022 (increment), REQ-S12-004 (increment), REQ-S06-010.

## Decision (outline)

1. **Immutable published versions.** `methodology_version`, `form_schema_version`, `benefit_formula_version`/`kpi_formula_version` and `automation_rule_version` rows have:
   - a stable `key`;
   - a monotonically increasing `version_no`;
   - `status` (draft → published → retired);
   - `published_at` and `published_by`;
   - a content hash;
   - a validated JSON `definition`, checked against a **meta-schema** stored with the platform release. This is never an unvalidated blob (§16).

   Published rows are immutable: a trigger rejects UPDATE of `definition` once `status = 'published'`.
2. **Pinning.** When a transformation is created (the P1 outbox event `transformation.created`), the P2 starter automation records a `transformation_config_pin` per configuration kind: `(transformation_id, kind, version_id)`. Records created under the transformation keep a reference to the form or formula version they were captured or calculated with. Report snapshots store all the versions used (§13).
3. **Migration of a pinned transformation** to a newer version is an explicit, previewed and audited change request, approved per the permissions matrix row "Methodology migration of a pinned transformation". It is never automatic.
4. **Custom fields** live in `custom_field_values jsonb` columns validated against the pinned form schema version. Core entities stay typed relational columns.
5. **Admin separation (REQ-S06-010).** Methodology admins (ADM_METHOD) draft and publish. Publishing a change that affects policy or finance needs a business approver through the workflows module. Technical admins can never approve (ADR-0006).

## P1 impact

- No P1 tables.
- The `transformation` table does **not** get pin columns (forward-only migrations add `transformation_config_pin` in P2). This keeps P1 free of unused nullable columns.
- The outbox payload of `transformation.created` (schema_version 1) includes `mode`, `entryPhase` and `standaloneDeliverableType`, which the P2 handler needs.
