// A06 replay on an imported configuration bundle (qa-verifier, T-DG7-QA-B; p7-work-split §D.3 "A06 replay" and §D.6
// REQ-S19-008 "and its published versions behave identically"; §B.8 REQ-S01-001 A02 row for the re-run).
//
// Procedure (ADR-0065 §7, the T-D6 path, then the A06 assertions):
//   source = the demo installation (migrations + the synthetic demo seed, MTH_ENV=demo). Through the existing Studio
//            operations only, a new version of each A06-relevant key is published there (forms, playbook,
//            scoring-defaults and one procedure), a job schedule and the demo upload policy are changed.
//   bundle = POST /admin/config-bundles/exports (all kinds) on the source, downloaded as the bundle file.
//   target = a clean installation (migrations only) with the A06 synthetic world. The bundle is uploaded, validated
//            and committed into organization A; every imported Studio draft is published through the existing
//            preview / compatibility / review / publish operations; each published content hash must equal the
//            bundle item's contentSha256, and the newest published forms, playbook, scoring-defaults and procedure
//            versions of the target must be the imported ones.
//   replay = the complete A06 suite (tests/qa/support/a06-suite.ts, the same assertions as
//            a06-configuration-change.test.ts) then runs on the target, so every A06 Studio change starts from the
//            imported published versions, and the existing transformation of A06 is pinned to them.
// A closing block checks that the imported versions are still published and unchanged after A06 (immutability).
//
// Every value is SYNTHETIC. The Studio reviews are configuration reviews on test data; nothing here is a business,
// Finance or IT approval, and no DG0-DG7 record is touched.
import { afterAll, describe, expect, inject, it } from "vitest";
import { migrate, seedDemo } from "../../../packages/db/src/index.ts";
import { DEMO_ANCHORS } from "../../../packages/db/src/demo/data/kpis.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../packages/db/test/helpers.ts";
import { defineA06Suite, type A06Target } from "../support/a06-suite.ts";
import { call, createUser, grant, signIn, startApi, type Res, type Session, type TestApi } from "../support/api.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
type App = TestApi["app"];

const BASE = "/api/v1/admin/config-bundles";
const V = "/api/v1/admin/methodology-versions";
const DEMO_ORG = DEMO_ANCHORS.organizationId;
const ifm = (v: number | string) => ({ "if-match": `"${v}"` });

/** The A06-relevant Studio keys a new source version is published for (kind, key; the procedure key is resolved). */
const STUDIO_KEYS: { kind: string; key: string | null }[] = [
  { kind: "form_schema", key: "forms" },
  { kind: "methodology", key: "playbook" },
  { kind: "scoring_defaults", key: "scoring-defaults" },
  { kind: "procedure", key: null },
];

let sourceApi: TestApi | undefined;
let sourceDb: string | undefined;
/** What the closing block re-checks: target version id -> the bundle item's contentSha256. */
const imported = new Map<string, { kind: string; key: string; contentSha256: string }>();

function ok(res: Res<Body>, status: number, what: string): Body {
  expect(res.status, `${what}: ${JSON.stringify(res.body).slice(0, 800)}`).toBe(status);
  return res.body;
}

/**
 * Publishes Studio draft `id` through the existing operations (preview, compatibility, the source-coverage run for the
 * methodology kind, configured review, publish) - the same steps as the A06 suite's `runPipeline`.
 */
async function publishDraft(app: App, author: Session, reviewer: Session, id: string, kind: string): Promise<Body> {
  const current = async () => ok(await call<Body>(app, "GET", `${V}/${id}`, { session: author }), 200, "get version");
  ok(
    await call<Body>(app, "POST", `${V}/${id}/preview`, {
      session: author,
      headers: ifm((await current()).version),
      body: { samples: [] },
    }),
    201,
    "preview",
  );
  ok(
    await call<Body>(app, "POST", `${V}/${id}/compatibility-checks`, {
      session: author,
      headers: ifm((await current()).version),
    }),
    201,
    "compatibility",
  );
  if (kind === "methodology")
    expect(["pass", "warn"]).toContain(
      ok(
        await call<Body>(app, "POST", "/api/v1/admin/source-coverage/runs", {
          session: author,
          body: { versionId: id },
        }),
        201,
        "source coverage",
      ).result,
    );
  if ((await current()).reviewRequired) {
    const sub = ok(
      await call<Body>(app, "POST", `${V}/${id}/submit-review`, {
        session: author,
        headers: ifm((await current()).version),
        body: {},
      }),
      201,
      "submit review",
    );
    ok(
      await call<Body>(app, "POST", `${V}/${id}/reviews/${sub.id}/decision`, {
        session: reviewer,
        headers: ifm(1),
        body: { outcome: "approve" },
      }),
      200,
      "review decision",
    );
  }
  const pub = ok(
    await call<Body>(app, "POST", `${V}/${id}/publish`, { session: author, headers: ifm((await current()).version) }),
    200,
    "publish",
  );
  expect(pub.status).toBe("published");
  return pub;
}

