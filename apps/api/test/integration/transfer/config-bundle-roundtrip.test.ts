// T-D6 (ADR-0065 §7; p7-work-split §D.3; REQ-S19-008 "a bundle exported from the demo installation imports into a
// clean one, and its published versions behave identically"; T-DG7-BE-F): two scratch databases of this run's disposable
// PostgreSQL cluster.
//   source = the demo installation (migrations + the synthetic demo seed), where a procedures version, a job schedule
//            and the demo organization's upload policy are changed through their existing operations;
//   target = a clean installation (migrations only, one bootstrapped synthetic organization).
// demo -> export all kinds -> upload, validate, commit into the target -> publish every imported Studio draft through
// the existing preview, compatibility, review and publish operations -> every published content hash in the target
// equals the source item's contentSha256, and a re-export from the target has the same items and hashes.
// The A06 replay on the target is QA-B's (tests/qa/**), not this file. Every value is SYNTHETIC; nothing here is a
// business, Finance or IT approval (the Studio review is a configuration review), and no DG0-DG7 record is touched.
import { migrate, seedDemo } from "@mth/db";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { DEMO_ANCHORS } from "../../../../../packages/db/src/demo/data/kpis.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../../packages/db/test/helpers.ts";
import {
  call,
  createOrg,
  createUser,
  grant,
  signIn,
  startApi,
  type Session,
  type TestApi,
} from "../../support/harness.ts";

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

/** Publishes Studio draft `id` through the existing operations (preview, compatibility, review, publish). */
async function publishDraft(s: Side, id: string): Promise<Body> {
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
