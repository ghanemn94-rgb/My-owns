// The provisional-Arabic label of the P6 catalogue blocks (T-DG6-FE-A; p6-work-split §E/F.12: "Arabic texts are
// provisional and labelled so in the catalogue comments"; §J/C.13: "ar labelled provisional").
//
// The catalogues are JSON files (`ar/*.json`), which cannot carry comments, so the label lives here, beside them, as data
// a test checks (i18n/problems-p6.test.ts): every Arabic text that the P6 shell added is listed below, and a P6 key that
// is missing from this list fails the test. Every one of them is PROVISIONAL and awaits a Mobily language review:
//  - "adr": the Arabic is the ADR's own text, used exactly, and the ADR itself labels it provisional
//    (ADR-0053 §2, ADR-0054 §4: "Arabic (provisional)").
//  - "fe-a": the ADR gives English only (ADR-0051 §2-§4, ADR-0052 §1-§2, the restricted texts of D-196 item 5), or the
//    text is a navigation or placeholder text of the shell; the Arabic was written by T-DG6-FE-A.
// A key ending in "." stands for every key below that prefix. When a reviewed translation replaces a text, remove its
// entry here in the same change.

//  - "fe-b": the Arabic of the T-DG6-FE-B screens (the whole `adminP6` namespace), written by T-DG6-FE-B.
//  - "fe-f": the Arabic written by T-DG6-FE-F (p6-work-split §I/K.3): the `explanations` namespace (ADR-0061 §8 gives
//    English only) and the problem texts that `problems-all.test.ts` found missing (the English is the API's detail).
//  - "fe-z2": the Arabic written by T-DG6-FE-Z2 (F-DG6-222): the field-error texts of a secret reference IT has not
//    provisioned or bound (ADR-0052 amendments; the ADR gives English only and asks the web owner for the Arabic).
//  - "fe-z3": the Arabic written by T-DG6-FE-Z3 (F-DG6-320, F-DG6-301): the "Last error" texts of the operational
//    exception codes and the three field-error codes that had none (the English follows the API's own message).
export type ProvisionalArabicSource = "adr" | "fe-a" | "fe-b" | "fe-f" | "fe-z2" | "fe-z3";

