// P6 contract exercises of BE-C (p6-plan §5.1, p6-work-split §2 rule 16; T-DG6-BE-C): `resolveDeepLink` (ADR-0051 §3)
// through the contract-validating client `mirrored`: 200 (a reader of the target), 400 (a malformed token), 401 (no
// session), 403 `deep_link.forbidden` (a caller who cannot read the target) and 404 (an unknown token). The success
// body is also checked against its zod mirror below. Every value is SYNTHETIC; nothing here touches DG0-DG7.
import { deepLinkResolution } from "@mth/shared/schemas";
import { expect } from "vitest";
import type { z } from "zod";
import { createWorkItemOnce, issueDeepLink } from "../../../src/modules/tasks/index.ts";
import {
  createTransformationRow,
  createUser,
  grant,
  signIn,
  uniq,
  type P6ExerciseContext,
} from "../../support/harness.ts";

export const P6_MIRRORS_BE_C: Readonly<Record<string, z.ZodType>> = {
  resolveDeepLink: deepLinkResolution,
};

const WORKER = { actorType: "service", actorUserId: null, requestId: "job:contract", source: "worker" } as const;

export async function exerciseP6BeCOperations(ctx: P6ExerciseContext): Promise<void> {
  const { api, world: w, mirrored: m } = ctx;
  const transformationId = await createTransformationRow(api.db, w.orgA.id, w.a1, w.grantor.id);
  const bo = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, bo.id, "BO", { type: "transformation", id: transformationId }, w.orgA.id);
  const boS = await signIn(api.app, bo.subject);
  const outsider = await signIn(api.app, w.officeB.subject);
  const created = await api.db.transaction().execute((tx) =>
    createWorkItemOnce(tx, WORKER, {
      organizationId: w.orgA.id,
      transformationId,
      kind: "kpi_update_due",
      assigneeUserId: bo.id,
      subjectType: "transformation",
      subjectId: transformationId,
      linkPath: `/transformations/${transformationId}/team`,
      messageKey: "tasks.kpi_update_due",
      messageParams: { kpiName: "Synthetic KPI", periodLabel: "2026-10" },
      dedupeKey: uniq("contract.deep_link:"),
    }),
  );
  const note = await api.db
    .selectFrom("inbox_notification")
    .select("id")
    .where("work_item_id", "=", created.workItemId)
    .executeTakeFirstOrThrow();
  const { token } = await issueDeepLink(api.db, note.id, WORKER);
  const LINK = `/api/v1/links/${token}`;

  const ok = await m("GET", LINK, { session: boS });
  expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  expect(ok.body).toEqual({ linkPath: `/transformations/${transformationId}/team`, recordType: null, recordId: null });
  const bad = await m("GET", "/api/v1/links/not-a-token", { session: boS });
  expect(bad.status).toBe(400);
  expect((await m("GET", LINK)).status).toBe(401);
  const forbidden = await m("GET", LINK, { session: outsider });
  expect(forbidden.status).toBe(403);
  expect(forbidden.body.code).toBe("deep_link.forbidden");
  const unknown = await m("GET", `/api/v1/links/${"A".repeat(43)}`, { session: boS });
  expect(unknown.status).toBe(404);
}
