// The Modular-entry G3 precondition (T-DG4-BE-M2; ADR-0038 §7.4, §12; D-106 (e); REQ-PB-005, REQ-S03-005). Proves,
// against the run's disposable PostgreSQL:
//  - a Modular transformation entering at Design whose G3 criteria are met (here: covered by accepted BE-K2 gate
//    exceptions) is refused at G3 with 422 `gate.modular_links_missing`, `errors[]` listing `/baseline` and
//    `/outcomes`, and nothing is written; after a baseline and an outcome KPI are supplied the submission is 201;
//  - an accepted, unexpired G3 waiver lets it through without them; an expired or pending waiver does not;
//  - without the G3 criteria met the DG2 refusal (gate_criteria_incomplete) still comes first, unchanged;
//  - End-to-End: the whole G1 -> G4 chain with NO baseline and NO outcome link is unaffected. When
//    MTH_BE_M2_TRANSCRIPT is set, every End-to-End G1-G4 response (status, ETag, Location, body) is written there with
//    ids, timestamps and hashes normalized, for the A/B byte comparison against the base commit's gates.ts (handback).
// Every approval here (exceptions, waivers, gate decisions by the synthetic Sponsor) is SYNTHETIC demo data and
// approves nothing real; nothing touches the engineering gates DG0-DG7.
import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import {
  addBaseline,
  addOutcomeKpi,
  insertModularFixture,
  seedModularWorld,
  type ModularWorld,
} from "../contract/p4-exercises-be-m.ts";

let api: TestApi;
let w: World;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
}, 60_000);
afterAll(async () => {
  await api.close();
}, 60_000);

const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call(api.app, m, u, o);
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const DETAIL =
  "Modular entry: supply the missing baseline and outcome links, or record an authorized waiver, before submitting this gate.";

async function gateRow(mw: ModularWorld, gateCode: string) {
  return api.db
    .selectFrom("gate_instance")
    .selectAll()
    .where("transformation_id", "=", mw.transformationId)
    .where("gate_code", "=", gateCode)
    .executeTakeFirstOrThrow();
}

async function submissions(mw: ModularWorld) {
  return (
    await api.db
      .selectFrom("gate_submission")
      .select("id")
      .where("transformation_id", "=", mw.transformationId)
      .execute()
  ).length;
}

/** Covers every mandatory criterion of `gateCode` with an exception requested by the TL and accepted by the SP. */
async function coverCriteria(mw: ModularWorld, gateCode: string, req = send): Promise<void> {
  const keys = await api.db
    .selectFrom("gate_criterion_definition as c")
    .innerJoin("gate_definition as d", "d.id", "c.gate_definition_id")
    .select("c.key")
    .where("d.code", "=", gateCode)
    .where("c.mandatory", "=", true)
    .orderBy("c.ordinal")
    .execute();
  const E = `${mw.base}/gate-exceptions`;
  for (const { key } of keys) {
    const ex = await req("POST", E, {
      session: mw.s.tl,
      body: {
        gateCode,
        criterionKey: key,
        reason: "Synthetic: test fixture coverage of a criterion this test does not exercise.",
        scope: `Synthetic: ${key} only`,
        compensatingAction: "Synthetic: complete the criterion before the next gate.",
        compensatingOwnerUserId: mw.users.tl.id,
        expiresOn: inDays(60),
      },
    });
    expect(ex.status, JSON.stringify(ex.body)).toBe(201);
    const d = await req("POST", `${E}/${ex.body.id}/decision`, {
      session: mw.s.sp,
      headers: ifm(ex.body.version),
      body: { outcome: "accepted", note: "Synthetic demo decision." },
    });
    expect(d.status, JSON.stringify(d.body)).toBe(200);
  }
}

async function submit(mw: ModularWorld, gateCode: string, req = send) {
  const g = await gateRow(mw, gateCode);
  return req("POST", `${mw.base}/gates/${gateCode}/submissions`, {
    session: mw.s.tl,
    headers: ifm(g.version),
    body: { submissionNote: "Synthetic submission" },
  });
}

/** A G3 waiver dispensation written directly with its audit event: the DG3 route refuses waivers for a Modular
 *  transformation (`dispensation.waiver_requires_end_to_end`), so this is the only way to hold one (handback §gaps). */
function waiverRow(mw: ModularWorld, status: "accepted" | "pending", expiresOn: string): Promise<string> {
  return insertModularFixture(api.db, mw, "gate_dispensation", {
    kind: "waiver",
    gate_code: "G3",
    reason: "Synthetic: the design may be submitted while the inherited baseline is located.",
    expires_on: expiresOn,
    status,
    recorded_by: mw.users.tl.id,
    ...(status === "accepted" ? { decided_by: mw.users.sp.id, decided_at: new Date() } : {}),
  });
}

