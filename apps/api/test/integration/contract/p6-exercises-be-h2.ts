// P6 contract exercises of BE-H2 (p6-work-split §J/C.9 and §2 rule 16; T-DG6-BE-H2): the three Administration > Storage
// operations, each with a success and every declared refusal it can reach, through the validating client. The storage
// setting is installation-wide and the contract suite shares its database with concurrently running files, so this
// exercise NEVER saves an s3 setting there (every upload elsewhere keeps using the filesystem store): the s3 test runs
// against the in-process fake S3 (never a real object store), and the only saved row is a filesystem one, which equals
// the environment default. Every value is synthetic.
import { expect } from "vitest";
import type { z } from "zod";
import { storageSettingView, storageTestResult } from "../../../src/modules/admin/storage.ts";
import { FakeS3 } from "../../support/fake-s3.ts";
import { signIn, type P6ExerciseContext } from "../../support/harness.ts";

export const P6_MIRRORS_BE_H2: Readonly<Record<string, z.ZodType>> = {
  getStorageSetting: storageSettingView,
  putStorageSetting: storageSettingView,
  testStorageSetting: storageTestResult,
};

const ACCESS_VAR = "MTH_CONTRACT_S3_ACCESS_KEY";
const SECRET_VAR = "MTH_CONTRACT_S3_SECRET_KEY";

export async function exerciseP6BeH2Operations(ctx: P6ExerciseContext): Promise<void> {
  const { api, world: w, mirrored } = ctx;
  const admin = await signIn(api.app, w.admin.subject);
  const auditor = await signIn(api.app, w.auditor.subject);
  const nobody = await signIn(api.app, w.nobody.subject);
  const S = "/api/v1/admin/storage";
  const T = "/api/v1/admin/storage/test";

  // getStorageSetting: 200 (ADM_TECH; AUD through operations.read); 400; 401; 403. (404 is unreachable: no parameter.)
  const got = await mirrored("GET", S, { session: auditor });
  expect(got.status).toBe(200);
  expect(got.body).toMatchObject({ driver: "filesystem", publicUrls: false });
  expect((await mirrored("GET", S, { session: admin })).status).toBe(200);
  expect((await mirrored("GET", `${S}?organizationId=${w.orgA.id}`, { session: admin })).status).toBe(400);
  expect((await mirrored("GET", S)).status).toBe(401);
  expect((await mirrored("GET", S, { session: nobody })).status).toBe(403);

  const fake = new FakeS3({ buckets: ["mth-contract"] });
  await fake.start();
  process.env[ACCESS_VAR] = fake.credentials[0]!.accessKeyId;
  process.env[SECRET_VAR] = fake.credentials[0]!.secretAccessKey;
  try {
    const s3 = {
      endpoint: fake.endpoint,
      region: fake.region,
      bucket: "mth-contract",
      keyPrefix: "contract",
      forcePathStyle: true,
      accessKeyRef: { provider: "env", name: ACCESS_VAR },
      secretKeyRef: { provider: "env", name: SECRET_VAR },
    };

    // testStorageSetting: 200 passed (an s3 candidate against the fake; the saved/environment filesystem store);
    // 200 failed (wrong credentials); 400; 401; 403 (AUD); 422. (404 is unreachable: no parameter.)
    const passed = await mirrored("POST", T, { session: admin, body: { candidate: s3 } });
    expect(passed.status).toBe(200);
    expect(passed.body).toMatchObject({ outcome: "passed", driver: "s3", errorCode: null });
    expect(JSON.stringify(passed.body)).not.toContain(fake.endpoint);
    expect(fake.keys("mth-contract")).toEqual([]);
    const local = await mirrored("POST", T, { session: admin, body: { candidate: null } });
    expect(local.body).toMatchObject({ outcome: "passed", driver: "filesystem" });
    const wrong = await mirrored("POST", T, {
      session: admin,
      body: { candidate: { ...s3, secretKeyRef: { provider: "env", name: "MTH_CONTRACT_S3_UNSET" } } },
    });
    expect(wrong.body).toMatchObject({ outcome: "failed", errorCode: "storage.write_failed" });
    expect((await mirrored("POST", T, { session: admin, body: {} })).status).toBe(400);
    expect((await mirrored("POST", T, { body: { candidate: null } })).status).toBe(401);
    expect((await mirrored("POST", T, { session: auditor, body: { candidate: null } })).status).toBe(403);
    const asValue = await mirrored("POST", T, {
      session: admin,
      body: { candidate: { ...s3, secretKeyRef: "synthetic-secret-value" } },
    });
    expect([asValue.status, asValue.body.code]).toEqual([422, "storage.secret_ref_invalid"]);

    // putStorageSetting: 200 create ("0", filesystem) and update; 400; 401; 403 (AUD); 409; 422 (each code); 428.
    const put = (b: unknown, ifMatch: string | null, session = admin) =>
      mirrored("PUT", S, { session, body: b, headers: ifMatch === null ? {} : { "if-match": ifMatch } });
    const filesystem = { driver: "filesystem", s3: null, reason: "Synthetic contract exercise: filesystem" };
    expect((await put(filesystem, null)).status).toBe(428);
    const before = (await mirrored("GET", S, { session: admin })).headers["etag"] as string;
    const created = await put(filesystem, before);
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ driver: "filesystem", source: "setting", publicUrls: false });
    const v = created.body.version as number;
    expect(created.headers["etag"]).toBe(`"${v}"`);
    expect((await put(filesystem, before)).status).toBe(409);
    expect((await put({ ...filesystem, reason: "  " }, `"${v}"`)).body.code).toBe("admin.reason_required");
    expect((await put({ driver: "s3", s3: null, reason: "Synthetic" }, `"${v}"`)).body.code).toBe(
      "storage.s3_incomplete",
    );
    const untested = await put(
      { driver: "s3", s3: { ...s3, keyPrefix: "never-tested" }, reason: "Synthetic" },
      `"${v}"`,
    );
    expect([untested.status, untested.body.code]).toEqual([422, "storage.test_required"]);
    const refValue = await put(
      { driver: "s3", s3: { ...s3, accessKeyRef: "AKIA-synthetic" }, reason: "Synthetic" },
      `"${v}"`,
    );
    expect([refValue.status, refValue.body.code]).toEqual([422, "storage.secret_ref_invalid"]);
    expect((await put({ driver: "tape", s3: null, reason: "Synthetic" }, `"${v}"`)).status).toBe(400);
    expect((await mirrored("PUT", S, { body: filesystem, headers: { "if-match": `"${v}"` } })).status).toBe(401);
    expect((await put(filesystem, `"${v}"`, auditor)).status).toBe(403);
    const updated = await put({ ...filesystem, reason: "Synthetic contract exercise: again" }, `"${v}"`);
    expect(updated.body).toMatchObject({ driver: "filesystem", version: v + 1 });
  } finally {
    delete process.env[ACCESS_VAR];
    delete process.env[SECRET_VAR];
    await fake.stop();
  }
}