async function newestPublishedOf(app: App, session: Session, kind: string, key: string): Promise<Body> {
  const r = ok(await call<Body>(app, "GET", `${V}?kind=${kind}&status=published`, { session }), 200, "list");
  const items = (r.items as Body[]).filter((v) => v.key === key);
  expect(items.length, `published ${kind}/${key}`).toBeGreaterThan(0);
  return items.find((v) => v.isNewestPublished) ?? items[0];
}

/** Builds the demo source, changes it through the existing operations and returns the downloaded bundle. */
async function demoBundle(): Promise<{ bundle: Body; changed: { kind: string; key: string; titleEn: string }[] }> {
  const { adminUrl } = inject("mthDb");
  sourceDb = await createScratchDatabase(adminUrl, "mth_qa_a06_replay_src");
  await migrate(roleUrl(adminUrl, sourceDb, "mth_owner"));
  await seedDemo(roleUrl(adminUrl, sourceDb, "mth_owner"), {
    mthEnv: "demo",
    runKind: "seed",
    requestedVia: "cli",
    requestedBy: null,
  });
  sourceApi = await startApi({ database: sourceDb, env: { MTH_ENV: "demo" } });
  const s = sourceApi;
  const scope = { type: "organization" as const, id: DEMO_ORG };
  const mk = async (roles: string[]) => {
    const u = await createUser(s.db, DEMO_ORG);
    for (const r of roles) await grant(s.db, DEMO_ANCHORS.users.sp, u.id, r, scope, DEMO_ORG);
    return signIn(s.app, u.subject);
  };
  const author = await mk(["ADM_METHOD", "ADM_TECH", "TO"]);
  const reviewer = await mk(["TO"]);

  const changed: { kind: string; key: string; titleEn: string }[] = [];
  for (const k of STUDIO_KEYS) {
    const key =
      k.key ??
      (
        await s.db
          .selectFrom("methodology_version")
          .select("key")
          .where("config_kind", "=", "procedure")
          .where("status", "=", "published")
          .orderBy("key")
          .executeTakeFirstOrThrow()
      ).key;
    const base = await newestPublishedOf(s.app, author, k.kind, key);
    const draft = ok(
      await call<Body>(s.app, "POST", V, {
        session: author,
        body: { basedOnVersionId: base.id, changeSummary: `Synthetic demo change of ${key} (A06 replay source)` },
      }),
      201,
      `source draft ${k.kind}/${key}`,
    );
    const titleEn = `Synthetic ${key} (A06 replay source)`;
    ok(
      await call<Body>(s.app, "PATCH", `${V}/${draft.id}`, {
        session: author,
        headers: ifm(draft.version),
        body: { titleEn },
      }),
      200,
      `source edit ${k.kind}/${key}`,
    );
    await publishDraft(s.app, author, reviewer, draft.id, k.kind);
    changed.push({ kind: k.kind, key, titleEn });
  }
  const job = await s.db
    .selectFrom("job_schedule")
    .select(["code", "version"])
    .orderBy("code")
    .executeTakeFirstOrThrow();
  ok(
    await call<Body>(s.app, "PATCH", `/api/v1/admin/job-schedules/${job.code}`, {
      session: author,
      headers: ifm(job.version),
      body: { cron: "17 3 * * *" },
    }),
    200,
    "source job schedule",
  );
  const policy = await call<Body>(s.app, "GET", `/api/v1/admin/upload-policy?organizationId=${DEMO_ORG}`, {
    session: author,
  });
  ok(
    await call<Body>(s.app, "PUT", `/api/v1/admin/upload-policy?organizationId=${DEMO_ORG}`, {
      session: author,
      headers: { "if-match": policy.headers["etag"] as string },
      body: { allowedTypes: ["pdf", "xlsx", "png"], maxBytes: 3145728, reason: "Synthetic demo upload policy (A06)" },
    }),
    200,
    "source upload policy",
  );

  const created = ok(
    await call<Body>(s.app, "POST", `${BASE}/exports?organizationId=${DEMO_ORG}`, {
      session: author,
      body: { reason: "Synthetic demo export (A06 replay)" },
    }),
    201,
    "export",
  );
  const download = await call<Body>(s.app, "GET", `${BASE}/exports/${created.id}/download`, { session: author });
  expect(download.status).toBe(200);
  return { bundle: JSON.parse(download.raw.body), changed };
}

