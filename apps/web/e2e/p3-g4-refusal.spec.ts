// A refused G4 submission, item by item, in the shown language, on the REAL stack (support/with-stack.sh; no mocks).
// T-DG3-FE-F. The server's 422 gate_criteria_incomplete has ONE entry per incomplete criterion, whose `message` joins
// the English labels of all its items ("Owners: INI-01 X Owners: INI-02 Y"; ADR-0021 §7 "The refusal shape"). The
// submit dialog never shows or parses that message: it lists the items of the refreshed gate view (criteria[].missing[])
// one per record, each translated from its code, with the initiative's code and name.
//
// Story: two selected initiatives make a G4-ready portfolio (setup through the real API, as FE-D's
// support/p3-journey-setup.ts does; the screens of each step are covered by p3-journeys.spec.ts). The lead (TL) opens
// the G4 submit dialog; meanwhile, in another session, both initiatives lose their workstream lead. The lead submits:
// the dialog lists two separate translated 'Owners' items, one per initiative; in Arabic no English label appears.
//
// Every record here is SYNTHETIC demo data; every business decision (G1-G3 approvals, selection, Finance validation,
// funding, capacity commitment) is a demo record that approves nothing real, and product gate G4 (or any of G1-G6)
// never implies any engineering gate (DG0-DG7).
import { expect, test } from "@playwright/test";
import {
  DEV_USERS,
  SYN_RETAIL,
  apiSession,
  exactly,
  expectAccessible,
  fieldLabel,
  langOf,
  shot,
  signIn,
  tr,
  trackRequests,
  type ApiSession,
} from "./support/ui.ts";
import {
  defineRecords,
  g1Records,
  g2Records,
  g3Records,
  submitAndApprove,
  syntheticUser,
  type SyntheticUser,
} from "./support/p3-journey-setup.ts";

test.describe.configure({ mode: "serial" });

let tid = "";
const ini: { id: string; code: string; name: string }[] = [
  { id: "", code: "", name: "Synthetic roaming bundle relaunch" },
  { id: "", code: "", name: "Synthetic prepaid top-up redesign" },
];
const T = () => `/api/v1/transformations/${tid}`;
const user = (lang: string, role: string) => `dev.p3g4r.${role}.${lang}.${Date.now().toString(36)}`;
const RATIONALE = "Synthetic demo decision for the G4 refusal check (approves nothing real).";
/** The English server labels that must never reach an Arabic user (ADR-0021 §7 table). */
const ENGLISH_LABELS =
  /Owners|Finance validation|Gap link missing|Funding decision missing|Capacity commitment missing/;

/** The ten business case sections (as apps/api/test/integration/gates/g4.test.ts); every text is synthetic. */
const sections = (ownerId: string, finId: string) => ({
  strategicRationale: "Synthetic rationale.",
  baselineSummary: "Synthetic baseline: roaming revenue 1.2m SAR per year.",
  valuePoolsSummary: "Synthetic value pools.",
  interventionsSummary: "Synthetic interventions.",
  investmentSummary: "Synthetic investment.",
  benefitsSummary: "Synthetic benefits.",
  benefitRamp: "Synthetic ramp: 25% / 75% / 100%.",
  recurrenceSummary: "Synthetic: recurring.",
  implementationHorizon: "Synthetic: 12 months.",
  keyAssumptions: "Synthetic assumptions.",
  downsideCase: "Synthetic downside.",
  upsideCase: "Synthetic upside.",
  benefitOwnerUserId: ownerId,
  initiativeOwnerUserId: ownerId,
  financeValidatorUserId: finId,
  decisionAskTypes: ["funding"],
});

