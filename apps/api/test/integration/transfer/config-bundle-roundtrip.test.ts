// T-D6 (ADR-0065 §7; p7-work-split §D.3; REQ-S19-008 "a bundle exported from the demo installation imports into a
// clean one, and its published versions behave identically"; T-DG7-BE-F): two scratch databases of this run's disposable
// PostgreSQL cluster.
//   source = the demo installation (migrations + the synthetic demo seed), where a procedures version, a job schedule
//            and the demo organization's upload policy are changed through their existing operations;
//   target = a clean installation (migrations only, one bootstrapped synthetic organization).
// demo -> export all kinds -> upload, validate, commit into the target -> publish every imported Studio draft through
// the existing preview, compatibility, review and publish operations -> every published content hash in the target
// equals the source item's contentSha256, and a re-export from the target has the same items and hashes.
// The A06 replay on the target is QA-B's (tests/qa/**), not this file.
//
// T-D7 (ADR-0065 §5; p7-work-split §D.3, §D.6 "published versions behave identically"; T-DG7-BE-F2): two more clean
// installations, `hand` and `imp`, each with a running transformation whose methodology pin names the migration-seeded
// playbook version and whose G1 is approved. In `hand` a playbook change (a new mandatory G1 checklist item) is made
// by hand in Studio and published; in `imp` the SAME change arrives as `hand`'s exported bundle, is committed as a draft
// and published through the same operations. In both: the pin is unchanged by the commit and by the publish (no
// migration, no re-approval exists until a person asks for one); then the same ADR-0040 migration is planned, approved
// and executed, and every record the publish and the migration create (audit events, outbox events, plan items, the
// re-approval, its work items, the pin history) is the same in both installations.
//
// Every value is SYNTHETIC; nothing here is a business, Finance or IT approval (the Studio review is a configuration
// review; the G1 decision and the migration approval are demo decisions by synthetic people in a test world), and no
// DG0-DG7 record is touched.
import { migrate, seedDemo, sql } from "@mth/db";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { DEMO_ANCHORS } from "../../../../../packages/db/src/demo/data/kpis.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../../packages/db/test/helpers.ts";
import {
  call,
  createOrg,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  type Session,
  type TestApi,
} from "../../support/harness.ts";
import { G1_AGREEMENTS, gateVersion, makeG1Ready } from "../../support/p2-fixtures.ts";
import { setupApprovalWorld, type ApprovalWorld } from "../approvals/approval-world.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
type Key = { kind: string; itemCode: string; contentSha256: string };

const BASE = "/api/v1/admin/config-bundles";
const V = "/api/v1/admin/methodology-versions";
const DEMO_ORG = DEMO_ANCHORS.organizationId;
const ifm = (v: number) => ({ "if-match": `"${v}"` });

interface Side {
  scratch: string;
  api: TestApi;
  orgId: string;
  author: Session; // ADM_METHOD + ADM_TECH + TO (writes every kind)
  reviewer: Session; // TO (reviews Studio changes; never the author)
}
let source: Side;
let target: Side;

const ok = (res: { status: number; body: unknown }, status: number, what: string): Body => {
  expect(res.status, `${what}: ${JSON.stringify(res.body).slice(0, 800)}`).toBe(status);
  return res.body as Body;
};

async function side(name: string, demo: boolean): Promise<Side> {
  const { adminUrl } = inject("mthDb");
  const scratch = await createScratchDatabase(adminUrl, name);
  await migrate(roleUrl(adminUrl, scratch, "mth_owner"));
  if (demo)
    await seedDemo(roleUrl(adminUrl, scratch, "mth_owner"), {
      mthEnv: "demo",
      runKind: "seed",
      requestedVia: "cli",
      requestedBy: null,
    });
  const api = await startApi({ database: scratch, ...(demo ? { env: { MTH_ENV: "demo" } } : {}) });
  const orgId = demo ? DEMO_ORG : (await createOrg(api.db)).id;
  const grantor = demo ? DEMO_ANCHORS.users.sp : (await createUser(api.db, orgId)).id;
  const scope = { type: "organization" as const, id: orgId };
  const mk = async (roles: string[]) => {
    const u = await createUser(api.db, orgId);
    for (const r of roles) await grant(api.db, grantor, u.id, r, scope, orgId);
    return signIn(api.app, u.subject);
  };
  return { scratch, api, orgId, author: await mk(["ADM_METHOD", "ADM_TECH", "TO"]), reviewer: await mk(["TO"]) };
}

