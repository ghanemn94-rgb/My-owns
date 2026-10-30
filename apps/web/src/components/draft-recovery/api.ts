// Draft recovery reads and writes (T-DG6-FE-D2; ADR-0057 §6; ADR-0041 §5; REQ-S15-010 "unsaved drafts are
// recoverable", REQ-S15-011 "Draft - not submitted"). One draft model: the P5 `form_draft` routes, unchanged
// (createFormDraft, updateFormDraft with If-Match, closeFormDraft), and the P6 read listMyFormDrafts. The draft lives
// on the server, so a browser reload or cleared browser storage loses nothing. A draft approves nothing and is never
// counted in any total (only forms/drafts.ts reads `form_draft` on the API).
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { formDraft, type FormDraft } from "@mth/shared/schemas";
import { z } from "zod";
import { api } from "../../api/client.ts";
import { p5Keys, p5Paths } from "../../api/p5.ts";
import { fetchAllPages, shouldRetry } from "../../api/queries.ts";

export type { FormDraft };

/** listMyFormDrafts `GET /api/v1/me/form-drafts` (ADR-0057 §6). */
export const MY_FORM_DRAFTS_PATH = "/api/v1/me/form-drafts";

/**
 * The contract's `MyFormDraft` (docs/api/openapi.yaml; no shared zod mirror exists at this revision, so this one is
 * written from the contract and a body that does not parse is an error state, never rendered half-way).
 */
export const myFormDraft = z.strictObject({
  id: z.uuid(),
  transformationId: z.uuid(),
  transformationCode: z.string(),
  transformationName: z.string(),
  recordType: z.string(),
  recordId: z.uuid().nullable(),
  baseRecordVersion: z.number().int().min(1).nullable(),
  baseChanged: z.boolean(),
  version: z.number().int().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MyFormDraft = z.infer<typeof myFormDraft>;
const myFormDraftPage = z.strictObject({ items: z.array(myFormDraft), nextCursor: z.string().nullable() });

export const draftKeys = {
  mine: ["p6", "drafts", "mine"] as const,
  /** The P5 list key prefix of one transformation's drafts (the form framework's tab reads the same list). */
  ofTransformation: (tid: string) => p5Keys.area("form-drafts", tid),
  ofRecord: (tid: string, recordType: string, recordId: string) =>
    [...p5Keys.area("form-drafts", tid), "record", recordType, recordId] as const,
};

/** The caller's open drafts across transformations, newest first, one API page at a time ("Show more"). */
export function useMyFormDrafts(pageSize = 50) {
  return useInfiniteQuery({
    queryKey: [...draftKeys.mine, pageSize],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      const body = await api.get<unknown>(MY_FORM_DRAFTS_PATH, { limit: pageSize, cursor: pageParam }, signal);
      const parsed = myFormDraftPage.safeParse(body);
      if (!parsed.success) throw new Error("unexpected my-form-drafts response");
      return parsed.data;
    },
    getNextPageParam: (last) => last.nextCursor,
    retry: shouldRetry,
  });
}

/** The caller's one open draft of a record (one per user and record; ADR-0041 §5 FD02), or null. */
export function useRecordDraft(tid: string, recordType: string, recordId: string, enabled = true) {
  return useQuery({
    queryKey: draftKeys.ofRecord(tid, recordType, recordId),
    queryFn: async (): Promise<FormDraft | null> => {
      const items = await fetchAllPages<unknown>(p5Paths.formDrafts(tid), { recordType, status: "open" });
      const parsed = formDraft.array().safeParse(items);
      if (!parsed.success) throw new Error("unexpected form-drafts response");
      return parsed.data.find((d) => d.recordId === recordId && d.status === "open") ?? null;
    },
    enabled: Boolean(enabled && tid && recordId),
    retry: shouldRetry,
  });
}

/** Refreshes every draft read a draft write can change (this record, the transformation's list, "Your drafts"). */
export function useDraftRefresh() {
  const qc = useQueryClient();
  return async (tid: string) => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: draftKeys.ofTransformation(tid) }),
      qc.invalidateQueries({ queryKey: draftKeys.mine }),
    ]);
  };
}

/** The draft body of a form record editor: the changed source fields as text (the P5 form framework's shape). */
export interface DraftPayload {
  readonly sourceFields: Readonly<Record<string, string>>;
  readonly customFieldValues: Readonly<Record<string, string>>;
  readonly currencyCodes: Readonly<Record<string, string>>;
}

export const sourceFieldsPayload = (sourceFields: Readonly<Record<string, string>>): DraftPayload => ({
  sourceFields,
  customFieldValues: {},
  currencyCodes: {},
});

/** The text source fields of a stored draft payload (anything else is ignored, never guessed). */
export function draftSourceFields(payload: Record<string, unknown>): Record<string, string> {
  const x = payload["sourceFields"];
  if (!x || typeof x !== "object" || Array.isArray(x)) return {};
  return Object.fromEntries(
    Object.entries(x as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string"),
  );
}

export const createDraft = (
  tid: string,
  body: { recordType: string; recordId: string | null; baseRecordVersion: number | null; payload: DraftPayload },
) => api.send<FormDraft>(p5Paths.formDrafts(tid), { method: "POST", body });

export const updateDraft = (tid: string, draft: { id: string; version: number }, payload: DraftPayload) =>
  api.send<FormDraft>(p5Paths.formDraft(tid, draft.id), { method: "PUT", body: { payload }, ifMatch: draft.version });

export const getDraft = (tid: string, draftId: string) => api.get<FormDraft>(p5Paths.formDraft(tid, draftId));

export const closeDraft = (tid: string, draft: { id: string; version: number }, reason: "saved" | "discarded") =>
  api.send<FormDraft>(p5Paths.closeFormDraft(tid, draft.id), {
    method: "POST",
    body: { reason },
    ifMatch: draft.version,
  });