/** G1 (with the three leadership confirmations), G2 and G3 approved by the demo Sponsor: the phase is Mobilize. */
async function throughG3(lead: ApiSession, office: ApiSession, sponsor: ApiSession, sp: SyntheticUser) {
  await g1Records(T(), lead, office, sp.id);
  const g1 = await lead.call<{ gate: { version: number } }>("GET", `${T()}/gates/G1`);
  await lead.call(
    "POST",
    `${T()}/gates/G1/submissions`,
    { submissionNote: "Synthetic G1 submission" },
    { ifMatch: g1.gate.version },
  );
  const g1b = await sponsor.call<{ gate: { version: number; latestSubmissionNo: number } }>("GET", `${T()}/gates/G1`);
  await sponsor.call(
    "POST",
    `${T()}/gates/G1/decision`,
    {
      submissionNo: g1b.gate.latestSubmissionNo,
      outcome: "approved",
      rationale: RATIONALE,
      agreements: { problem: true, baseline: true, materialValuePools: true },
    },
    { ifMatch: g1b.gate.version },
  );
  const define = await defineRecords(T(), lead);
  await g2Records(T(), lead, sponsor, define.outcomeKpiId);
  await submitAndApprove(T(), "G2", lead, sponsor);
  const { tomGapId } = await g3Records(T(), lead);
  await submitAndApprove(T(), "G3", lead, sponsor);
  return { ...define, tomGapId };
}

// ------------------------------------------------------------------------------------------------ setup

