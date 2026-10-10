// P4 contract exercises of KBE-F (T-DG4-KBE-F; p4-work-split §F+G FG.3, §1 S-10): the 5 slice F operations of the
// adoption indicator templates, metric links and the indicator report; T-DG4-KBE-R2 adds getAdoptionMetricLink. Every call goes through `ctx.mirrored` (OpenAPI
// status/body/headers + problem mirror) and every success body is parsed with the zod mirror in P4_MIRRORS_KBE_F. All
// data is synthetic; nothing here grants a business or Finance approval or touches the engineering gates DG0-DG7.
import {
  adoptionIndicatorReport,
  adoptionIndicatorTemplateList,
  adoptionMetricLink,
  adoptionMetricLinkPage,
} from "@mth/shared/schemas";
import { expect } from "vitest";
import type { z } from "zod";
import type { P4ExerciseContext } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { seedBenefitWorld } from "../benefits/fixtures.ts";
import { monthlyPeriod } from "../kpi-p4/kbe-c-fixtures.ts";

export const P4_MIRRORS_KBE_F: Readonly<Record<string, z.ZodType>> = {
  listAdoptionIndicatorTemplates: adoptionIndicatorTemplateList,
  listAdoptionMetricLinks: adoptionMetricLinkPage,
  createAdoptionMetricLink: adoptionMetricLink,
  getAdoptionMetricLink: adoptionMetricLink,
  removeAdoptionMetricLink: adoptionMetricLink,
  getAdoptionIndicators: adoptionIndicatorReport,
};

export async function exerciseP4KbeFOperations(ctx: P4ExerciseContext): Promise<void> {
  const m = ctx.mirrored;
  const b = await seedBenefitWorld(ctx.api, ctx.world, m);
  const s = b.s;
  const LINKS = `${b.base}/adoption-metric-links`;

  // ------------------------------------------------------------------ templates (REQ-PB-071)
  const templates = await m("GET", "/api/v1/adoption-indicator-templates", { session: s.tl });
  expect(templates.status).toBe(200);
  expect(templates.body.items).toHaveLength(8);

  // ------------------------------------------------------------------ metric links (ADR-0033 §3, §10)
  expect((await m("GET", LINKS, { session: s.auditor })).status).toBe(200);
  expect((await m("GET", LINKS, { session: s.admin })).status).toBe(404);
  const required = await m("POST", LINKS, {
    session: s.tl,
    body: { templateKey: "usage_activation_rate", targetKind: "transformation" },
  });
  expect([required.status, required.body.code]).toEqual([422, "adoption_metric_link.kpi_required"]);
  expect(
    (
      await m("POST", LINKS, {
        session: s.auditor,
        body: { templateKey: "training_completion", targetKind: "transformation" },
      })
    ).status,
  ).toBe(403);
  const training = await m("POST", LINKS, {
    session: s.tl,
    body: { templateKey: "training_completion", targetKind: "transformation" },
  });
  expect(training.status).toBe(201);
  const dup = await m("POST", LINKS, {
    session: s.tl,
    body: { templateKey: "training_completion", targetKind: "transformation" },
  });
  expect([dup.status, dup.body.code]).toEqual([409, "adoption_metric_link.exists"]);
  const usage = await m("POST", LINKS, {
    session: s.tl,
    body: {
      templateKey: "usage_activation_rate",
      targetKind: "transformation",
      createKpi: true,
      kpiOwnerUserId: b.users.bo.id,
    },
  });
  expect(usage.status).toBe(201);
  expect((await m("GET", `${LINKS}?targetKind=transformation`, { session: s.bo })).body.items).toHaveLength(2);

  // ------------------------------------------------------------------ indicator report (REQ-PB-072)
  const period = await monthlyPeriod(ctx.api, ctx.world);
  const report = await m(
    "GET",
    `${b.base}/adoption-indicators?targetKind=transformation&reportingPeriodId=${period.id}`,
    {
      session: s.auditor,
    },
  );
  expect(report.status).toBe(200);
  expect(
    report.body.measures.map((x: { templateKey: string; valueStatus: string }) => [x.templateKey, x.valueStatus]),
  ).toEqual([
    ["usage_activation_rate", "unknown"],
    ["training_completion", "unknown"],
    ["observed_proficiency", "unknown"],
  ]);
  expect((await m("GET", `${b.base}/adoption-indicators?targetKind=transformation`, { session: s.admin })).status).toBe(
    404,
  );

  // ------------------------------------------------------------------ removal (If-Match 428 / 200)
  const REMOVE = `${LINKS}/${training.body.id}/remove`;
  expect((await m("POST", REMOVE, { session: s.tl })).status).toBe(428);
  const removed = await m("POST", REMOVE, { session: s.tl, headers: ifm(training.body.version) });
  expect([removed.status, removed.body.status]).toEqual([200, "removed"]);

  // ------------------------------------------------------------------ getAdoptionMetricLink (ADR-0033 amendment A2;
  // T-DG4-KBE-R2): the create's Location resolves to 200 with its ETag; a removed link stays readable; 404 / 400.
  const viaLocation = await m("GET", usage.headers.location as string, { session: s.auditor });
  expect([viaLocation.status, viaLocation.headers.etag, viaLocation.body.id]).toEqual([200, '"1"', usage.body.id]);
  const removedRead = await m("GET", `${LINKS}/${training.body.id}`, { session: s.bo });
  expect([removedRead.status, removedRead.body.status, removedRead.headers.etag]).toEqual([200, "removed", '"2"']);
  expect((await m("GET", `${LINKS}/${training.body.id}`, { session: s.admin })).status).toBe(404);
  expect((await m("GET", `${LINKS}/${training.body.id}`, { session: s.outsider })).status).toBe(404);
  expect((await m("GET", `${LINKS}/not-a-uuid`, { session: s.tl })).status).toBe(400);
}
