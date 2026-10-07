// P3 BE-A integration fixtures (T-DG3-BE-A). All data is SYNTHETIC. A pending gate submission inserted through the app
// role WITH its audit events - the state the API itself writes on submit - so a decision rule can be exercised on a
// gate whose own criteria are not under test. Product gates G1-G6 are business approvals inside the product; a
// decision in these tests is a demo decision on synthetic data and never touches the engineering gates DG0-DG7.
import { createHash } from "node:crypto";
import { sql } from "@mth/db";
import { v7 as uuidv7 } from "uuid";
import { record } from "../../../src/modules/audit/index.ts";
import { call, createUser, grant, signIn, type TestApi, type World } from "../../support/harness.ts";
import type { P2World } from "../../support/p2-fixtures.ts";

/** Inserts submission 1 of `gateCode` as pending (submitted by `submitterId`, default the lead); returns its number. */
export async function pendingSubmission(
  api: TestApi,
  p: P2World,
  gateCode: string,
  submitterId: string = p.lead.id,
): Promise<number> {
  return api.db.transaction().execute(async (tx) => {
    const audit = { actorUserId: submitterId, requestId: `fixture-${uuidv7()}` };
    const inst = await tx
      .selectFrom("gate_instance")
      .selectAll()
      .where("transformation_id", "=", p.transformationId)
      .where("gate_code", "=", gateCode)
      .executeTakeFirstOrThrow();
    const t = await tx
      .selectFrom("transformation")
      .select("organization_id")
      .where("id", "=", p.transformationId)
      .executeTakeFirstOrThrow();
    const id = uuidv7();
    const no = inst.latest_submission_no + 1;
    const snapshot = JSON.stringify({ schema: "mth.gate-submission/1", gateCode, fixture: true });
    await tx
      .insertInto("gate_submission")
      .values({
        id,
        organization_id: t.organization_id,
        transformation_id: p.transformationId,
        gate_instance_id: inst.id,
        gate_code: gateCode,
        submission_no: no,
        submitted_by: submitterId,
        submission_note: "Synthetic fixture submission",
        approver_role_code: inst.approver_role_code,
        approver_user_id: inst.approver_user_id,
        due_date: null,
        charter_id: null,
        charter_version_no: null,
        snapshot,
        snapshot_sha256: createHash("sha256").update(snapshot).digest("hex"),
        created_by: submitterId,
        updated_by: submitterId,
      })
      .execute();
    await record(tx, audit, {
      action: "gate_submission.create",
      recordType: "gate_submission",
      recordId: id,
      organizationId: t.organization_id,
      transformationId: p.transformationId,
      newVersion: 1,
    });
    const updated = await tx
      .updateTable("gate_instance")
      .set({
        status: "submitted",
        current_submission_id: id,
        latest_submission_no: no,
        version: sql<number>`version + 1`,
        updated_by: submitterId,
      })
      .where("id", "=", inst.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    await record(tx, audit, {
      action: "gate_instance.submit",
      recordType: "gate_instance",
      recordId: inst.id,
      organizationId: t.organization_id,
      transformationId: p.transformationId,
      priorVersion: inst.version,
      newVersion: updated.version,
    });
    return no;
  });
}

/**
 * Stages a gate's status with its audit events (to set up G1-G3 states for the sequencing rules; synthetic only): a
 * fixture submission first (a non-draft gate has one, gate_instance_draft_unsubmitted), then the status.
 */
export async function setGateStatus(api: TestApi, p: P2World, gateCode: string, status: string): Promise<void> {
  await pendingSubmission(api, p, gateCode);
  await api.db.transaction().execute(async (tx) => {
    const inst = await tx
      .selectFrom("gate_instance")
      .selectAll()
      .where("transformation_id", "=", p.transformationId)
      .where("gate_code", "=", gateCode)
      .executeTakeFirstOrThrow();
    const updated = await tx
      .updateTable("gate_instance")
      .set({
        status,
        approved_at: status === "approved" ? new Date() : null,
        version: sql<number>`version + 1`,
        updated_by: p.lead.id,
      })
      .where("id", "=", inst.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    await record(
      tx,
      { actorUserId: p.lead.id, requestId: `fixture-${uuidv7()}` },
      {
        action: "gate_instance.fixture_status",
        recordType: "gate_instance",
        recordId: inst.id,
        organizationId: inst.organization_id,
        transformationId: p.transformationId,
        priorVersion: inst.version,
        newVersion: updated.version,
      },
    );
  });
}

/**
 * A Modular world (ADR-0021 §5): like setupP2World (TL lead creates it, SP sponsor, WL contributor, TO office, AUD
 * auditor) but `mode: modular` entering at `define`.
 */
export async function setupModularWorld(api: TestApi, w: World): Promise<P2World> {
  const lead = await createUser(api.db, w.orgA.id);
  const sponsor = await createUser(api.db, w.orgA.id);
  const contributor = await createUser(api.db, w.orgA.id);
  const methodologyAdmin = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, lead.id, "TL", { type: "business_unit", id: w.a1 }, w.orgA.id);
  const leadSession = await signIn(api.app, lead.subject);
  const t = await call<{ id: string }>(api.app, "POST", "/api/v1/transformations", {
    session: leadSession,
    body: { businessUnitId: w.a1, name: "Synthetic Modular transformation", mode: "modular", entryPhase: "define" },
  });
  if (t.status !== 201) throw new Error(`modular transformation: ${t.status} ${JSON.stringify(t.body)}`);
  const transformationId = t.body.id;
  await grant(api.db, w.grantor.id, sponsor.id, "SP", { type: "transformation", id: transformationId }, w.orgA.id);
  await grant(api.db, w.grantor.id, contributor.id, "WL", { type: "transformation", id: transformationId }, w.orgA.id);
  return {
    transformationId,
    lead: { id: lead.id, session: leadSession },
    sponsor: { id: sponsor.id, session: await signIn(api.app, sponsor.subject) },
    office: { id: w.office.id, session: await signIn(api.app, w.office.subject) },
    contributor: { id: contributor.id, session: await signIn(api.app, contributor.subject) },
    auditor: { id: w.auditor.id, session: await signIn(api.app, w.auditor.subject) },
    methodologyAdmin: { id: methodologyAdmin.id, session: await signIn(api.app, methodologyAdmin.subject) },
  };
}