/**
 * Publishes Studio draft `id` through the existing operations (preview, compatibility, for the methodology kind the
 * source-coverage run its publish requires, review, publish).
 */
async function publishDraft(s: Pick<Side, "api" | "author" | "reviewer">, id: string): Promise<Body> {
  const send = (m: string, u: string, o: Parameters<typeof call>[3]) => call<Body>(s.api.app, m, u, o);
  const current = async () => ok(await send("GET", `${V}/${id}`, { session: s.author }), 200, "get version");
  ok(
    await send("POST", `${V}/${id}/preview`, {
      session: s.author,
      headers: ifm((await current()).version),
      body: { samples: [] },
    }),
    201,
    "preview",
  );
  ok(
    await send("POST", `${V}/${id}/compatibility-checks`, {
      session: s.author,
      headers: ifm((await current()).version),
    }),
    201,
    "compatibility",
  );
  if ((await current()).configKind === "methodology") {
    const coverage = ok(
      await send("POST", "/api/v1/admin/source-coverage/runs", { session: s.author, body: { versionId: id } }),
      201,
      "source coverage",
    );
    expect(coverage.result).not.toBe("fail");
  }
  if ((await current()).reviewRequired) {
    const sub = ok(
      await send("POST", `${V}/${id}/submit-review`, {
        session: s.author,
        headers: ifm((await current()).version),
        body: {},
      }),
      201,
      "submit review",
    );
    ok(
      await send("POST", `${V}/${id}/reviews/${sub.id}/decision`, {
        session: s.reviewer,
        headers: ifm(1),
        body: { outcome: "approve" },
      }),
      200,
      "review decision",
    );
  }
  const pub = ok(
    await send("POST", `${V}/${id}/publish`, { session: s.author, headers: ifm((await current()).version) }),
    200,
    "publish",
  );
  expect(pub.status).toBe("published");
  return pub;
}

async function exportAll(s: Side, reason: string): Promise<Body> {
  const created = ok(
    await call<Body>(s.api.app, "POST", `${BASE}/exports?organizationId=${s.orgId}`, {
      session: s.author,
      body: { reason },
    }),
    201,
    "export",
  );
  const download = await call<Body>(s.api.app, "GET", `${BASE}/exports/${created.id}/download`, { session: s.author });
  expect(download.status).toBe(200);
  return JSON.parse(download.raw.body);
}

const keysOf = (bundle: Body): Key[] =>
  (bundle.items as Key[]).map((i) => ({ kind: i.kind, itemCode: i.itemCode, contentSha256: i.contentSha256 }));

beforeAll(async () => {
  source = await side("mth_cb_roundtrip_src", true);
  target = await side("mth_cb_roundtrip_dst", false);
  // Source changes through the existing operations, so the bundle carries something the clean target lacks.
  const proc = await source.api.db
    .selectFrom("methodology_version")
    .select(["id", "key"])
    .where("config_kind", "=", "procedure")
    .where("status", "=", "published")
    .orderBy("key")
    .orderBy("version_no", "desc")
    .executeTakeFirstOrThrow();
  const draft = ok(
    await call<Body>(source.api.app, "POST", V, { session: source.author, body: { basedOnVersionId: proc.id } }),
    201,
    "source draft",
  );
  ok(
    await call<Body>(source.api.app, "PATCH", `${V}/${draft.id}`, {
      session: source.author,
      headers: ifm(draft.version),
      body: { titleEn: "Synthetic procedures (demo change)" },
    }),
    200,
    "source edit",
  );
  await publishDraft(source, draft.id);
  const job = await source.api.db
    .selectFrom("job_schedule")
    .select(["code", "version"])
    .orderBy("code")
    .executeTakeFirstOrThrow();
  ok(
    await call<Body>(source.api.app, "PATCH", `/api/v1/admin/job-schedules/${job.code}`, {
      session: source.author,
      headers: ifm(job.version),
      body: { cron: "13 2 * * *" },
    }),
    200,
    "source job schedule",
  );
  const policy = await call<Body>(source.api.app, "GET", `/api/v1/admin/upload-policy?organizationId=${DEMO_ORG}`, {
    session: source.author,
  });
  ok(
    await call<Body>(source.api.app, "PUT", `/api/v1/admin/upload-policy?organizationId=${DEMO_ORG}`, {
      session: source.author,
      headers: { "if-match": policy.headers["etag"] as string },
      body: { allowedTypes: ["pdf", "xlsx", "png"], maxBytes: 3145728, reason: "Synthetic demo upload policy" },
    }),
    200,
    "source upload policy",
  );
}, 600_000);

