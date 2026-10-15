// The source 90-day launch plan (P5 slice H; ADR-0048 §1, §7; REQ-PB-086; p5-work-split §H.1; T-DG5-BE-P):
//   GET /launch-plan-template   getLaunchPlanTemplate (any signed-in user)
//
// The three B0134 windows with their objectives and the full action and output cells, verbatim, and the 33 template
// items (the cells split at ';', each fragment verbatim, plus the B0135 Day-90 leadership test), read from the 0086
// catalogues. The Arabic texts are provisional translations. Read-only; nothing here writes.
import type { DbOrTx } from "@mth/db";
import type { LaunchPlanTemplate, LaunchTemplateItem, LaunchWindow } from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import type { ModuleDeps } from "../platform/index.ts";

export const LAUNCH_PLAN_TEMPLATE = "/api/v1/launch-plan-template";
export const LAUNCH_TEMPLATE_SOURCE_REF = "B0134";

export async function loadLaunchPlanTemplate(db: DbOrTx): Promise<LaunchPlanTemplate> {
  const [windows, items] = await Promise.all([
    db.selectFrom("launch_window").selectAll().orderBy("ordinal").execute(),
    db.selectFrom("launch_template_item").selectAll().orderBy("ordinal").execute(),
  ]);
  const toItem = (i: (typeof items)[number]): LaunchTemplateItem => ({
    code: i.code,
    itemKind: i.item_kind as LaunchTemplateItem["itemKind"],
    ordinal: i.ordinal,
    textEn: i.text_en,
    textAr: i.text_ar,
    outputRecordType: i.output_record_type as LaunchTemplateItem["outputRecordType"],
    startDay: i.start_day,
    dueDay: i.due_day,
    sourceRef: i.source_ref,
  });
  return {
    windows: windows.map(
      (w): LaunchWindow => ({
        code: w.code as LaunchWindow["code"],
        ordinal: w.ordinal,
        labelEn: w.label_en,
        labelAr: w.label_ar,
        objectiveEn: w.objective_en,
        objectiveAr: w.objective_ar,
        actionsSourceEn: w.actions_source_en,
        outputsSourceEn: w.outputs_source_en,
        startDay: w.start_day,
        endDay: w.end_day,
        items: items.filter((i) => i.window_code === w.code).map(toItem),
      }),
    ),
    sourceRef: LAUNCH_TEMPLATE_SOURCE_REF,
  };
}

/** Registers the template route and returns it as "METHOD /path". */
export function registerLaunchTemplateRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  app.get(LAUNCH_PLAN_TEMPLATE, { config: { access: { permission: "authenticated" } } }, async () =>
    loadLaunchPlanTemplate(db),
  );
  return [`GET ${LAUNCH_PLAN_TEMPLATE}`];
}
