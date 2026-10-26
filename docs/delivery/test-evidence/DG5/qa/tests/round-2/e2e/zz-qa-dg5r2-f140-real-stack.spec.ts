// qa-verifier DG5 round 2 (T-DG5-RG2-QA-R2): F-DG5-140 verification ON THE REAL STACK. The demo stack
// (e2e/support/with-demo-stack.sh: built API + PostgreSQL, mth-db seed-demo, AUTH_MODE=dev) runs no worker, so the
// wrapper (docs/delivery/test-evidence/DG5/qa/round-2/scripts/f140-real-stack.sh) also starts the BUILT worker process
// (node apps/worker/dist/main.js) with the same environment. Runs in a DISPOSABLE clone only (copied to e2e/ there).
//
// At branding version 0 (the demo seeds no branding version; asserted through GET /api/v1/branding), the synthetic demo
// team lead roaming.user.tl generates the charter (DOCX), the roadmap (PPTX) and the RAID register (PDF) of the demo
// transformation, exports each in Arabic and English through POST /api/v1/exports, the real worker renders them, and
// the files are downloaded over HTTP. Asserted:
//   - Arabic DOCX/PPTX: the first text run (the header) is GET /branding's productNameAr; the English name never appears;
//   - English DOCX/PPTX: the first text run is productNameEn; the Arabic name never appears;
//   - Arabic PDF: draws the Arabic name and prints no line containing the English name; English PDF prints it.
// Every record is SYNTHETIC; nothing approves anything real; no engineering gate is named.
import { expect, test } from "@playwright/test";
import { readOoxml, xmlTexts } from "../packages/reporting/src/ooxml-read.ts";
import { drawsArabic, lines, readPdf } from "../packages/reporting/src/pdf/read.ts";
import { apiSession, type ApiSession } from "../apps/web/e2e/support/ui.ts";

test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

type Body = Record<string, unknown>;
const EN = "Mobily Transformation Hub";
const AR = "منصة موبايلي للتحوّل";
const DEMO_LABELS = ["Illustrative example — synthetic", "مثال توضيحي — اصطناعي"];

async function exportFile(s: ApiSession, base: string, def: string, format: string, language: string): Promise<Buffer> {
  const params = def === "registers" ? { parameters: { register: "raid", filters: {} } } : {};
  const snap = (await s.call("POST", `${base}/reports/${def}/generate`, params)) as Body;
  const job = (await s.call("POST", "/api/v1/exports", { snapshotId: snap["id"], format, language })) as Body;
  const id = String(job["id"]);
  let status = "";
  for (let i = 0; i < 240; i++) {
    const j = (await s.call("GET", `/api/v1/exports/${id}`)) as Body;
    status = String(j["status"]);
    if (status === "succeeded" || status === "failed" || status === "cancelled") break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  expect(status, `${def} ${format} ${language} job ${id}`).toBe("succeeded");
  const res = await s.req.get(`/api/v1/exports/${id}/download`);
  expect(res.status()).toBe(200);
  const bytes = await res.body();
  console.info(`QA-R2-F140 ${def}.${language}.${format}: job ${id} succeeded, ${bytes.length} bytes`);
  return bytes;
}

async function texts(bytes: Buffer, format: "docx" | "pptx"): Promise<string[]> {
  const part = format === "docx" ? /^word\/document\.xml$/ : /^ppt\/slides\/slide1\.xml$/;
  const { parts } = await readOoxml(new Uint8Array(bytes), part);
  return [...parts.values()].flatMap((xml) => xmlTexts(xml));
}

test("F-DG5-140 real stack: version-0 exports carry the shipped product name of their language (real worker)", async ({ playwright }) => {
  const s = await apiSession(playwright, "roaming.user.tl");
  const branding = (await s.call("GET", "/api/v1/branding")) as Body;
  console.info(`QA-R2-F140 GET /api/v1/branding: ${JSON.stringify({ v: branding["versionNo"], en: branding["productNameEn"], ar: branding["productNameAr"] })}`);
  expect([branding["versionNo"], branding["productNameEn"], branding["productNameAr"]]).toEqual([0, EN, AR]);
  const list = (await s.call("GET", "/api/v1/transformations")) as Body;
  const items = (Array.isArray(list) ? list : (list["items"] ?? list["data"])) as Body[];
  expect(items.length).toBeGreaterThan(0);
  const tr = items[0]!;
  console.info(`QA-R2-F140 transformation ${String(tr["code"])} ${String(tr["id"])}`);
  const base = `/api/v1/transformations/${String(tr["id"])}`;
  const problems: string[] = [];
  for (const [def, format] of [["charter", "docx"], ["roadmap", "pptx"]] as const) {
    for (const lang of ["ar", "en"] as const) {
      const t = await texts(await exportFile(s, base, def, format, lang), format);
      console.info(`QA-R2-F140 ${def}.${lang}.${format} first runs: ${JSON.stringify(t.slice(0, 4))}`);
      const want = lang === "ar" ? AR : EN;
      const other = lang === "ar" ? EN : AR;
      // Attempt 1 (PROBE-ERROR): a demo PPTX title slide draws the REQ-PB-089 demo label before the name; the header
      // is therefore the first run that is not the demo label.
      const head = t.find((x) => x.trim() !== "" && !DEMO_LABELS.includes(x.trim()));
      if (head !== want) problems.push(`${def}.${lang}.${format}: header ${JSON.stringify(head)}, expected ${want}`);
      if (t.some((x) => x.includes(other))) problems.push(`${def}.${lang}.${format}: prints ${other}`);
    }
  }
  const arPdf = readPdf(new Uint8Array(await exportFile(s, base, "registers", "pdf", "ar")));
  const enPdf = readPdf(new Uint8Array(await exportFile(s, base, "registers", "pdf", "en")));
  console.info(`QA-R2-F140 registers.ar.pdf first lines: ${JSON.stringify(lines(arPdf).slice(0, 4))}`);
  console.info(`QA-R2-F140 registers.en.pdf first lines: ${JSON.stringify(lines(enPdf).slice(0, 4))}`);
  if (!drawsArabic(arPdf, "موبايلي")) problems.push("registers.ar.pdf: does not draw the Arabic name");
  if (lines(arPdf).some((l) => l.includes(EN))) problems.push("registers.ar.pdf: prints the English name");
  if (!lines(enPdf).some((l) => l.includes(EN))) problems.push("registers.en.pdf: no English name");
  console.info(`QA-R2-F140 problems=${JSON.stringify(problems)}`);
  expect(problems).toEqual([]);
});