afterAll(async () => {
  for (const s of [source, target]) {
    await s?.api.close();
    if (s?.scratch) await dropScratchDatabase(inject("mthDb").adminUrl, s.scratch);
  }
}, 120_000);

describe("T-D6 demo -> clean installation round trip", () => {
  it("imports as drafts, publishes through the existing pipeline, and the published hashes equal the source's", async () => {
    const bundle = await exportAll(source, "Synthetic demo export (round trip)");
    expect(bundle.sourceEnvironment).toBe("demo");
    const sourceKeys = keysOf(bundle);
    const send = (m: string, u: string, o: Parameters<typeof call>[3]) => call<Body>(target.api.app, m, u, o);

    const up = ok(
      await send("POST", `${BASE}/imports?organizationId=${target.orgId}`, {
        session: target.author,
        body: bundle,
        headers: { "x-file-name": "demo-bundle.json" },
      }),
      201,
      "upload",
    );
    const v = ok(
      await send("POST", `${BASE}/imports/${up.id}/validate`, { session: target.author, headers: ifm(1) }),
      200,
      "validate",
    );
    const refusedOrConflict = (v.items as Body[]).filter((i) => i.action === "refused" || i.action === "conflict");
    expect(refusedOrConflict, JSON.stringify(refusedOrConflict)).toEqual([]);
    expect(v.status).toBe("validated");
    // The demo's changes arrive as new drafts; everything both installations got from the same migrations is identical.
    const procItem = (v.items as Body[]).find((i) => i.kind === "procedure" && i.action === "new_draft");
    expect(procItem).toBeDefined();
    const c = ok(
      await send("POST", `${BASE}/imports/${up.id}/commit`, { session: target.author, headers: ifm(2) }),
      200,
      "commit",
    );
    expect(c.status).toBe("committed");

    // Nothing was published by the commit; each Studio draft is now published by hand through the existing pipeline.
    const drafts = (c.items as Body[]).filter((i) => i.targetRecordType === "methodology_version");
    expect(drafts.length).toBeGreaterThanOrEqual(1);
    for (const d of drafts) {
      const before = ok(await send("GET", `${V}/${d.targetRecordId}`, { session: target.author }), 200, "draft");
      expect(before.status).toBe("draft");
      await publishDraft(target, d.targetRecordId);
      const after = ok(await send("GET", `${V}/${d.targetRecordId}`, { session: target.author }), 200, "published");
      expect(after.contentSha256).toBe(d.contentSha256);
    }
    // Job schedules arrive disabled.
    for (const i of (c.items as Body[]).filter((x) => x.kind === "job_schedule" && x.targetRecordId !== null)) {
      const row = await target.api.db
        .selectFrom("job_schedule")
        .select("enabled")
        .where("id", "=", i.targetRecordId)
        .executeTakeFirstOrThrow();
      expect(row.enabled).toBe(false);
    }

    // A re-export from the target has the same items and the same hashes.
    const again = await exportAll(target, "Synthetic re-export (round trip)");
    const sort = (k: Key[]) =>
      [...k].sort((a, b) => `${a.kind}:${a.itemCode}`.localeCompare(`${b.kind}:${b.itemCode}`));
    expect(sort(keysOf(again))).toEqual(sort(sourceKeys));
  }, 600_000);
});

// ------------------------------------------------------------------------------------------------ T-D7

const RATIONALE = "Synthetic demo decision; approves nothing real.";
const T = (t: string) => `/api/v1/transformations/${t}`;
/** The hand-made playbook change: a new mandatory G1 checklist item (beyond label/help, so G1 needs re-approval). */
const G1_CHECK = {
  type: "checklist_item",
  key: "synthetic.t-d7-g1-check",
  attributes: {
    labelEn: "Synthetic G1 check (T-D7)",
    labelAr: "بند تحقق تجريبي للبوابة الأولى",
    gateCode: "G1",
    mandatory: true,
  },
};