describe("D-106 (e): Modular G3 submission needs the baseline and outcome links, or a waiver", () => {
  it("422 gate.modular_links_missing listing both items; nothing written; 201 once both are supplied", async () => {
    const mw = await seedModularWorld(api, w);
    await coverCriteria(mw, "G3");
    const before = await gateRow(mw, "G3");
    const refused = await submit(mw, "G3");
    expect(refused.status, JSON.stringify(refused.body)).toBe(422);
    expect(refused.body).toMatchObject({
      type: "urn:mth:problem:validation",
      code: "gate.modular_links_missing",
      title: "Business rule violated",
      detail: DETAIL,
    });
    expect(refused.body.errors).toEqual([
      { pointer: "/baseline", code: "baseline_missing", message: "No active baseline with a value is recorded." },
      { pointer: "/outcomes", code: "outcome_link_missing", message: "No active outcome has an active KPI." },
    ]);
    expect(await gateRow(mw, "G3")).toEqual(before);
    expect(await submissions(mw)).toBe(0);

    // Only the baseline: the refusal lists the outcome link alone.
    await addBaseline(send, mw);
    const half = await submit(mw, "G3");
    expect([half.status, half.body.code]).toEqual([422, "gate.modular_links_missing"]);
    expect(half.body.errors.map((e: { pointer: string }) => e.pointer)).toEqual(["/outcomes"]);

    // Both supplied: the DG2/DG3 submission proceeds.
    await addOutcomeKpi(api.db, mw);
    const ok = await submit(mw, "G3");
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect((await gateRow(mw, "G3")).status).toBe("submitted");
    // The missing-link report agrees: nothing blocking.
    const r = await send("GET", `${mw.base}/missing-links`, { session: mw.s.auditor });
    expect(r.body.items.filter((i: { severity: string }) => i.severity === "blocking")).toEqual([]);
  });

  it("an accepted, unexpired G3 waiver lets it through; an expired or a pending one does not", async () => {
    const pending = await seedModularWorld(api, w);
    await coverCriteria(pending, "G3");
    await waiverRow(pending, "pending", inDays(30));
    expect((await submit(pending, "G3")).body.code).toBe("gate.modular_links_missing");

    const expired = await seedModularWorld(api, w);
    await coverCriteria(expired, "G3");
    await waiverRow(expired, "accepted", inDays(-2));
    expect((await submit(expired, "G3")).body.code).toBe("gate.modular_links_missing");

    const waived = await seedModularWorld(api, w);
    await coverCriteria(waived, "G3");
    await waiverRow(waived, "accepted", inDays(30));
    const ok = await submit(waived, "G3");
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    // The missing-link report still lists both items (the waiver lets the gate through; it supplies nothing).
    const r = await send("GET", `${waived.base}/missing-links`, { session: waived.s.auditor });
    expect(
      r.body.items.filter((i: { severity: string }) => i.severity === "blocking").map((i: { code: string }) => i.code),
    ).toEqual(["baseline_missing", "outcome_link_missing"]);
  });

  it("the DG2 order is kept: G3 criteria not met → gate_criteria_incomplete first, exactly as before", async () => {
    const mw = await seedModularWorld(api, w);
    const res = await submit(mw, "G3");
    expect([res.status, res.body.code]).toEqual([422, "gate_criteria_incomplete"]);
  });

  it("only G3 carries the precondition: a Modular G4 out of sequence keeps the DG2 refusal", async () => {
    const mw = await seedModularWorld(api, w);
    const res = await submit(mw, "G4");
    expect([res.status, res.body.code]).toEqual([422, "gate.out_of_sequence"]);
  });
});

// ------------------------------------------------------------------------------------------------ End-to-End

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const TIMESTAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/g;
const HASH = /\b[0-9a-f]{64}\b/g;
/** createOutcomeRow names an outcome after its random id ("Synthetic outcome 30cc97"): fixture data, normalized too. */
const FIXTURE_NAME = /Synthetic outcome [0-9a-f]{6}/g;

/** Replaces ids, instants and hashes by stable placeholders (first appearance order), keeping every other byte. */
function normalizer() {
  const seen = new Map<string, string>();
  const tag = (prefix: string) => (m: string) => {
    if (!seen.has(m)) seen.set(m, `<${prefix}${seen.size}>`);
    return seen.get(m)!;
  };
  return (text: string) =>
    text
      .replace(HASH, tag("hash"))
      .replace(UUID, tag("id"))
      .replace(FIXTURE_NAME, tag("name"))
      .replace(TIMESTAMP, "<ts>");
}

