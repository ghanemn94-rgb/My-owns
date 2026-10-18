// domain-reviewer DG5 round-3 probe (F-DG5-122 adversarial re-run, through the REAL UI and API on the
// production-initialized stack apps/web/e2e/support/with-stack.sh). My round-2 reproduction: a transformation at
// Mobilize (G1-G3 approved by a synthetic Sponsor) whose approved portfolio is EMPTY (its only initiative stays a
// draft), with an accepted exception on 'Initiative cards' only. Expected: every other G4 criterion whose subject set is
// the approved portfolio is incomplete and names the cause in the shown language; the gate cannot be submitted.
// Every record is SYNTHETIC; every decision approves nothing real; product gate G4 never relates to DG0-DG7.
// Copied to <clone>/probe/ and run from a disposable clone only.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { DEV_USERS, SYN_RETAIL, apiSession, langOf, signIn, type ApiSession } from "../apps/web/e2e/support/ui.ts";
import {
  defineRecords,
  g1Records,
  g2Records,
  g3Records,
  submitAndApprove,
  syntheticUser,
  type SyntheticUser,
} from "../apps/web/e2e/support/p3-journey-setup.ts";

const OUT = process.env["PROBE_OUT"]!;
const RATIONALE = "Synthetic demo decision for the domain review probe (approves nothing real).";
const PORTFOLIO_CRITERIA = [
  "g4.business_cases",
  "g4.finance_validation",
  "g4.prioritization",
  "g4.roadmap",
  "g4.owners",
  "g4.funding",
  "g4.capacity",
];
const MSG = { en: "No initiative in the approved portfolio", ar: "لا توجد مبادرة في المحفظة المعتمدة" } as const;

async function throughG3(T: string, lead: ApiSession, office: ApiSession, sponsor: ApiSession, sp: SyntheticUser) {
  await g1Records(T, lead, office, sp.id);
  const g1 = await lead.call<{ gate: { version: number } }>("GET", `${T}/gates/G1`);
  await lead.call("POST", `${T}/gates/G1/submissions`, { submissionNote: "Synthetic G1" }, { ifMatch: g1.gate.version });
  const g1b = await sponsor.call<{ gate: { version: number; latestSubmissionNo: number } }>("GET", `${T}/gates/G1`);
  await sponsor.call(
    "POST",
    `${T}/gates/G1/decision`,
    {
      submissionNo: g1b.gate.latestSubmissionNo,
      outcome: "approved",
      rationale: RATIONALE,
      agreements: { problem: true, baseline: true, materialValuePools: true },
    },
    { ifMatch: g1b.gate.version },
  );
  const define = await defineRecords(T, lead);
  await g2Records(T, lead, sponsor, define.outcomeKpiId);
  await submitAndApprove(T, "G2", lead, sponsor);
  await g3Records(T, lead);
  await submitAndApprove(T, "G3", lead, sponsor);
}