/** The hook: import the demo bundle into organization A of the A06 target and publish what it brought. */
async function importIntoTarget({ api, w, reviewer }: A06Target): Promise<void> {
  const { bundle, changed } = await demoBundle();
  expect(bundle.bundleSchemaVersion).toBe("mth-config-bundle/1");
  expect(bundle.sourceEnvironment).toBe("demo");

  const a = await createUser(api.db, w.orgA.id);
  for (const r of ["ADM_METHOD", "ADM_TECH", "TO"])
    await grant(api.db, w.grantor.id, a.id, r, { type: "organization", id: w.orgA.id }, w.orgA.id);
  const author = await signIn(api.app, a.subject);
  const send = (m: string, u: string, o: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);

  const up = ok(
    await send("POST", `${BASE}/imports?organizationId=${w.orgA.id}`, {
      session: author,
      body: bundle,
      headers: { "x-file-name": "a06-replay-bundle.json" },
    }),
    201,
    "upload",
  );
  const v = ok(
    await send("POST", `${BASE}/imports/${up.id}/validate`, { session: author, headers: ifm(up.version ?? 1) }),
    200,
    "validate",
  );
  const blocked = (v.items as Body[]).filter((i) => i.action === "refused" || i.action === "conflict");
  expect(blocked, JSON.stringify(blocked)).toEqual([]);
  expect(v.status).toBe("validated");
  for (const c of changed) {
    const item = (v.items as Body[]).find((i) => i.kind === c.kind && i.itemCode === c.key);
    expect(item, `plan item ${c.kind}/${c.key}`).toBeDefined();
    expect(item.action, `${c.kind}/${c.key}`).toBe("new_draft");
  }
  const committed = ok(
    await send("POST", `${BASE}/imports/${up.id}/commit`, { session: author, headers: ifm(v.version ?? 2) }),
    200,
    "commit",
  );
  expect(committed.status).toBe("committed");

  // The commit published nothing; every Studio draft is published by hand through the existing pipeline.
  const drafts = (committed.items as Body[]).filter((i) => i.targetRecordType === "methodology_version");
  for (const c of changed)
    expect(
      drafts.some((d) => d.kind === c.kind && d.itemCode === c.key),
      `draft for ${c.kind}/${c.key}`,
    ).toBe(true);
  for (const d of drafts) {
    const before = ok(await send("GET", `${V}/${d.targetRecordId}`, { session: author }), 200, "draft");
    expect(before.status).toBe("draft");
    await publishDraft(api.app, author, reviewer, d.targetRecordId, d.kind);
    const after = ok(await send("GET", `${V}/${d.targetRecordId}`, { session: author }), 200, "published");
    expect(after.contentSha256).toBe(d.contentSha256);
    const bundled = (bundle.items as Body[]).find((i) => i.kind === d.kind && i.itemCode === d.itemCode);
    expect(after.contentSha256).toBe(bundled.contentSha256);
    imported.set(d.targetRecordId, { kind: d.kind, key: d.itemCode, contentSha256: d.contentSha256 });
  }
  // The A06 starting point on the target is the imported configuration.
  for (const c of changed) {
    const newest = await newestPublishedOf(api.app, author, c.kind, c.key);
    expect(imported.has(newest.id), `${c.kind}/${c.key} newest published is the imported version`).toBe(true);
    expect(newest.titleEn).toBe(c.titleEn);
  }
  // Job schedules arrive disabled (ADR-0065; D.7).
  for (const i of (committed.items as Body[]).filter((x) => x.kind === "job_schedule" && x.targetRecordId !== null)) {
    const row = await api.db
      .selectFrom("job_schedule")
      .select("enabled")
      .where("id", "=", i.targetRecordId)
      .executeTakeFirstOrThrow();
    expect(row.enabled).toBe(false);
  }
  // The source is no longer needed; free it before the A06 suite runs.
  await sourceApi?.close();
  sourceApi = undefined;
  if (sourceDb) await dropScratchDatabase(inject("mthDb").adminUrl, sourceDb);
  sourceDb = undefined;
  targetApp = api.app;
  targetSession = author;
}

let targetApp: App | undefined;
let targetSession: Session | undefined;

afterAll(async () => {
  await sourceApi?.close();
  if (sourceDb) await dropScratchDatabase(inject("mthDb").adminUrl, sourceDb);
}, 120_000);

defineA06Suite({ dbName: "mth_qa_a06_replay_dst", prepareTarget: importIntoTarget, setupTimeoutMs: 900_000 });

describe("A06 replay closure (REQ-S19-008): the imported published versions are unchanged after the A06 run", () => {
  it("every imported Studio version is still published with the bundle's content hash", async () => {
    expect(imported.size).toBeGreaterThanOrEqual(STUDIO_KEYS.length);
    for (const [id, item] of imported) {
      const r = ok(
        await call<Body>(targetApp as App, "GET", `${V}/${id}`, { session: targetSession as Session }),
        200,
        `imported ${item.kind}/${item.key}`,
      );
      expect([r.status, r.contentSha256]).toEqual(["published", item.contentSha256]);
    }
  });
});
