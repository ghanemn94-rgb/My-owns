// qa-verifier DG5 r4: render export samples OFFLINE (no database) with the package's own renderer entry point
// render(document, options) and its synthetic unit-test fixture, in en and ar, in every rendered format. This is a
// DB-free substitute for the integration-generated samples (the integration harness cannot start PostgreSQL in this
// run's sandbox, 03-sandbox-userns-blocker.log): it exercises the renderers, not the export job, its snapshot or A15.
// Run in the disposable clone root with Node 24: node render-offline-samples.ts <outdir>
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { render, RENDERED_FORMATS } from "./packages/reporting/src/render.ts";
import { options, sampleDocument } from "./packages/reporting/src/test-fixtures.ts";

const out = process.argv[2]!;
mkdirSync(out, { recursive: true });
const doc = sampleDocument(
  [
    { code: "RAID-001", description: "Synthetic: roaming bill shock complaints / اصطناعي: شكاوى صدمة فاتورة التجوال", amount: "1250000.50" },
    { code: "RAID-002", description: "اصطناعي: تأخر تفعيل باقات التجوال في التطبيق", amount: "300000.00", provisional: true },
    { code: "RAID-003", description: null, amount: null },
  ],
  null,
);
for (const lang of ["en", "ar"] as const)
  for (const f of RENDERED_FORMATS) {
    const r = await render(doc, options(f, lang));
    const file = path.join(out, `offline-registers-${lang}.${f}`);
    writeFileSync(file, r.bytes);
    console.info(`${file.replace(out, "<out>")}: ${r.bytes.length} bytes`);
  }