test("F-DG5-122: empty approved portfolio + accepted exception on Initiative cards only (UI EN/AR + API)", async ({
  playwright,
  page,
}, info) => {
  test.setTimeout(240_000);
  const lang = langOf(info);
  const lead = await apiSession(playwright, "dev.lead");
  const office = await apiSession(playwright, "dev.office");
  const admin = await apiSession(playwright, "dev.admin");
  const created = await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `Synthetic empty portfolio ${lang.toUpperCase()} (domain review)`,
    mode: "end_to_end",
  });
  const tid = created.id;
  const T = `/api/v1/transformations/${tid}`;
  const me = await admin.call<{ organization: { id: string } }>("GET", "/api/v1/me");
  const stamp = Date.now().toString(36);
  const sp = await syntheticUser(admin, me.organization.id, tid, `dev.domr3.sp.${lang}.${stamp}`, `Synthetic Sponsor ${lang}`, "SP", lang);
  const sponsor = await apiSession(playwright, sp.username);
  await throughG3(T, lead, office, sponsor, sp);
  // One initiative that stays a DRAFT: the approved portfolio (selected, funded, launched) is empty.
  await lead.call("POST", "/api/v1/initiatives", {
    transformationId: tid,
    name: "Synthetic draft initiative",
    objective: "Synthetic objective",
    executiveOwnerUserId: DEV_USERS.lead,
    workstreamLeadUserId: DEV_USERS.lead,
  });
  const before = await lead.call<{ criteria: { key: string; completeness: string; missing: { code: string }[] }[] }>(
    "GET",
    `${T}/gates/G4`,
  );
  // The exception on Initiative cards only, requested by the lead and accepted by the gate's approver (synthetic).
  const expires = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const ex = await lead.call<{ id: string; version: number }>("POST", `${T}/gate-exceptions`, {
    gateCode: "G4",
    criterionKey: "g4.initiative_cards",
    reason: "Synthetic: domain review reproduction of F-DG5-122.",
    scope: "Synthetic: only g4.initiative_cards for this G4 submission.",
    compensatingAction: "Synthetic: the lead takes the initiatives through selection.",
    compensatingOwnerUserId: sp.id,
    expiresOn: expires,
  });
  await sponsor.call(
    "POST",
    `${T}/gate-exceptions/${ex.id}/decision`,
    { outcome: "accepted", note: "Synthetic: accepted for the reproduction." },
    { ifMatch: ex.version },
  );
  const view = await lead.call<{
    canSubmit?: boolean;
    gate: { version: number };
    criteria: { key: string; completeness: string; missing: { code: string; message: string }[]; exception?: unknown }[];
  }>("GET", `${T}/gates/G4`);
  // The submission must be refused (422): sent through the CSRF-bearing session with the gate's ETag.
  const submitBody = await lead.call<{ code?: string; errors?: { pointer: string }[] }>(
    "POST",
    `${T}/gates/G4/submissions`,
    { submissionNote: "Synthetic: must be refused" },
    { ifMatch: view.gate.version, expect: 422 },
  );
  const submit = { status: () => 422 };
  mkdirSync(join(OUT, "api"), { recursive: true });
  writeFileSync(
    join(OUT, "api", `empty-g4-${lang}.json`),
    JSON.stringify({ transformationId: tid, before, after: view, submit: { status: submit.status(), body: submitBody } }, null, 1),
  );

  // UI: the G4 page in the shown language.
  await signIn(page, lang, "dev.lead");
  await page.goto(`/transformations/${tid}/gates/G4`);
  await page.waitForLoadState("networkidle");
  await page
    .waitForFunction(() => !/Loading…|جارٍ التحميل…/.test(document.body.innerText), undefined, { timeout: 15_000 })
    .catch(() => undefined);
  await page.waitForTimeout(500);
  mkdirSync(join(OUT, "shots", lang), { recursive: true });
  await page.screenshot({ path: join(OUT, "shots", lang, "e01-empty-portfolio-G4.png"), fullPage: true });
  const body = await page.locator("main#main").innerText();
  mkdirSync(join(OUT, "text", lang), { recursive: true });
  writeFileSync(join(OUT, "text", lang, "e01-empty-portfolio-G4.txt"), body);

  // Assertions (recorded; the review records the outcome).
  for (const key of PORTFOLIO_CRITERIA) {
    const c = view.criteria.find((x) => x.key === key)!;
    expect([key, c.completeness]).toEqual([key, "incomplete"]);
    expect([key, c.missing.map((m) => m.code)]).toEqual([key, expect.arrayContaining(["g4.no_approved_initiative"])]);
  }
  expect(view.criteria.find((x) => x.key === "g4.initiative_cards")!.missing.map((m) => m.code)).toEqual([
    "g4.portfolio_empty",
  ]);
  expect(view.canSubmit).not.toBe(true);
  expect(submit.status()).toBe(422);
  expect(body).toContain(MSG[lang]);
  if (lang === "ar") expect(body).not.toContain(MSG.en);
});