interface Installation extends Pick<Side, "scratch" | "api" | "author" | "reviewer"> {
  readonly orgId: string;
  readonly p: ApprovalWorld;
  readonly from: string; // the playbook version the running transformation is pinned to
}
let hand: Installation;
let imp: Installation;

/** A clean installation with a running transformation (pinned to the seeded playbook) whose G1 is approved. */
async function installation(name: string): Promise<Installation> {
  const { adminUrl } = inject("mthDb");
  const scratch = await createScratchDatabase(adminUrl, name);
  await migrate(roleUrl(adminUrl, scratch, "mth_owner"));
  const api = await startApi({ database: scratch });
  const w = await seedWorld(api.db);
  const p = await setupApprovalWorld(api, w);
  const r = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, r.id, "TO", { type: "organization", id: w.orgA.id }, w.orgA.id);
  // G1 approved through the real DG2 path (TL submits, SP decides with the three B0032 confirmations).
  await makeG1Ready(api, p);
  const sub = ok(
    await call<Body>(api.app, "POST", `${T(p.transformationId)}/gates/G1/submissions`, {
      session: p.lead.session,
      headers: ifm(await gateVersion(api, p, "G1")),
      body: {},
    }),
    201,
    "G1 submission",
  );
  ok(
    await call<Body>(api.app, "POST", `${T(p.transformationId)}/gates/G1/decision`, {
      session: p.sponsor.session,
      body: { submissionNo: sub.submissionNo, outcome: "approved", rationale: RATIONALE, agreements: G1_AGREEMENTS },
    }),
    201,
    "G1 decision",
  );
  const inst = {
    scratch,
    api,
    orgId: w.orgA.id,
    p,
    author: p.methodologyAdmin.session,
    reviewer: await signIn(api.app, r.subject),
    from: "",
  };
  return { ...inst, from: await pinOf(inst) };
}

const pinOf = async (i: Pick<Installation, "api" | "p">): Promise<string> =>
  (
    await i.api.db
      .selectFrom("transformation_config_pin")
      .select("methodology_version_id")
      .where("transformation_id", "=", i.p.transformationId)
      .where("kind", "=", "methodology")
      .executeTakeFirstOrThrow()
  ).methodology_version_id;

/** Methodology migrations and gate re-approvals of the installation's running transformation. */
async function migrationState(i: Installation): Promise<{ migrations: number; reapprovals: number }> {
  const m = await i.api.db
    .selectFrom("methodology_migration")
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .where("transformation_id", "=", i.p.transformationId)
    .executeTakeFirstOrThrow();
  const r = await i.api.db
    .selectFrom("gate_reapproval")
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .where("transformation_id", "=", i.p.transformationId)
    .executeTakeFirstOrThrow();
  return { migrations: Number(m.n), reapprovals: Number(r.n) };
}

const auditSeq = async (i: Installation): Promise<string> =>
  String(
    (
      await i.api.db
        .selectFrom("audit_event")
        .select((eb) => eb.fn.coalesce(eb.fn.max("seq"), sql<string>`0`).as("n"))
        .executeTakeFirstOrThrow()
    ).n,
  );
const outboxIds = async (i: Installation): Promise<Set<string>> =>
  new Set((await i.api.db.selectFrom("outbox_event").select("id").execute()).map((r) => r.id));

/** What a step created, as a sorted multiset without ids: audit (action, record type) and outbox event types. */
async function createdSince(i: Installation, seq: string, outboxBefore: Set<string>): Promise<Body> {
  const audit = await i.api.db
    .selectFrom("audit_event")
    .select(["action", "record_type"])
    .where(sql<boolean>`seq > ${seq}::bigint`)
    .execute();
  const outbox = (await i.api.db.selectFrom("outbox_event").select(["id", "event_type"]).execute()).filter(
    (r) => !outboxBefore.has(r.id),
  );
  return {
    audit: audit.map((a) => `${a.action} ${a.record_type}`).sort(),
    outbox: outbox.map((o) => o.event_type).sort(),
  };
}