test("setup: a G4-ready portfolio of two selected initiatives (synthetic, through the real API)", async ({
  playwright,
}, info) => {
  test.setTimeout(180_000);
  const lang = langOf(info);
  const lead = await apiSession(playwright, "dev.lead");
  const office = await apiSession(playwright, "dev.office");
  const admin = await apiSession(playwright, "dev.admin");
  const created = await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `Synthetic G4 refusal ${lang.toUpperCase()}`,
    mode: "end_to_end",
  });
  tid = created.id;
  const me = await admin.call<{ organization: { id: string } }>("GET", "/api/v1/me");
  const orgId = me.organization.id;
  const sp = await syntheticUser(admin, orgId, tid, user(lang, "sp"), `Synthetic Sponsor ${lang}`, "SP", lang);
  const fin = await syntheticUser(admin, orgId, tid, user(lang, "fin"), `Synthetic Finance ${lang}`, "FIN", lang);
  const sponsor = await apiSession(playwright, sp.username);
  const finance = await apiSession(playwright, fin.username);

  const { outcomeId, outcomeKpiId, tomGapId } = await throughG3(lead, office, sponsor, sp);
  const waves = await lead.call<{ items: { id: string; ordinal: number }[] }>("GET", `${T()}/waves`);
  const wave = waves.items.find((w) => w.ordinal === 1) ?? waves.items[0]!;

  // Two complete initiative cards (owners, wave, dates, gap link, outcome/KPI, an approved milestone), submitted and
  // fully scored under the active weight set.
  for (const [n, i] of ini.entries()) {
    const made = await lead.call<{ id: string; code: string }>("POST", "/api/v1/initiatives", {
      transformationId: tid,
      name: i.name,
      objective: `Synthetic objective of ${i.name}`,
      scopeIn: "Synthetic consumer scope",
      executiveOwnerUserId: DEV_USERS.lead,
      workstreamLeadUserId: DEV_USERS.lead,
      waveId: wave.id,
      plannedStart: "2027-01-01",
      plannedEnd: "2027-06-30",
    });
    i.id = made.id;
    i.code = made.code;
    const I = `/api/v1/initiatives/${i.id}`;
    await lead.call("POST", `${I}/outcome-contributions`, {
      outcomeId,
      outcomeKpiId,
      contributionStatement: "Synthetic: fewer billing errors.",
    });
    await lead.call("POST", `${I}/gap-links`, { targetType: "tom_gap", targetId: tomGapId });
    const ms = await lead.call<{ id: string; version: number }>("POST", `${I}/milestones`, {
      title: `Synthetic pilot live ${n + 1}`,
      forecastDate: "2027-03-31",
    });
    await lead.call(
      "POST",
      `/api/v1/milestones/${ms.id}/approve-date`,
      { approvedDate: "2027-03-31", reason: "Synthetic baseline date." },
      { ifMatch: ms.version },
    );
    const fresh = await lead.call<{ version: number }>("GET", I);
    await lead.call("POST", `${I}/submit`, {}, { ifMatch: fresh.version });
    for (const criterionCode of ["strategic_fit", "financial_value", "customer_impact", "feasibility", "time_to_value"])
      await lead.call("POST", `${I}/scores`, { criterionCode, score: 4 - n });
  }
  await lead.call("POST", `${T()}/prioritization/rankings`, { note: "Synthetic snapshot for the G4 refusal check" });

  // The demo Sponsor selects both (business approval); Finance funds both.
  for (const i of ini) {
    const fresh = await sponsor.call<{ version: number; status: string }>("GET", `/api/v1/initiatives/${i.id}`);
    expect(fresh.status, `${i.code} ranked`).toBe("ranked");
    await sponsor.call(
      "POST",
      `/api/v1/initiatives/${i.id}/select`,
      { rationale: RATIONALE },
      { ifMatch: fresh.version },
    );
  }

  // The value side: the transformation case and one initiative case each, all ten sections; Finance validates every
  // baseline (never the author).
  const cases = [
    await lead.call<{ id: string; version: number }>("POST", "/api/v1/business-cases", {
      transformationId: tid,
      level: "transformation",
      title: "Synthetic transformation case",
      sections: sections(DEV_USERS.lead, fin.id),
    }),
  ];
  for (const i of ini)
    cases.push(
      await lead.call<{ id: string; version: number }>("POST", "/api/v1/business-cases", {
        transformationId: tid,
        level: "initiative",
        initiativeId: i.id,
        title: `Synthetic case of ${i.code}`,
        sections: sections(DEV_USERS.lead, fin.id),
      }),
    );
  // The investment and benefits sections are the case's lines: one investment line and one benefit line each, the
  // benefit backed by its own T09 formula (one formula, one line), whose version 1 Finance validates.
  for (const [n, c] of cases.entries()) {
    const formula = await lead.call<{ id: string }>("POST", "/api/v1/benefit-formulas", {
      transformationId: tid,
      benefitName: `Synthetic revenue uplift ${n + 1}`,
      fromExample: "revenue_uplift",
    });
    await lead.call("POST", `/api/v1/business-cases/${c.id}/lines`, {
      lineKind: "investment",
      class: "capex",
      valueBasis: "cash",
      title: "Synthetic platform",
      amount: "40000",
      currency: "SAR",
    });
    await lead.call("POST", `/api/v1/business-cases/${c.id}/lines`, {
      lineKind: "benefit",
      class: "revenue",
      valueBasis: "revenue_uplift",
      title: "Synthetic attach uplift",
      amount: "100000",
      currency: "SAR",
      benefitFormulaId: formula.id,
    });
    await finance.call(
      "POST",
      `/api/v1/benefit-formulas/${formula.id}/versions/1/validation`,
      { result: "validated", note: "Synthetic demo validation; approves nothing real." },
      { ifMatch: 1 },
    );
    c.version = (await lead.call<{ version: number }>("GET", `/api/v1/business-cases/${c.id}`)).version;
  }
  for (const c of cases)
    await finance.call(
      "POST",
      `/api/v1/business-cases/${c.id}/baseline-validation`,
      { result: "validated", note: "Synthetic demo validation; approves nothing real." },
      { ifMatch: c.version },
    );
  for (const i of ini)
    await finance.call("POST", "/api/v1/funding-decisions", {
      initiativeId: i.id,
      outcome: "approved",
      amount: "1500000.00",
      currency: "SAR",
      rationale: RATIONALE,
    });

  // Capacity: a role with enough capacity; each initiative's demand committed by the capacity owner (TO).
  const role = await lead.call<{ id: string }>("POST", `${T()}/resource-roles`, {
    code: `analyst_${lang}`,
    labelEn: "Synthetic analyst",
    labelAr: "محلل (تجريبي)",
  });
  await lead.call("POST", "/api/v1/capacity", {
    transformationId: tid,
    resourceRoleId: role.id,
    periodMonth: "2027-02-01",
    availableFte: "4.00",
    ownerUserId: DEV_USERS.office,
  });
  for (const i of ini) {
    const demand = await lead.call<{ id: string; version: number }>("POST", "/api/v1/resource-demands", {
      initiativeId: i.id,
      resourceRoleId: role.id,
      periodMonth: "2027-02-01",
      demandFte: "1.00",
    });
    await office.call(
      "POST",
      `/api/v1/resource-demands/${demand.id}/commit`,
      { note: "Synthetic capacity commitment." },
      { ifMatch: demand.version },
    );
  }

  // G4 is ready: every criterion complete, so the lead may open the submit dialog.
  const view = await lead.call<{ criteria: { key: string; completeness: string; missing: unknown[] }[] }>(
    "GET",
    `${T()}/gates/G4`,
  );
  expect(view.criteria.filter((c) => c.completeness !== "complete")).toEqual([]);
});

