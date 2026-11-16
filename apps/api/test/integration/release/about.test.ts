// T-I7 (T-DG7-BE-H; ADR-0071 §4; p7-work-split §I.1, §I.4; REQ-S02-005, REQ-S21-003): Administration > About through the
// real server on this run's disposable PostgreSQL. The snapshot source is the real file loader behind a delegating
// wrapper installed with vi.mock on `defaultRegisterSnapshotSource` (as register.test.ts). The fixture register is
// SYNTHETIC and generated with the build's own generator. Read-only; nothing approved; nothing touches DG0-DG7.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type * as SnapshotModule from "../../../src/modules/release/snapshot.ts";
import { matchesComponent } from "../../support/contract.ts";
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

const state = vi.hoisted(() => ({ source: null as null | SnapshotModule.RegisterSnapshotSource }));
vi.mock("../../../src/modules/release/snapshot.ts", async (importOriginal) => {
  const real = await importOriginal<typeof SnapshotModule>();
  return {
    ...real,
    defaultRegisterSnapshotSource: (): SnapshotModule.RegisterSnapshotSource => ({
      load: (log) =>
        state.source === null ? Promise.reject(new real.SnapshotUnavailable("no test source")) : state.source.load(log),
    }),
  };
});
const { fileRegisterSnapshotSource, REGISTER_COLUMNS } = await import("../../../src/modules/release/snapshot.ts");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

const ABOUT = "/api/v1/admin/about";
const GENERATOR = fileURLToPath(new URL("../../../scripts/register-snapshot.mjs", import.meta.url));
const MARKER = "completes-after-gate:";
const work = mkdtempSync(join(process.env["TMPDIR"] ?? tmpdir(), "release-about-"));
let api: TestApi;
let tech: Session;

const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;
function line(over: Record<string, string>): string {
  const v: Record<string, string> = Object.fromEntries(REGISTER_COLUMNS.map((c) => [c, `${c} text`]));
  Object.assign(v, { class: "USER", final_gate: "DG7", increments: "P7" }, over);
  return REGISTER_COLUMNS.map((c) => quote(v[c]!)).join(",");
}
const SPECIFIED_NOTES = "Missing dependency: the corporate identity provider (external, Mobily IT).";
const BLOCKED_NOTES =
  "Blocked: no Docker daemon in the agent sandbox,\nso the image half runs on the orchestrator host.";
const LATER_NOTES = `Implemented with the tooling. ${MARKER} the DG7 gate record (D-243 Q19).`;
const csv = join(work, "fixture.csv");
writeFileSync(
  csv,
  [
    REGISTER_COLUMNS.join(","),
    line({ req_id: "REQ-S21-003", status: "SPECIFIED", title: "Specified row", notes: SPECIFIED_NOTES }),
    line({ req_id: "REQ-DLV-021", status: "IMPLEMENTED", title: "Later clause row", notes: LATER_NOTES }),
    line({ req_id: "REQ-S02-005", status: "BLOCKED", title: "Blocked row", notes: BLOCKED_NOTES, final_gate: "DG6" }),
    line({ req_id: "REQ-PB-001", status: "IMPLEMENTED", title: "Done row", notes: "" }),
  ].join("\n") + "\n",
);

function generate(name: string, deps?: string): string {
  const out = join(work, name);
  const args = [GENERATOR, "--csv", csv, ...(deps ? ["--deps", deps] : []), "--out", out];
  const r = spawnSync(process.execPath, args, { encoding: "utf8" });
  expect(r.status, r.stderr).toBe(0);
  return out;
}
const use = (path: string) => {
  state.source = fileRegisterSnapshotSource(path);
};

beforeAll(async () => {
  api = await startApi();
  const org = await createOrg(api.db);
  const grantor = await createUser(api.db, org.id);
  const u = await createUser(api.db, org.id);
  await grant(api.db, grantor.id, u.id, "ADM_TECH", { type: "organization", id: org.id }, org.id);
  tech = await signIn(api.app, u.subject);
}, 120_000);
afterAll(async () => {
  await api?.close();
  rmSync(work, { recursive: true, force: true });
}, 60_000);