/** The ADR-0040 path a person takes after a publish: plan (create), submit, SP approves, ADM_METHOD executes. */
async function runMigration(i: Installation, toVersionId: string): Promise<Body> {
  const send = (m: string, u: string, o: Parameters<typeof call>[3]) => call<Body>(i.api.app, m, u, o);
  const base = `${T(i.p.transformationId)}/methodology-migrations`;
  const created = ok(
    await send("POST", base, {
      session: i.p.methodologyAdmin.session,
      body: { configKind: "methodology", toVersionId, reason: "Synthetic migration to the newer playbook (T-D7)" },
    }),
    201,
    "create migration",
  );
  const submitted = ok(
    await send("POST", `${base}/${created.id}/submit`, {
      session: i.p.methodologyAdmin.session,
      headers: ifm(created.version),
    }),
    200,
    "submit migration",
  );
  const decided = ok(
    await send("POST", `${base}/${created.id}/decision`, {
      session: i.p.sponsor.session,
      headers: ifm(submitted.version),
      body: { outcome: "approve", rationale: RATIONALE },
    }),
    200,
    "decide migration",
  );
  const executed = ok(
    await send("POST", `${base}/${created.id}/execute`, {
      session: i.p.methodologyAdmin.session,
      headers: ifm(decided.version),
    }),
    200,
    "execute migration",
  );
  const reapprovals = await i.api.db
    .selectFrom("gate_reapproval")
    .select(["gate_code", "status", "work_item_id"])
    .where("transformation_id", "=", i.p.transformationId)
    .orderBy("gate_code")
    .execute();
  const history = await i.api.db
    .selectFrom("transformation_config_pin_history")
    .select(["kind"])
    .where("transformation_id", "=", i.p.transformationId)
    .execute();
  return {
    status: executed.status,
    plan: (created.items as Body[]).map((x) => [x.itemKind, x.stableKey, x.gateCode, x.resolution, x.detail?.reasons]),
    planReady: created.planReady,
    reapprovals: reapprovals.map((r) => [r.gate_code, r.status, r.work_item_id !== null]),
    pinHistory: history.map((h) => h.kind).sort(),
  };
}

