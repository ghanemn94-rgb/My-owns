// The provisional-Arabic label of the P7 catalogue blocks that T-DG7-FE-A added (p7-work-split §C.5, §D.2, §E.5,
// §I.3: "the Arabic is provisional until a qualified reviewer checks it", D-243 Q7).
//
// The catalogues are JSON files (`ar/*.json`), which cannot carry comments, so the label lives here, beside them, as data
// a test checks (i18n/problems-p7.test.ts): every Arabic text of the P7 shell is listed below, and a P7 key that is
// missing from this list fails the test. Every one of them is PROVISIONAL and awaits a Mobily language review:
//  - "work-split": the Arabic is the work split's own text (docs/architecture/p7-work-split.md), used exactly; the work
//    split labels it provisional;
//  - "fe-a": the work split gives no Arabic for this text (a navigation or placeholder text of the shell); the Arabic was
//    written by T-DG7-FE-A;
//  - "be-f": the Arabic was written by T-DG7-BE-F for a text the work split does not give (D-253 item 4).
// When a reviewed translation replaces a text, remove its entry here in the same change. The screens' own namespaces
// (`transfer`, `retention`, `release`) are labelled by FE-B and FE-C in their own files (p7-work-split §I.2).
export type P7ProvisionalArabicSource = "work-split" | "fe-a" | "be-f";

/** Catalogue path (namespace.key, with "__" for "." inside a problem code) -> where the provisional Arabic comes from. */
export const P7_PROVISIONAL_ARABIC: Readonly<Record<string, P7ProvisionalArabicSource>> = {
  // problems.json: §C.5 (slice C), §D.2 (slice D), §E.5 (slice E), §I.3 (slice I); the Arabic is the work split's
  "problems.migration__export_in_progress": "work-split",
  "problems.migration__export_not_ready": "work-split",
  "problems.migration__export_failed": "work-split",
  "problems.config_bundle__schema_version_unsupported": "work-split",
  "problems.config_bundle__too_large": "work-split",
  "problems.config_bundle__checksum_mismatch": "work-split",
  "problems.config_bundle__item_invalid": "work-split",
  "problems.config_bundle__nothing_published": "work-split",
  "problems.config_bundle__unportable_reference": "work-split",
  "problems.config_bundle__not_validatable": "work-split",
  "problems.config_bundle__not_committable": "work-split",
  "problems.config_bundle__plan_changed": "work-split",
  "problems.config_bundle__open_draft_exists": "work-split",
  "problems.config_bundle__reference_missing": "work-split",
  "problems.config_bundle__kind_not_permitted": "work-split",
  "problems.config_bundle__kind_unavailable": "work-split",
  "problems.retention__class_retain_only": "work-split",
  "problems.retention__class_not_archivable": "work-split",
  "problems.retention__class_period_required": "work-split",
  "problems.retention__class_reference_required": "work-split",
  "problems.retention__run_in_progress": "work-split",
  "problems.release__register_snapshot_unavailable": "work-split",
  // The schema-version text without its value (BE-F, D-253 item 4): derived from the work split's sentence.
  "problems.config_bundle__schema_version_unsupported_noParams": "be-f",
  // nav.json: the Administration entries (nav.sub and the server item labels nav.contents.admin)
  "nav.sub.dataExport": "work-split",
  "nav.contents.admin.dataExport": "work-split",
  "nav.sub.migrationStatus": "work-split",
  "nav.contents.admin.migrationStatus": "work-split",
  "nav.sub.configTransfer": "work-split",
  "nav.contents.admin.configTransfer": "work-split",
  "nav.sub.retention": "work-split",
  "nav.contents.admin.retention": "work-split",
  "nav.sub.requirements": "work-split",
  "nav.contents.admin.requirements": "work-split",
  "nav.sub.releaseAbout": "work-split",
  "nav.contents.admin.releaseAbout": "work-split",
  // nav.json: the placeholders of the P7 screens (titles and intros from the work split where it gives them)
  "nav.p7.notAvailableTitle": "fe-a",
  "nav.p7.notAvailableBody": "fe-a",
  "nav.p7.dataExport.title": "work-split",
  "nav.p7.dataExport.summary": "work-split",
  "nav.p7.migrationExport.title": "fe-a",
  "nav.p7.migrationExport.summary": "fe-a",
  "nav.p7.migrationStatus.title": "work-split",
  "nav.p7.migrationStatus.summary": "work-split",
  "nav.p7.migrationImport.title": "fe-a",
  "nav.p7.migrationImport.summary": "fe-a",
  "nav.p7.migrationReconciliation.title": "fe-a",
  "nav.p7.migrationReconciliation.summary": "fe-a",
  "nav.p7.identityRebinds.title": "work-split",
  "nav.p7.identityRebinds.summary": "fe-a",
  "nav.p7.configTransfer.title": "work-split",
  "nav.p7.configTransfer.summary": "work-split",
  "nav.p7.configBundleExport.title": "fe-a",
  "nav.p7.configBundleExport.summary": "fe-a",
  "nav.p7.configBundleImport.title": "fe-a",
  "nav.p7.configBundleImport.summary": "fe-a",
  "nav.p7.retention.title": "work-split",
  "nav.p7.retention.summary": "work-split",
  "nav.p7.retentionClass.title": "fe-a",
  "nav.p7.retentionClass.summary": "fe-a",
  "nav.p7.retentionRun.title": "fe-a",
  "nav.p7.retentionRun.summary": "fe-a",
  "nav.p7.retentionArchived.title": "work-split",
  "nav.p7.retentionArchived.summary": "fe-a",
  "nav.p7.backupSets.title": "work-split",
  "nav.p7.backupSets.summary": "work-split",
  "nav.p7.requirements.title": "work-split",
  "nav.p7.requirements.summary": "work-split",
  "nav.p7.requirement.title": "fe-a",
  "nav.p7.requirement.summary": "fe-a",
  "nav.p7.releaseAbout.title": "work-split",
  "nav.p7.releaseAbout.summary": "fe-a",
};