describe("End-to-End G1-G4: unaffected by the Modular precondition (byte comparison in the handback)", () => {
  it("the full chain with no baseline and no outcome link: every refusal and success as in DG2/DG3", async () => {
    const mw = await seedModularWorld(api, w, undefined, "end_to_end");
    const lines: string[] = [];
    const norm = normalizer();
    const rec = async (label: string, method: string, url: string, o?: Parameters<typeof call>[3]) => {
      const res = await send(method, url, o);
      const { requestId: _r, ...body } = (res.body ?? {}) as Record<string, unknown>;
      lines.push(
        norm(
          JSON.stringify({
            label,
            status: res.status,
            etag: res.headers["etag"] ?? null,
            location: res.headers["location"] ?? null,
            body,
          }),
        ),
      );
      return res;
    };
    const G = (code: string) => `${mw.base}/gates/${code}`;
    const sub = async (code: string, label: string) =>
      rec(label, "POST", `${G(code)}/submissions`, {
        session: mw.s.tl,
        headers: ifm((await gateRow(mw, code)).version),
        body: { submissionNote: "Synthetic submission" },
      });
    const decide = async (code: string, submissionNo: number) =>
      rec(`${code} decision approved`, "POST", `${G(code)}/decision`, {
        session: mw.s.sp,
        headers: ifm((await gateRow(mw, code)).version),
        body: {
          submissionNo,
          outcome: "approved",
          rationale: "Synthetic demo decision: approves nothing real.",
          // G1 approval needs the three B0032 leadership agreements (ADR-0021 §8); absent for G2 and G3.
          ...(code === "G1" ? { agreements: { problem: true, baseline: true, materialValuePools: true } } : {}),
        },
      });

    // G1: 428, 409, AUD 403, criteria incomplete; G2-G4 out of sequence.
    expect(
      (
        await rec("G1 no If-Match", "POST", `${G("G1")}/submissions`, {
          session: mw.s.tl,
          body: { submissionNote: "x" },
        })
      ).status,
    ).toBe(428);
    expect(
      (
        await rec("G1 stale", "POST", `${G("G1")}/submissions`, {
          session: mw.s.tl,
          headers: ifm(99),
          body: { submissionNote: "x" },
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await rec("G1 AUD", "POST", `${G("G1")}/submissions`, {
          session: mw.s.auditor,
          headers: ifm(1),
          body: { submissionNote: "x" },
        })
      ).status,
    ).toBe(403);
    expect((await sub("G1", "G1 incomplete")).body.code).toBe("gate_criteria_incomplete");
    for (const code of ["G2", "G3", "G4"])
      expect((await sub(code, `${code} out of sequence`)).body.code).toBe("gate.out_of_sequence");

    // G1 -> G2 -> G3 approved in sequence (criteria covered by exceptions); G3 has NO baseline and NO outcome link.
    for (const code of ["G1", "G2", "G3"]) {
      await coverCriteria(mw, code);
      const s = await sub(code, `${code} submitted`);
      expect(s.status, JSON.stringify(s.body)).toBe(201);
      await rec(`${code} view after submit`, "GET", G(code), { session: mw.s.tl });
      const d = await decide(code, s.body.submissionNo as number);
      expect(d.status, JSON.stringify(d.body)).toBe(201);
      expect((await sub(code, `${code} resubmit after approval`)).body.code).toBe("gate.already_approved");
    }
    // G4: its own criteria (not covered) refuse it, as before.
    const g4 = await sub("G4", "G4 incomplete");
    expect([g4.status, g4.body.code]).toEqual([422, "gate_criteria_incomplete"]);
    await rec("gate list", "GET", `${mw.base}/gates`, { session: mw.s.auditor });
    // Still no baseline and no outcome link: the End-to-End chain never needed them.
    const facts = await send("GET", `${mw.base}/missing-links`, { session: mw.s.auditor });
    expect(
      facts.body.items
        .filter((i: { severity: string }) => i.severity === "blocking")
        .map((i: { code: string }) => i.code),
    ).toEqual(["baseline_missing", "outcome_link_missing"]);

    const out = process.env["MTH_BE_M2_TRANSCRIPT"];
    if (out) writeFileSync(out, `${lines.join("\n")}\n`);
    expect(lines.length).toBeGreaterThan(15);
  }, 120_000);
});