describe("T-I7: getReleaseAbout", () => {
  it("counts every status (sum = rowCount); openItems = exactly the two unfinished rows with their notes; laterClauses = the marked row", async () => {
    use(generate("about.json"));
    const res = await call<Body>(api.app, "GET", ABOUT, { session: tech });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const checked = matchesComponent("ReleaseAbout", res.body);
    expect(checked.ok, checked.errors).toBe(true);
    expect(res.body.register).toMatchObject({ schemaVersion: "mth-register-snapshot/1", rowCount: 4 });
    expect(res.body.statusCounts).toEqual({ PLANNED: 0, SPECIFIED: 1, IMPLEMENTED: 2, BLOCKED: 1 });
    const sum = Object.values(res.body.statusCounts as Record<string, number>).reduce((a, b) => a + b, 0);
    expect(sum).toBe(res.body.register.rowCount);
    expect(res.body.openItems).toEqual([
      { reqId: "REQ-S02-005", title: "Blocked row", status: "BLOCKED", finalGate: "DG6", notes: BLOCKED_NOTES },
      { reqId: "REQ-S21-003", title: "Specified row", status: "SPECIFIED", finalGate: "DG7", notes: SPECIFIED_NOTES },
    ]);
    expect(res.body.laterClauses).toEqual([
      { reqId: "REQ-DLV-021", title: "Later clause row", status: "IMPLEMENTED", finalGate: "DG7", notes: LATER_NOTES },
    ]);
    // A build without external-dependencies.json: null stays null (Unknown, never "none").
    expect(res.body.externalDependencies).toBeNull();
    expect(Date.parse(res.body.checkedAt)).not.toBeNaN();
  });

  it("the build's dependency list is carried as it is", async () => {
    const deps = [
      { key: "corporate_idp", title: "Corporate identity provider", owner: "Mobily IT", status: "not_verified" },
      { key: "smtp_relay", title: "Corporate mail relay", owner: "Mobily IT", status: "not_configured" },
    ];
    const depsPath = join(work, "deps.json");
    writeFileSync(depsPath, JSON.stringify(deps));
    use(generate("about-deps.json", depsPath));
    const res = await call<Body>(api.app, "GET", ABOUT, { session: tech });
    expect(res.status).toBe(200);
    expect(matchesComponent("ReleaseAbout", res.body).ok).toBe(true);
    expect(res.body.externalDependencies).toEqual(deps);
  });

  it("snapshot missing -> 200 with register, statusCounts, openItems and laterClauses null (never 0 or [])", async () => {
    use(join(work, "absent.json"));
    const res = await call<Body>(api.app, "GET", ABOUT, { session: tech });
    expect(res.status).toBe(200);
    expect(matchesComponent("ReleaseAbout", res.body).ok).toBe(true);
    expect(res.body.register).toBeNull();
    expect(res.body.statusCounts).toBeNull();
    expect(res.body.openItems).toBeNull();
    expect(res.body.laterClauses).toBeNull();
    expect(res.body.externalDependencies).toBeNull();
    expect(typeof res.body.appVersion).toBe("string");
  });

  it("appVersion and contractVersion equal getDeploymentStatus's values (BE-B is merged)", async () => {
    use(generate("about-versions.json"));
    const about = await call<Body>(api.app, "GET", ABOUT, { session: tech });
    const deployment = await call<Body>(api.app, "GET", "/api/v1/admin/deployment", { session: tech });
    expect(deployment.status, JSON.stringify(deployment.body)).toBe(200);
    expect({ appVersion: about.body.appVersion, contractVersion: about.body.contractVersion }).toEqual(
      deployment.body.release,
    );
  });
});
