// P7 contract exercises of BE-F (p7-work-split §D.1, §D.3 T-D9; §2 rule 1 with p6-work-split §2 rule 16; T-DG7-BE-F):
// the nine configuration-bundle operations, each with its success and the declared refusals it can reach, through the
// contract-validating client `mirrored` (success bodies also checked against the zod mirrors below).
// The contract suite shares one database with other suites, so the exercise works in its OWN synthetic organization
// and only with that organization's upload policy (a per-organization kind): the committed import changes nothing any
// other suite reads. Every value is SYNTHETIC. A bundle approves nothing (no G1-G6, Finance or IT approval) and touches
// no DG0-DG7 record.
import { transferSha256 } from "@mth/db";
import { contentSha256 } from "@mth/shared/transfer";
import { expect } from "vitest";
import type { z } from "zod";
import {
  configBundleExportPage,
  configBundleExportView,
  configBundleImportPage,
  configBundleImportView,
} from "../../../src/modules/transfer/config-bundle/service.ts";
import { createOrg, createUser, grant, signIn, type P6ExerciseContext } from "../../support/harness.ts";

export const P7_MIRRORS_BE_F: Readonly<Record<string, z.ZodType>> = {
  listConfigBundleExports: configBundleExportPage,
  createConfigBundleExport: configBundleExportView,
  getConfigBundleExport: configBundleExportView,
  listConfigBundleImports: configBundleImportPage,
  uploadConfigBundleImport: configBundleImportView,
  getConfigBundleImport: configBundleImportView,
  validateConfigBundleImport: configBundleImportView,
  commitConfigBundleImport: configBundleImportView,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

const BASE = "/api/v1/admin/config-bundles";
const MISSING = "01900000-0000-7000-8000-00000000beef";

export async function exerciseP7BeFOperations(ctx: P6ExerciseContext): Promise<void> {
  const { api, world: w, mirrored: m } = ctx;
  // A synthetic organization of this exercise only, with its own ADM_TECH.
  const org = await createOrg(api.db);
  const techUser = await createUser(api.db, org.id);
  await grant(api.db, w.grantor.id, techUser.id, "ADM_TECH", { type: "organization", id: org.id }, org.id);
  const tech = await signIn(api.app, techUser.subject);
  const auditor = await signIn(api.app, w.auditor.subject);
  const q = `?organizationId=${org.id}`;
  const status = async (
    p: Promise<{ status: number; body: Body; headers?: Body }>,
    expected: number,
    code?: string,
  ) => {
    const res = await p;
    expect(res.status, JSON.stringify(res.body)).toBe(expected);
    if (code) expect(res.body.code).toBe(code);
    return res;
  };

  // createConfigBundleExport: 422 nothing published (the new organization has no policy yet), 400, 403, 404, 201.
  await status(
    m("POST", `${BASE}/exports${q}`, { session: tech, body: { kinds: ["upload_policy"], reason: "Synthetic export" } }),
    422,
    "config_bundle.nothing_published",
  );
  const policy = await m("PUT", `/api/v1/admin/upload-policy${q}`, {
    session: tech,
    headers: { "if-match": '"0"' },
    body: { allowedTypes: ["pdf", "csv"], maxBytes: 2097152, reason: "Synthetic contract policy" },
  });
  expect(policy.status).toBe(200);
  await status(m("POST", `${BASE}/exports${q}`, { session: tech, body: { reason: "x" } }), 400);
  // T-DG7-BE-F2: automation_rule never travels (ADR-0065 §2, Residual 1): 422 unportable_reference, nothing written.
  await status(
    m("POST", `${BASE}/exports${q}`, {
      session: tech,
      body: { kinds: ["automation_rule"], reason: "Synthetic export of an unportable kind" },
    }),
    422,
    "config_bundle.unportable_reference",
  );
  await status(
    m("POST", `${BASE}/exports${q}`, { session: auditor, body: { reason: "Synthetic export" } }),
    403,
    "forbidden",
  );
  await status(
    m("POST", `${BASE}/exports?organizationId=${MISSING}`, { session: tech, body: { reason: "Synthetic export" } }),
    404,
  );
  const created = await status(
    m("POST", `${BASE}/exports${q}`, {
      session: tech,
      body: { kinds: ["upload_policy"], reason: "Synthetic contract export" },
    }),
    201,
  );
  const exportId = created.body.id as string;
  expect(created.body).toMatchObject({
    itemCount: 1,
    kinds: ["upload_policy"],
    bundleSchemaVersion: "mth-config-bundle/1",
  });

  // getConfigBundleExport / downloadConfigBundleExport / listConfigBundleExports: 200, 400, 403, 404.
  await status(m("GET", `${BASE}/exports/${exportId}`, { session: tech }), 200);
  await status(m("GET", `${BASE}/exports/${exportId}`, { session: auditor }), 403, "forbidden");
  await status(m("GET", `${BASE}/exports/${MISSING}`, { session: tech }), 404);
  const download = await status(m("GET", `${BASE}/exports/${exportId}/download`, { session: tech }), 200);
  const bundle = download.body as Body;
  expect(bundle.exportId).toBe(exportId);
  await status(m("GET", `${BASE}/exports/${exportId}/download`, { session: auditor }), 403, "forbidden");
  await status(m("GET", `${BASE}/exports/${MISSING}/download`, { session: tech }), 404);
  const exports = await status(m("GET", `${BASE}/exports${q}&limit=1`, { session: tech }), 200);
  expect(exports.body.items).toHaveLength(1);
  await status(m("GET", `${BASE}/exports${q}&cursor=not-a-cursor`, { session: tech }), 400);
  await status(m("GET", `${BASE}/exports${q}`, { session: auditor }), 403, "forbidden");
  await status(m("GET", `${BASE}/exports?organizationId=${MISSING}`, { session: tech }), 404);

  // uploadConfigBundleImport: 422 unknown version, 422 checksum, 422 item invalid, 400, 403, 404, 413, 201.
  const file = { "x-file-name": "synthetic-bundle.json" };
  const up = (body: unknown, session = tech, url = `${BASE}/imports${q}`) =>
    m("POST", url, { session, body, headers: file });
  await status(
    up({ ...bundle, bundleSchemaVersion: "mth-config-bundle/2" }),
    422,
    "config_bundle.schema_version_unsupported",
  );
  const item = bundle.items[0];
  await status(
    up({ ...bundle, items: [{ ...item, content: { ...item.content, maxBytes: 1 } }] }),
    422,
    "config_bundle.checksum_mismatch",
  );
  const badContent = { ...item.content, allowedTypes: ["exe"] };
  const badItem = { ...item, content: badContent, contentSha256: contentSha256(badContent, (t) => transferSha256(t)) };
  await status(up({ ...bundle, items: [badItem] }), 422, "config_bundle.item_invalid");
  await status(up({ ...bundle, exportId: "not-a-uuid" }), 400);
  await status(up(bundle, auditor), 403, "forbidden");
  await status(up(bundle, tech, `${BASE}/imports?organizationId=${MISSING}`), 404);
  const big = { ...bundle, appVersion: "x", padding: "y".repeat(5 * 1024 * 1024) };
  await status(up(big), 413, "config_bundle.too_large");
  const uploaded = await status(up(bundle), 201);
  const importId = uploaded.body.id as string;
  expect(uploaded.body).toMatchObject({ status: "uploaded", version: 1, items: [] });

  // getConfigBundleImport / listConfigBundleImports: 200, 400, 403, 404.
  await status(m("GET", `${BASE}/imports/${importId}`, { session: tech }), 200);
  await status(m("GET", `${BASE}/imports/${importId}`, { session: auditor }), 403, "forbidden");
  await status(m("GET", `${BASE}/imports/${MISSING}`, { session: tech }), 404);
  const imports = await status(m("GET", `${BASE}/imports${q}&limit=1`, { session: tech }), 200);
  expect(imports.body.items).toHaveLength(1);
  await status(m("GET", `${BASE}/imports${q}&cursor=not-a-cursor`, { session: tech }), 400);
  await status(m("GET", `${BASE}/imports${q}`, { session: auditor }), 403, "forbidden");

  // validateConfigBundleImport: 428, 409, 403, 404, 200; commitConfigBundleImport: 428, 409, 403, 404, 200, 422.
  const at = (v: number) => ({ "if-match": `"${v}"` });
  await status(m("POST", `${BASE}/imports/${importId}/validate`, { session: tech }), 428);
  await status(m("POST", `${BASE}/imports/${importId}/validate`, { session: tech, headers: at(9) }), 409);
  await status(
    m("POST", `${BASE}/imports/${importId}/validate`, { session: auditor, headers: at(1) }),
    403,
    "forbidden",
  );
  await status(m("POST", `${BASE}/imports/${MISSING}/validate`, { session: tech, headers: at(1) }), 404);
  await status(
    m("POST", `${BASE}/imports/${importId}/commit`, { session: tech, headers: at(1) }),
    422,
    "config_bundle.not_committable",
  );
  const validated = await status(
    m("POST", `${BASE}/imports/${importId}/validate`, { session: tech, headers: at(1) }),
    200,
  );
  expect(validated.body).toMatchObject({ status: "validated", counts: { identical: 1 } });
  await status(m("POST", `${BASE}/imports/${importId}/commit`, { session: tech }), 428);
  await status(m("POST", `${BASE}/imports/${importId}/commit`, { session: tech, headers: at(1) }), 409);
  await status(m("POST", `${BASE}/imports/${importId}/commit`, { session: auditor, headers: at(2) }), 403, "forbidden");
  await status(m("POST", `${BASE}/imports/${MISSING}/commit`, { session: tech, headers: at(2) }), 404);
  const committed = await status(
    m("POST", `${BASE}/imports/${importId}/commit`, { session: tech, headers: at(2) }),
    200,
  );
  expect(committed.body).toMatchObject({ status: "committed", version: 3 });
  await status(
    m("POST", `${BASE}/imports/${importId}/validate`, { session: tech, headers: at(3) }),
    422,
    "config_bundle.not_validatable",
  );
}
