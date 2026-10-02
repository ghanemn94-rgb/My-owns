// methodology routes (p2-work-split §2; ADR-0014, ADR-0016 §2; REQ-PB-002, REQ-PB-038, REQ-S02-001/004):
//   GET   /transformations/{id}/methodology              the pinned catalogue (transformation.read)
//   PATCH /methodology/tom-dimensions/{dimensionCode}    label and Arabic-translation edits (methodology.configure)
// Source text, codes and order are immutable (trigger tom_dimension_source_immutable); edits are versioned (If-Match,
// version + 1) and audited (the deferred audit guard of 0011 refuses a commit without the event).
import { diffFields, sql } from "@mth/db";
import { tomDimensionLabelsUpdate } from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { auditContextOf, denialOf, principalOf, requireTransformationRead } from "../access/index.ts";
import { record } from "../audit/index.ts";
import {
  parse,
  parseBody,
  problems,
  requireIfMatch,
  sendVersioned,
  type ModuleDeps,
  type ModuleRegistration,
} from "../platform/index.ts";
import { loadMethodologyCatalogue, toTomDimension } from "./repository.ts";

const CATALOGUE = "/api/v1/transformations/:transformationId/methodology";
const TOM_DIMENSION = "/api/v1/methodology/tom-dimensions/:dimensionCode";

export const METHODOLOGY_MODULE: ModuleRegistration = Object.freeze({
  module: "methodology",
  status: "active",
  deliversIn: "P2",
  routes: Object.freeze([`GET ${CATALOGUE}`, `PATCH ${TOM_DIMENSION}`]) as readonly string[],
});

const LABEL_COLUMNS = [
  ["labelEn", "label_en"],
  ["labelAr", "label_ar"],
  ["designQuestionAr", "design_question_ar"],
  ["canvasBoxAr", "canvas_box_ar"],
  ["canvasPromptAr", "canvas_prompt_ar"],
] as const;

export function registerMethodologyModule(app: FastifyInstance, { db }: ModuleDeps): ModuleRegistration {
  app.get(CATALOGUE, { config: { access: { permission: "transformation.read" } } }, async (request) => {
    const { transformationId } = parse(z.strictObject({ transformationId: z.uuid() }), request.params, "params");
    await requireTransformationRead(db, principalOf(request), transformationId);
    const catalogue = await loadMethodologyCatalogue(db, transformationId);
    if (!catalogue) throw problems.notFound();
    return catalogue;
  });

  app.patch(TOM_DIMENSION, { config: { access: { permission: "methodology.configure" } } }, async (request, reply) => {
    const { dimensionCode } = parse(
      z.strictObject({ dimensionCode: z.string().regex(/^[a-z][a-z0-9_]{0,47}$/) }),
      request.params,
      "params",
    );
    const principal = principalOf(request);
    const audit = auditContextOf(request);
    const row = await db.transaction().execute(async (tx) => {
      const current = await tx
        .selectFrom("tom_dimension")
        .selectAll()
        .where("code", "=", dimensionCode)
        .executeTakeFirst();
      if (!current) throw problems.notFound();
      // The catalogue is global configuration: methodology.configure is required in the caller's organization
      // (ADM_METHOD by default). Technical admins and auditors do not hold it (ADR-0020).
      principal.tracker.decisions += 1;
      const allowed = principal.grants.some(
        (g) => g.permissions.has("methodology.configure") && g.organizationId === principal.organizationId,
      );
      if (!allowed || principal.organizationId === null) {
        const denied = problems.forbidden();
        throw principal.organizationId === null
          ? denied
          : denied.withDenial(
              denialOf("methodology.configure", {
                level: "organization",
                organizationId: principal.organizationId,
                businessUnitId: null,
                transformationId: null,
                businessUnitAncestry: [],
              }),
            );
      }
      const body = parseBody(tomDimensionLabelsUpdate, request.body);
      const expected = requireIfMatch(request);
      const locked = await tx
        .selectFrom("tom_dimension")
        .selectAll()
        .where("id", "=", current.id)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (locked.version !== expected) throw problems.versionConflict(locked.version);
      const present = new Map(Object.entries(body));
      const changes = Object.fromEntries(
        LABEL_COLUMNS.filter(([f]) => present.get(f) !== undefined).map(([f, c]) => [c, present.get(f)]),
      );
      const updated = await tx
        .updateTable("tom_dimension")
        .set({
          ...changes,
          version: sql<number>`version + 1`,
          updated_at: sql<Date>`now()`,
          updated_by: principal.userId,
        })
        .where("id", "=", locked.id)
        .where("version", "=", locked.version)
        .returningAll()
        .executeTakeFirstOrThrow();
      await record(tx, audit, {
        action: "tom_dimension.update_labels",
        recordType: "tom_dimension",
        recordId: locked.id,
        organizationId: principal.organizationId,
        priorVersion: locked.version,
        newVersion: updated.version,
        changes: diffFields(
          locked,
          updated,
          LABEL_COLUMNS.map(([, c]) => c),
        ),
      });
      return updated;
    });
    return sendVersioned(reply, 200, toTomDimension(row));
  });

  return METHODOLOGY_MODULE;
}
