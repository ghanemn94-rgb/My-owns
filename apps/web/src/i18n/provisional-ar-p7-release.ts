// The provisional-Arabic label of the `release` namespace (T-DG7-FE-C; p7-work-split §I.2, §I.3: "the Arabic is
// provisional until a qualified reviewer checks it"; D-243 Q7). The catalogue is JSON and cannot carry comments, so the
// label lives here as data. pages/admin/requirements/release-screens.test.tsx checks that every Arabic leaf of
// `release` is listed here exactly once, and that each entry marked "work-split" equals the §I.3 cell exactly. Every
// entry is listed explicitly (one quoted key per line), so tools/release/release-notes.mjs counts them exactly. When a
// reviewed translation replaces a text, remove its entry here in the same change.
//  - "work-split": the Arabic is the work split's own §I.3 cell, used exactly (placeholders written `{{x}}` for i18next
//    where the work split writes `{x}`). The §I.3 key `about.openItems` (the heading) is stored at
//    `about.openItems.title`, because `about.openItems.dependency` and `.none` are its children in the same JSON tree.
//  - "fe-c": the work split gives no Arabic for this text (a filter option, a column, a detail label or a state of the
//    two screens); the Arabic was written by T-DG7-FE-C.

export type P7ReleaseArabicSource = "work-split" | "fe-c";

/** `release.<key>` -> the source of its provisional Arabic. Every leaf of ar/release.json is listed. */
export const P7_RELEASE_PROVISIONAL_ARABIC: Readonly<Record<string, P7ReleaseArabicSource>> = {
  "release.register.title": "work-split",
  "release.register.intro": "work-split",
  "release.register.snapshot": "work-split",
  "release.register.filter.class": "work-split",
  "release.register.filter.status": "work-split",
  "release.register.filter.area": "work-split",
  "release.register.filter.finalGate": "work-split",
  "release.register.filter.legend": "fe-c",
  "release.register.filter.all": "fe-c",
  "release.register.filter.clear": "fe-c",
  "release.register.col.id": "work-split",
  "release.register.col.title": "work-split",
  "release.register.col.increments": "work-split",
  "release.register.notEngineeringApproval": "work-split",
  "release.register.englishOnly": "work-split",
  "release.register.unavailable": "work-split",
  "release.register.empty": "work-split",
  "release.register.listTitle": "fe-c",
  "release.register.class.SOURCE": "fe-c",
  "release.register.class.USER": "fe-c",
  "release.register.class.ENGINEERING": "fe-c",
  "release.register.detail.title": "fe-c",
  "release.register.detail.close": "fe-c",
  "release.register.detail.open": "fe-c",
  "release.register.detail.emptyField": "fe-c",
  "release.register.detail.sourceRef": "fe-c",
  "release.register.detail.sourceHeading": "fe-c",
  "release.register.detail.templateId": "fe-c",
  "release.register.detail.inputFields": "fe-c",
  "release.register.detail.procedure": "fe-c",
  "release.register.detail.output": "fe-c",
  "release.register.detail.ownerRoles": "fe-c",
  "release.register.detail.permissions": "fe-c",
  "release.register.detail.automation": "fe-c",
  "release.register.detail.screenApi": "fe-c",
  "release.register.detail.acceptance": "fe-c",
  "release.register.detail.evidence": "fe-c",
  "release.register.detail.notes": "fe-c",
  "release.status.PLANNED": "work-split",
  "release.status.SPECIFIED": "work-split",
  "release.status.IMPLEMENTED": "work-split",
  "release.status.BLOCKED": "work-split",
  "release.about.title": "work-split",
  "release.about.appVersion": "work-split",
  "release.about.contractVersion": "work-split",
  "release.about.counts": "work-split",
  "release.about.total": "fe-c",
  "release.about.count": "fe-c",
  "release.about.checkedAt": "fe-c",
  "release.about.versions": "fe-c",
  "release.about.openItems.title": "work-split",
  "release.about.openItems.dependency": "work-split",
  "release.about.openItems.none": "work-split",
  "release.about.laterClauses": "work-split",
  "release.about.laterClausesNone": "fe-c",
  "release.about.laterClause": "fe-c",
  "release.about.externalDependencies": "work-split",
  "release.about.externalDependenciesNone": "fe-c",
  "release.about.dependency.key": "fe-c",
  "release.about.dependency.title": "fe-c",
  "release.about.dependency.owner": "fe-c",
  "release.about.dependency.status": "fe-c",
  "release.about.dependency.state.not_configured": "fe-c",
  "release.about.dependency.state.not_verified": "fe-c",
  "release.about.dependency.state.blocked": "fe-c",
  "release.about.unknown": "work-split",
  "release.about.unavailable": "work-split",
};