describe("T-D7 an imported draft is published, and migrated to, exactly as a hand-made one", () => {
  beforeAll(async () => {
    [hand, imp] = [await installation("mth_cb_td7_hand"), await installation("mth_cb_td7_imp")];
  }, 600_000);
  afterAll(async () => {
    for (const s of [hand, imp]) {
      await s?.api.close();
      if (s?.scratch) await dropScratchDatabase(inject("mthDb").adminUrl, s.scratch);
    }
  }, 120_000);

  it("the pin is unchanged by the commit and the publish; the publish and migration records equal a hand-made publish's", async () => {
    // Both installations start alike: the same seeded playbook pinned, G1 approved, no migration, no re-approval.
    expect(imp.from).not.toBe("");
    for (const i of [hand, imp]) expect(await migrationState(i)).toEqual({ migrations: 0, reapprovals: 0 });

    // hand: the change is made by hand in Studio (draft from the pinned published version, one element put).
    const draft = ok(
      await call<Body>(hand.api.app, "POST", V, { session: hand.author, body: { basedOnVersionId: hand.from } }),
      201,
      "hand draft",
    );
    const put = ok(
      await call<Body>(hand.api.app, "PUT", `${V}/${draft.id}/elements/${G1_CHECK.type}/${G1_CHECK.key}`, {
        session: hand.author,
        headers: ifm(draft.version),
        body: { attributes: G1_CHECK.attributes },
      }),
      200,
      "hand element put",
    );
    expect(put.status).toBe("draft");
    const handSeq = await auditSeq(hand);
    const handOutbox = await outboxIds(hand);
    const handPublished = await publishDraft(hand, draft.id);
    const handPublish = await createdSince(hand, handSeq, handOutbox);
    // A publish moves no pin and starts no migration (ADR-0014, ADR-0040 §1).
    expect(await pinOf(hand)).toBe(hand.from);
    expect(await migrationState(hand)).toEqual({ migrations: 0, reapprovals: 0 });

    // imp: the same change arrives as hand's exported bundle and is committed as a draft.
    const created = ok(
      await call<Body>(hand.api.app, "POST", `${BASE}/exports?organizationId=${hand.orgId}`, {
        session: hand.author,
        body: { kinds: ["methodology"], reason: "Synthetic export of the hand-made playbook change (T-D7)" },
      }),
      201,
      "export",
    );
    const download = await call<Body>(hand.api.app, "GET", `${BASE}/exports/${created.id}/download`, {
      session: hand.author,
    });
    expect(download.status).toBe(200);
    const bundle = JSON.parse(download.raw.body);
    const playbook = (bundle.items as Body[]).find((x) => x.kind === "methodology" && x.itemCode === "playbook");
    expect(playbook?.contentSha256).toBe(handPublished.contentSha256);
    const send = (m: string, u: string, o: Parameters<typeof call>[3]) => call<Body>(imp.api.app, m, u, o);
    const up = ok(
      await send("POST", `${BASE}/imports?organizationId=${imp.orgId}`, {
        session: imp.author,
        body: bundle,
        headers: { "x-file-name": "hand-playbook.json" },
      }),
      201,
      "upload",
    );
    const v = ok(
      await send("POST", `${BASE}/imports/${up.id}/validate`, { session: imp.author, headers: ifm(1) }),
      200,
      "validate",
    );
    expect(v.status).toBe("validated");
    expect((v.items as Body[]).filter((x) => x.action !== "identical").map((x) => [x.itemCode, x.action])).toEqual([
      ["playbook", "new_draft"],
    ]);
    const c = ok(
      await send("POST", `${BASE}/imports/${up.id}/commit`, { session: imp.author, headers: ifm(v.version) }),
      200,
      "commit",
    );
    const committed = (c.items as Body[]).find((x) => x.itemCode === "playbook");
    const importedDraft = ok(
      await send("GET", `${V}/${committed.targetRecordId}`, { session: imp.author }),
      200,
      "draft",
    );
    expect(importedDraft.status).toBe("draft");
    // The commit moves no pin and starts no migration.
    expect(await pinOf(imp)).toBe(imp.from);
    expect(await migrationState(imp)).toEqual({ migrations: 0, reapprovals: 0 });

    const impSeq = await auditSeq(imp);
    const impOutbox = await outboxIds(imp);
    const impPublished = await publishDraft(imp, committed.targetRecordId);
    const impPublish = await createdSince(imp, impSeq, impOutbox);
    expect(impPublished.contentSha256).toBe(handPublished.contentSha256);
    // The publish moves no pin and starts no migration: "the pin is unchanged until then".
    expect(await pinOf(imp)).toBe(imp.from);
    expect(await migrationState(imp)).toEqual({ migrations: 0, reapprovals: 0 });
    // The publish of the imported draft creates the same records as the hand-made publish.
    expect(impPublish).toEqual(handPublish);
    expect(handPublish.audit).toContain("methodology_version.publish methodology_version");

    // The same ADR-0040 migration in both: the same plan, the G1 re-approval, the pin moved with its history.
    const handSeq2 = await auditSeq(hand);
    const handOutbox2 = await outboxIds(hand);
    const impSeq2 = await auditSeq(imp);
    const impOutbox2 = await outboxIds(imp);
    const handMigration = await runMigration(hand, handPublished.id);
    const impMigration = await runMigration(imp, impPublished.id);
    expect(impMigration).toEqual(handMigration);
    expect(handMigration.status).toBe("executed");
    expect(handMigration.planReady).toBe(true);
    expect(handMigration.plan).toContainEqual([
      "reapproval",
      "G1",
      "G1",
      "automatic",
      [{ elementType: "checklist_item", stableKey: G1_CHECK.key, change: "added" }],
    ]);
    expect(handMigration.reapprovals).toEqual([["G1", "required", true]]);
    expect(await pinOf(hand)).toBe(handPublished.id);
    expect(await pinOf(imp)).toBe(impPublished.id);
    const handMigrationRecords = await createdSince(hand, handSeq2, handOutbox2);
    expect(await createdSince(imp, impSeq2, impOutbox2)).toEqual(handMigrationRecords);
    // Not vacuous: the compared sets hold the migration, the pin move and the re-approval.
    expect(handMigrationRecords.audit).toContain("methodology_migration.execute methodology_migration");
    expect(handMigrationRecords.outbox.length).toBeGreaterThan(0);
    expect(handMigrationRecords.audit.some((a: string) => a.endsWith(" gate_reapproval"))).toBe(true);
    expect(handMigrationRecords.audit.some((a: string) => a.endsWith(" transformation_config_pin"))).toBe(true);
  }, 600_000);
});