/** Catalogue path (namespace.key, with "__" for "." inside a problem code) -> where the provisional Arabic comes from. */
export const P6_PROVISIONAL_ARABIC: Readonly<Record<string, ProvisionalArabicSource>> = {
  // problems.json, slice E (ADR-0051 §2-§4: English only)
  "problems.sensitive_grant__not_self": "fe-a",
  "problems.sensitive_grant__grantee_not_in_organization": "fe-a",
  "problems.sensitive_grant__duplicate": "fe-a",
  "problems.sensitivity__reason_required": "fe-a",
  "problems.deep_link__forbidden": "fe-a",
  "problems.evidence__parent_forbidden": "fe-a",
  // problems.json, slice F (ADR-0052 §1-§2: English only)
  "problems.evidence__type_not_allowed": "fe-a",
  "problems.evidence__type_not_allowed_detail": "fe-a",
  "problems.evidence__type_mismatch": "fe-a",
  "problems.evidence__type_mismatch_detail": "fe-a",
  "problems.evidence__too_large": "fe-a",
  "problems.evidence__too_large_detail": "fe-a",
  "problems.evidence__preview_unavailable": "fe-a",
  // problems.json, slice J (ADR-0053 §2: Arabic given, labelled provisional by the ADR)
  "problems.operations__exception_not_open": "adr",
  "problems.operations__exception_resolved": "adr",
  "problems.operations__note_required": "adr",
  "problems.service_identity__grant_exceeds_declaration": "adr",
  "problems.service_identity__reason_required": "adr",
  "problems.service_identity__out_of_scope": "adr",
  "problems.service_identity__missing": "adr",
  // problems.json, slice C (ADR-0054 §4: Arabic given, labelled provisional by the ADR)
  "problems.storage__s3_incomplete": "adr",
  "problems.storage__secret_ref_invalid": "adr",
  "problems.storage__test_required": "adr",
  "problems.notification_channel__email_incomplete": "adr",
  "problems.notification_channel__adapter_unavailable": "adr",
  "problems.notification_channel__insecure_transport": "adr",
  "problems.notification_channel__not_configured": "adr",
  "problems.notification_channel__no_recipient_address": "adr",
  "problems.admin__reason_required": "adr",
  // The restricted texts (ADR-0051 §2, §3; D-196 item 5)
  "access.includesRestrictedRecords": "fe-a",
  "myWork.message.inbox__restricted": "fe-a",
  // nav.json: the seven Administration entries, their contents labels and the placeholders
  "nav.sub.audit": "fe-a",
  "nav.sub.security": "fe-a",
  "nav.sub.sensitiveGrants": "fe-a",
  "nav.sub.operations": "fe-a",
  "nav.sub.identity": "fe-a",
  "nav.sub.storage": "fe-a",
  "nav.sub.notifications": "fe-a",
  "nav.contents.admin.audit": "fe-a",
  "nav.contents.admin.security": "fe-a",
  "nav.contents.admin.sensitiveGrants": "fe-a",
  "nav.contents.admin.operations": "fe-a",
  "nav.contents.admin.identity": "fe-a",
  "nav.contents.admin.storage": "fe-a",
  "nav.contents.admin.notifications": "fe-a",
  "nav.p6.": "fe-a",
  // adminP6.json (T-DG6-FE-B): every text of the slice E, F, J and C screens
  "adminP6.": "fe-b",
  // problems.json, slice I (ADR-0061 §6: Arabic given, labelled provisional by the ADR; BE-W's two codes)
  "problems.branding__contrast_insufficient": "adr",
  "problems.branding__contrast_pair_below_threshold": "adr",
  // problems.json: codes the API emits that had no text (T-DG6-FE-F, problems-all.test.ts; ADR-0061 §7.3)
  "problems.evidence__reviewer_is_author": "fe-f",
  "problems.health_scheme__definition_invalid": "fe-f",
  "problems.assistant__test_adapter_shape": "fe-f",
  "problems.validation__weight_percent": "fe-f",
  "problems.validation__validation__reference": "fe-f",
  "problems.validation__upload_policy_allowed_types": "fe-f",
  "problems.validation__upload_policy_max_bytes": "fe-f",
  "problems.validation__idempotency_key": "fe-f",
  "problems.validation__transformation_not_allowed": "fe-f",
  "problems.gate__out_of_sequence": "fe-f",
  // problems.json: the SecretRef field errors (T-DG6-FE-Z2, F-DG6-222; ADR-0052 §5 amendments of 2026-11-02/04)
  "problems.validation__secret_ref_namespace": "fe-z2",
  "problems.validation__secret_ref_not_bound": "fe-z2",
  "problems.validation__secret_ref_host_not_bound": "fe-z2",
  // problems.json: the operational-exception codes and field-error codes found by problems-all.test.ts (T-DG6-FE-Z3)
  "problems.kpi__stale": "fe-z3",
  "problems.operations__heartbeat_missed": "fe-z3",
  "problems.smtp__connection_failed": "fe-z3",
  "problems.smtp__timeout": "fe-z3",
  "problems.smtp__tls_failed": "fe-z3",
  "problems.smtp__auth_failed": "fe-z3",
  "problems.smtp__recipient_rejected": "fe-z3",
  "problems.smtp__message_rejected": "fe-z3",
  "problems.smtp__temporary_failure": "fe-z3",
  "problems.smtp__protocol_error": "fe-z3",
  "problems.smtp__secret_unavailable": "fe-z3",
  "problems.smtp__configuration_invalid": "fe-z3",
  "problems.smtp__unknown": "fe-z3",
  "problems.validation__commit_on_behalf_of": "fe-z3",
  "problems.validation__credential_refs": "fe-z3",
  "problems.validation__unknown_version": "fe-z3",
  // explanations.json (T-DG6-FE-F): the explanation panels of ADR-0061 §8 (E1, E2, E4, E5) and the contrast report
  "explanations.": "fe-f",
};
