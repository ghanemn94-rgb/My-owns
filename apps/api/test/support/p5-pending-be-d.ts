// P5 operations without a route yet, owned by backend-workflow-engineer task T-DG5-BE-D (slice B: form schemas, the forms kind provider, custom-field values)
// (docs/architecture/p5-work-split.md §B/§C). Remove an entry in the same change that registers its route and exercises it in
// the contract test. Must be empty when the DG5 candidate freezes. Only the owning task edits this file.
// T-DG5-BE-D routed all five (listFormRecordTypes, getFormSchemaAdmin, getTransformationFormSchema,
// getFormRecordCustomFields, putFormRecordCustomFields) and exercises them in p5-exercises-be-d.ts.
export const P5_PENDING_BE_D: readonly string[] = [];
