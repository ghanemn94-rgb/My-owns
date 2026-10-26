// qa-verifier DG5 round 2 (T-DG5-RG2-QA-R2): regression check of the round-1 -> round-2 diff (T-DG5-BE-RG3, F-DG5-100
// xmlSafe in every OOXML writer) from the QA side, ON THE REAL STACK with ARABIC user text: the demo stack plus the BUILT
// worker process (wrapper docs/delivery/test-evidence/DG5/qa/round-2/scripts/f140-real-stack.sh). Runs in a DISPOSABLE
// clone only (copied to e2e/ there). As the synthetic demo team lead roaming.user.tl:
//   1. rename the demo transformation to an Arabic name holding U+000B and add an Arabic RAID risk whose description
//      holds U+0001 and U+000B (the API accepts both: only U+0000 and lone surrogates are refused at input);
//   2. export the charter (DOCX), the roadmap (PPTX) and the RAID register (XLSX) in Arabic and English;
//   3. each job succeeds, every XML part of each package is well-formed (packages/reporting/src/ooxml-read.ts
//      malformedParts), the Arabic words around the control characters are kept with U+FFFD in its place, and the
//      Arabic product name heads the Arabic files.
// Every record is SYNTHETIC; nothing approves anything real; no engineering gate is named.
import { expect, test } from "@playwright/test";
import { malformedParts, readOoxml, xmlTexts } from "../packages/reporting/src/ooxml-read.ts";
import { apiSession, type ApiSession } from "../apps/web/e2e/support/ui.ts";

test.setTimeout(300_000);
type Body = Record<string, unknown>;
const NAME_AR = "برنامج التجوال\u000Bالدولي (ملصق)";
const DESC_AR = "تأخر\u0001المورد\u000Bالدولي (ملصق)";

async function exportFile(s: ApiSession, base: string, def: string, format: string, language: string): Promise<Uint8Array> {
  const params = def === "registers" ? { parameters: { register: "raid", filters: {} } } : {};
  const snap = (await s.call("POST", `${base}/reports/${def}/generate`, params)) as Body;
  const job = (await s.call("POST", "/api/v1/exports", { snapshotId: snap["id"], format, language })) as Body;
  const id = String(job["id"]);
  let j: Body = {};
  for (let i = 0; i < 240; i++) {
    j = (await s.call("GET", `/api/v1/exports/${id}`)) as Body;
    if (["succeeded", "failed", "cancelled"].includes(String(j["status"]))) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  expect(j["status"], `${def} ${format} ${language}: ${JSON.stringify(j).slice(0, 400)}`).toBe("succeeded");
  const res = await s.req.get(`/api/v1/exports/${id}/download`);
  expect(res.status()).toBe(200);
  return new Uint8Array(await res.body());
}

test("Arabic user text with C0 controls -> well-formed DOCX/PPTX/XLSX exports on the real stack (real worker)", async ({ playwright }) => {
  const s = await apiSession(playwright, "roaming.user.tl");
  const list = (await s.call("GET", "/api/v1/transformations")) as Body;
  const items = (Array.isArray(list) ? list : (list["items"] ?? list["data"])) as Body[];
  const tr = items[0]!;
  const base = `/api/v1/transformations/${String(tr["id"])}`;
  const cur = (await s.call("GET", base)) as Body;
  const renamed = (await s.call("PATCH", base, { name: NAME_AR }, { ifMatch: cur["version"] as number })) as Body;
  expect(renamed["name"]).toBe(NAME_AR);
  await s.call("POST", `${base}/raid`, {
    type: "risk",
    description: DESC_AR,
    impact: "medium",
    probability: "high",
    ownerUserId: s.userId,
  });
  const problems: string[] = [];
  for (const [def, format, needle] of [
    ["charter", "docx", "التجوال�الدولي"],
    ["roadmap", "pptx", "التجوال�الدولي"],
    ["registers", "xlsx", "تأخر�المورد�الدولي"],
  ] as const) {
    for (const lang of ["ar", "en"] as const) {
      const bytes = await exportFile(s, base, def, format, lang);
      const bad = await malformedParts(bytes);
      const { parts } = await readOoxml(bytes, /\.xml$/);
      // Attempt 1 (PROBE-ERROR): xmlTexts reads <a:t>/<w:t> only; an XLSX inline string is a plain <t> (sheet.ts).
      const xlsxTexts = (x: string) =>
        [...x.matchAll(/<t(?: [^>]*)?>([^<]*)<\/t>/g)].map((m) =>
          m[1]!.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&"),
        );
      const all = [...parts.values()].flatMap((x) => (format === "xlsx" ? xlsxTexts(x) : xmlTexts(x))).join("|");
      const kept = all.includes(needle);
      const raw = /[\u0001\u000B]/.test(all);
      console.info(`QA-R2-XMLCHARS ${def}.${lang}.${format}: ${bytes.length} bytes, malformed=${JSON.stringify(bad)}, text kept with U+FFFD=${kept}, raw control=${raw}, arName=${all.includes("منصة موبايلي للتحوّل")}`);
      if (bad.length > 0) problems.push(`${def}.${lang}.${format}: ${bad.join("; ")}`);
      if (!kept) problems.push(`${def}.${lang}.${format}: the Arabic text with U+FFFD is missing`);
      if (raw) problems.push(`${def}.${lang}.${format}: a raw control character remains`);
      if (lang === "ar" && !all.includes("منصة موبايلي للتحوّل")) problems.push(`${def}.ar.${format}: no Arabic product name`);
    }
  }
  console.info(`QA-R2-XMLCHARS problems=${JSON.stringify(problems)}`);
  expect(problems).toEqual([]);
});