// ------------------------------------------------------------------------------------------------ the refusal

test("TL submits G4 after both workstream leads were cleared: two translated 'Owners' items, one per initiative", async ({
  page,
  playwright,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.lead");
  await page.goto(`/transformations/${tid}/gates/G4`);
  await expect(page.locator("main#main h1")).toHaveText(exactly(tr(lang, "gates.gateTitle", { code: "G4" })));
  await expect(page.locator("[data-criterion]")).toHaveCount(8);
  await expect(page.locator("[data-criterion][data-completeness='incomplete']")).toHaveCount(0);
  await page.getByRole("button", { name: tr(lang, "gates.submit.action"), exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(fieldLabel(lang, "gates.submit.note")).fill("Synthetic G4 submission");

  // Meanwhile, in another session: both initiatives lose their workstream lead. The open dialog does not know.
  const lead = await apiSession(playwright, "dev.lead");
  for (const i of ini) {
    const fresh = await lead.call<{ version: number }>("GET", `/api/v1/initiatives/${i.id}`);
    await lead.call("PATCH", `/api/v1/initiatives/${i.id}`, { workstreamLeadUserId: null }, { ifMatch: fresh.version });
  }
  // The server's refusal joins both labels into ONE English message (ADR-0021 §7): this is what the web must not show.
  const g4 = await lead.call<{ criteria: { key: string; missing: { message: string }[] }[] }>("GET", `${T()}/gates/G4`);
  const joined = g4.criteria
    .find((c) => c.key === "g4.owners")!
    .missing.map((m) => m.message)
    .join(" ");
  expect(joined).toBe(`Owners: ${ini[0]!.code} ${ini[0]!.name} Owners: ${ini[1]!.code} ${ini[1]!.name}`);

  await dialog.getByRole("button", { name: tr(lang, "gates.submit.confirm"), exact: true }).click();
  const alert = dialog.getByRole("alert");
  await expect(alert).toHaveAttribute("data-problem", "gate_criteria_incomplete");
  await expect(alert).toContainText(tr(lang, "problems.gate_criteria_incomplete"));
  // One item per initiative, read from the refreshed gate view.
  await expect(alert.locator("[data-g4-refusal='items']")).toBeVisible();
  const owners = alert.locator("[data-missing='g4.owner_missing']");
  await expect(owners).toHaveCount(2);
  await expect(alert.locator("[data-missing]")).toHaveCount(2);
  for (const [n, i] of ini.entries()) {
    const item = owners.nth(n);
    await expect(item).toContainText(tr(lang, "gates.missingItems.g4__owner_missing"));
    await expect(item).toContainText(`${i.code} ${i.name}`);
    await expect(item).not.toContainText(ini[1 - n]!.code);
  }
  await expect(alert).not.toContainText(joined);
  if (lang === "en") await expect(owners.first()).toContainText("Owners");
  else {
    await expect(alert).not.toContainText(ENGLISH_LABELS);
    expect(await dialog.textContent()).not.toMatch(ENGLISH_LABELS);
  }
  await expectAccessible(page, lang, "p3-g4-refusal-two-owners");
  await shot(page, lang, "p3-g4-refusal-two-owners");
  await dialog.getByRole("button", { name: tr(lang, "common.action.cancel"), exact: true }).click();

  // The live readiness agrees: the owners criterion is incomplete with the same two items; submission is blocked.
  const ownersRow = page.locator("[data-criterion='g4.owners']");
  await expect(ownersRow).toHaveAttribute("data-completeness", "incomplete");
  await expect(ownersRow.locator("[data-missing='g4.owner_missing']")).toHaveCount(2);
  for (const i of ini)
    await expect(ownersRow.getByRole("link", { name: `${i.code} ${i.name}`, exact: true })).toHaveAttribute(
      "href",
      `/transformations/${tid}/initiatives/${i.id}`,
    );
  if (lang === "ar") expect(await page.locator("main#main").textContent()).not.toMatch(ENGLISH_LABELS);
  expect(foreign).toEqual([]);
});
