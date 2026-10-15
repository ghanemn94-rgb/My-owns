// Fixtures of the approval-route and conditional-approval suites (T-DG5-BE-K; ADR-0044 §3, §4; p5-work-split §E.2),
// shared with p5-exercises-be-k.ts and the worker's condition-escalation test. Each world seeds its OWN synthetic
// published methodology version under a fresh key (the migration-fixtures pattern, as the migration owner would) and
// pins its own fixture transformation to it, so no shared Studio key is ever published. Every value is SYNTHETIC; every
// decision recorded through these fixtures is a demo business decision by a test person that approves nothing real,
// and nothing touches the engineering gates DG0-DG7.
import { expect } from "vitest";
import { call, createUser, grant, signIn, type Res, type TestApi, type World } from "../../support/harness.ts";
import { requestBody, setupApprovalWorld, type ApprovalWorld, type Caller } from "../approvals/approval-world.ts";
import { freshKey, pinFixture, seedPublishedVersion } from "../methodology/migration-fixtures.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

export interface RoutedWorld {
  readonly q: ApprovalWorld;
  /** The synthetic published methodology version the transformation is pinned to (null = the shipped v1). */
  readonly versionId: string | null;
}

/** The route element of `decision_request` approvals (ADR-0039 §2 key `approval.<type>`). */
export const ROUTE_KEY = "approval.decision_request";

/**
 * The slice C approval world (TL lead, SP, two BO, one FIN; T11 rows; a design decision to approve), pinned to a
 * synthetic published methodology version whose `approval.decision_request` route has `roles` in `mode`. With
 * `mode` null the transformation keeps the shipped v1 (no route: the DG4 single-step approval).
 */
export async function routedWorld(
  api: TestApi,
  w: World,
  mode: "sequential" | "parallel" | "any" | null,
  roles: readonly string[] = ["BO", "FIN"],
  send?: Caller,
): Promise<RoutedWorld> {
  const q = await setupApprovalWorld(api, w, send);
  if (mode === null) return { q, versionId: null };
  const versionId = await seedPublishedVersion(api, "methodology", freshKey("methodology"), 1, [
    {
      elementType: "approver_route",
      stableKey: ROUTE_KEY,
      origin: "admin",
      attributes: {
        approverRoleCodes: [...roles],
        mode,
        labelEn: "Synthetic decision route",
        labelAr: "مسار قرار تجريبي",
      },
    },
  ]);
  await pinFixture(api, {
    organizationId: w.orgA.id,
    transformationId: q.transformationId,
    kind: "methodology",
    versionId,
    by: q.lead.id,
  });
  return { q, versionId };
}

/** Requests a `decision_request` approval on the world's decision (the TL, through the DG4 route). Returns its body. */
export async function requestRouted(send: Caller, q: ApprovalWorld, subjectVersion = 1): Promise<Body> {
  const res = (await send("POST", `/api/v1/transformations/${q.transformationId}/approvals`, {
    session: q.lead.session,
    body: requestBody(q.decisionId, q.rights["target_state_design"]!, subjectVersion),
  })) as Res<Body>;
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

/** A further holder of `roles` at the world's transformation, signed in (synthetic person). */
export async function holderOf(api: TestApi, w: World, q: ApprovalWorld, roles: readonly string[]) {
  const u = await createUser(api.db, w.orgA.id);
  for (const role of roles)
    await grant(api.db, w.grantor.id, u.id, role, { type: "transformation", id: q.transformationId }, w.orgA.id);
  return { id: u.id, session: await signIn(api.app, u.subject) };
}

/** The decision of one step through the validating client or `call`. */
export const stepUrl = (approvalId: string, stepNo: number) =>
  `/api/v1/approvals/${approvalId}/route/steps/${stepNo}/decision`;

/** Open work items of an approval for one person (approval_decision kind; route or DG4 keys). */
export async function decisionItems(api: TestApi, approvalId: string, userId: string) {
  return api.db
    .selectFrom("work_item")
    .select(["id", "status", "dedupe_key", "kind"])
    .where("subject_type", "=", "approval")
    .where("subject_id", "=", approvalId)
    .where("assignee_user_id", "=", userId)
    .where("kind", "=", "approval_decision")
    .orderBy("id")
    .execute();
}

/** The default caller (no contract mirror). */
export const plainCaller =
  (api: TestApi): Caller =>
  (m, u, o) =>
    call(api.app, m, u, o);
