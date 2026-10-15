// Playbook block links in both directions (OpenAPI tag "methodology-reader"; ADR-0049 §4, §10-§11; REQ-S02-004;
// p5-work-split §I.1; T-DG5-BE-Q):
//   GET /methodology/blocks/{blockRef}/links               listMethodologyBlockLinks (session)
//   GET /methodology/templates/{templateCode}/source-links listTemplateSourceLinks   (session)
// With `transformationId`, both also need transformation.read there (else 404) and resolve that transformation's pinned
// methodology version; without it, the latest published `playbook` version (reader.ts, readerContext).
//
// Resolved links of a version = the seeded playbook_block_link rows (0092), minus the version's `linksRemoved`, plus
// its `linksAdded` (the `block.<Bxxxx>` methodology_text element, ADR-0049 §4; the 0089 reader guard checks their
// shapes). Each link carries its label (template: the source_element label; procedure: the resolved definition's
// name; requirement: its ID), the web route that opens it, and `launchable`.
//
// `launchable` is ADR-0042 §9-§10's launch check evaluated without throwing, for the caller: the procedure has a
// published, not removed definition in the procedures version the launch would use (the transformation's `procedure`
// pin, else the newest published `procedures` version), its scope matches the reader's context (an organization
// procedure without transformationId, a transformation procedure with it), and the caller holds procedure.read and
// procedure.launch there through one of the definition's launch roles. `methodology` imports no other business
// module (p5-plan §3 seam 24; architecture.test.ts), so this reads the slice C tables directly, in the same order
// as `launchProcedureInTx`. The reader never launches: "Launch" calls launchProcedureInstance, which re-checks.
// Read-only: nothing here writes, and nothing here is a business approval.
import type { DbOrTx } from "@mth/db";
import { PROBLEM_TYPES } from "@mth/shared";
import { uuid } from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authorize, grantApplies, principalOf, type Principal, type ResolvedTarget } from "../access/index.ts";
import { HttpProblem, parse, parseQuery, type ModuleDeps } from "../platform/index.ts";
import type { ConfigResolver } from "./config-resolver.ts";
import {
  blockRefParam,
  LINK_TARGET_KINDS,
  methodologyVersionRef,
  PHASE_CODES,
  readerContext,
  requireBlock,
  resolveBlockLinks,
  type LinkTargetKind,
  type ReaderContext,
  type ResolvedLink,
} from "./reader.ts";

// ------------------------------------------------------------------------------------------------ zod mirrors

const TEMPLATE_CODE = /^T(0[1-9]|1[0-6])$/;

/** OpenAPI `MethodologyLink`. */
export const methodologyLink = z.strictObject({
  targetKind: z.enum(LINK_TARGET_KINDS),
  targetKey: z.string(),
  labelEn: z.string(),
  labelAr: z.string(),
  route: z.string(),
  origin: z.enum(["seed", "version"]),
  launchable: z.boolean(),
});
/** OpenAPI `MethodologyLinkList`. */
export const methodologyLinkList = z.strictObject({
  blockRef: z.string().regex(/^B0[0-9]{3}$/),
  methodologyVersion: methodologyVersionRef,
  items: z.array(methodologyLink).max(100),
});
/** OpenAPI `TemplateSourceLink`. */
export const templateSourceLink = z.strictObject({
  blockRef: z.string().regex(/^B0[0-9]{3}$/),
  ordinal: z.number().int(),
  phaseCode: z.enum(PHASE_CODES).nullable(),
  excerptEn: z.string(),
  excerptAr: z.string(),
});
/** OpenAPI `TemplateSourceLinkList`. */
export const templateSourceLinkList = z.strictObject({
  templateCode: z.string(),
  methodologyVersion: methodologyVersionRef,
  items: z.array(templateSourceLink).max(50),
});

export type MethodologyLink = z.infer<typeof methodologyLink>;

// ------------------------------------------------------------------------------------------------ labels and routes

/** The web page of each template's register inside a transformation (apps/web/src/app/router.tsx). */
const TEMPLATE_PAGES: Readonly<Record<string, string>> = Object.freeze({
  T01: "diagnose",
  T02: "define",
  T03: "design",
  T04: "decisions",
  T05: "portfolio",
  T06: "prioritization",
  T07: "roadmap",
  T08: "dependencies",
  T09: "benefit-formulas",
  T10: "dashboard",
  T11: "decision-rights",
  T12: "raci",
  T13: "adoption",
  T14: "benefits",
  T15: "raid",
  T16: "executive-decisions",
});

/** Web route of a link: the register in the caller's transformation (else the portfolio to pick one), the procedure
 *  definition, or the requirement row. */
export function linkRoute(kind: LinkTargetKind, key: string, transformationId: string | null): string {
  if (kind === "template") {
    const page = new Map(Object.entries(TEMPLATE_PAGES)).get(key);
    return transformationId === null || page === undefined
      ? "/transformations"
      : `/transformations/${transformationId}/${page}`;
  }
  if (kind === "procedure") return `/admin/procedures/${key}`;
  return `/playbook/requirements/${key}`;
}

interface ProcedureVersionRow {
  readonly id: string;
  readonly status: string;
  readonly based_on_version_id: string | null;
  readonly rollback_of_version_id: string | null;
}

/** The procedures version a launch in this context would use: the `procedure` pin, else the newest published one. */
async function launchVersion(db: DbOrTx, transformationId: string | null): Promise<ProcedureVersionRow | null> {
  const columns = ["v.id", "v.status", "v.based_on_version_id", "v.rollback_of_version_id"] as const;
  if (transformationId !== null) {
    const pinned = await db
      .selectFrom("transformation_config_pin as p")
      .innerJoin("methodology_version as v", "v.id", "p.methodology_version_id")
      .select(columns)
      .where("p.transformation_id", "=", transformationId)
      .where("p.kind", "=", "procedure")
      .executeTakeFirst();
    if (pinned !== undefined) return pinned;
  }
  const newest = await db
    .selectFrom("methodology_version as v")
    .select(columns)
    .where("v.config_kind", "=", "procedure")
    .where("v.key", "=", "procedures")
    .where("v.status", "=", "published")
    .orderBy("v.version_no", "desc")
    .limit(1)
    .executeTakeFirst();
  return newest ?? null;
}

/** The version holding `v`'s procedure rows: itself, else its lineage source (as slice C's rowsVersionIdOf). */
async function procedureRowsVersionId(db: DbOrTx, v: ProcedureVersionRow): Promise<string | null> {
  let current: ProcedureVersionRow = v;
  for (let depth = 0; depth < 1000; depth += 1) {
    const has = await db
      .selectFrom("procedure_definition")
      .select("id")
      .where("methodology_version_id", "=", current.id)
      .limit(1)
      .executeTakeFirst();
    if (has !== undefined) return current.id;
    const next = current.rollback_of_version_id ?? current.based_on_version_id;
    if (next === null) return null;
    const parent = await db
      .selectFrom("methodology_version")
      .select(["id", "status", "based_on_version_id", "rollback_of_version_id"])
      .where("id", "=", next)
      .executeTakeFirst();
    if (parent === undefined) return null;
    current = parent;
  }
  return null;
}

interface ProcedureInfo {
  readonly nameEn: string;
  readonly nameAr: string;
  readonly launchable: boolean;
}

/** Labels and the non-throwing launch check (see the header) of the given procedure codes, for the caller. */
async function procedureInfo(
  db: DbOrTx,
  principal: Principal,
  ctx: ReaderContext,
  codes: readonly string[],
): Promise<Map<string, ProcedureInfo>> {
  const out = new Map<string, ProcedureInfo>();
  if (codes.length === 0) return out;
  const version = await launchVersion(db, ctx.transformationId);
  const rowsId = version === null ? null : await procedureRowsVersionId(db, version);
  const defs =
    rowsId === null
      ? []
      : await db
          .selectFrom("procedure_definition as d")
          .innerJoin("methodology_version as v", "v.id", "d.methodology_version_id")
          .select(["d.code", "d.name_en", "d.name_ar", "d.removed", "d.scope_level", "d.launch_role_codes", "v.status"])
          .where("d.methodology_version_id", "=", rowsId)
          .where("d.code", "in", codes)
          .execute();
  let target: ResolvedTarget | null = ctx.target;
  if (target === null && principal.organizationId !== null) {
    target = {
      level: "organization",
      organizationId: principal.organizationId,
      businessUnitId: null,
      transformationId: null,
      businessUnitAncestry: [],
    };
  }
  let mayLaunch = false;
  if (target !== null && principal.userId !== null && version !== null && version.status === "published") {
    const read = await authorize(db, principal, "procedure.read", target);
    mayLaunch = read.allowed && (await authorize(db, principal, "procedure.launch", target)).allowed;
  }
  for (const d of defs) {
    const scopeMatches = (d.scope_level === "organization") === (ctx.transformationId === null);
    principal.tracker.decisions += 1;
    const launchable =
      mayLaunch &&
      target !== null &&
      d.status === "published" &&
      !d.removed &&
      scopeMatches &&
      d.launch_role_codes.some((role) =>
        principal.grants.some((g) => g.roleCode === role && grantApplies(g, "procedure.launch", target)),
      );
    out.set(d.code, { nameEn: d.name_en, nameAr: d.name_ar, launchable });
  }
  return out;
}

/** The presented links (labels, routes, launchable) of resolved links, in their order. */
export async function presentLinks(
  db: DbOrTx,
  principal: Principal,
  ctx: ReaderContext,
  links: readonly ResolvedLink[],
): Promise<MethodologyLink[]> {
  const templateCodes = [...new Set(links.filter((l) => l.targetKind === "template").map((l) => l.targetKey))];
  const templates =
    templateCodes.length === 0
      ? []
      : await db
          .selectFrom("source_element")
          .select(["stable_key", "source_label_en", "label_ar"])
          .where("set_code", "=", "template")
          .where("stable_key", "in", templateCodes)
          .execute();
  const templateLabels = new Map(templates.map((t) => [t.stable_key, t]));
  const procedures = await procedureInfo(db, principal, ctx, [
    ...new Set(links.filter((l) => l.targetKind === "procedure").map((l) => l.targetKey)),
  ]);
  return links.map((l) => {
    let labelEn = l.targetKey;
    let labelAr = l.targetKey;
    let launchable = false;
    if (l.targetKind === "template") {
      const t = templateLabels.get(l.targetKey);
      if (t !== undefined) {
        labelEn = t.source_label_en;
        labelAr = t.label_ar;
      }
    } else if (l.targetKind === "procedure") {
      const p = procedures.get(l.targetKey);
      if (p !== undefined) {
        labelEn = p.nameEn;
        labelAr = p.nameAr;
        launchable = p.launchable;
      }
    } else {
      labelEn = `Requirement ${l.targetKey}`;
      labelAr = `المتطلب ${l.targetKey}`;
    }
    return {
      targetKind: l.targetKind,
      targetKey: l.targetKey,
      labelEn,
      labelAr,
      route: linkRoute(l.targetKind, l.targetKey, ctx.transformationId),
      origin: l.origin,
      launchable,
    };
  });
}

// ------------------------------------------------------------------------------------------------ routes

const BLOCK_LINKS = "/api/v1/methodology/blocks/:blockRef/links";
const TEMPLATE_LINKS = "/api/v1/methodology/templates/:templateCode/source-links";
const contextQuery = z.strictObject({ transformationId: uuid.optional() });
const templateParams = z.strictObject({ templateCode: z.string().regex(TEMPLATE_CODE, "validation.pattern") });
const EXCERPT_LENGTH = 280;

const excerpt = (text: string) => {
  const chars = [...text];
  return chars.length <= EXCERPT_LENGTH ? text : `${chars.slice(0, EXCERPT_LENGTH - 1).join("")}…`;
};

function templateNotFound(): HttpProblem {
  return new HttpProblem({
    status: 404,
    type: PROBLEM_TYPES.notFound,
    code: "methodology_template.not_found",
    title: "Not found",
    detail: "This template does not exist.",
  });
}

export function registerMethodologySourceLinkRoutes(
  app: FastifyInstance,
  { db }: ModuleDeps,
  resolver: ConfigResolver,
): string[] {
  app.get(BLOCK_LINKS, { config: { access: { permission: "authenticated" } } }, async (request) => {
    const { blockRef } = parse(blockRefParam, request.params, "params");
    const query = parseQuery(contextQuery, request.query);
    const principal = principalOf(request);
    const ctx = await readerContext(db, principal, resolver, query.transformationId);
    await requireBlock(db, blockRef);
    const elements = await ctx.blockElements(db);
    const resolved = (await resolveBlockLinks(db, elements, [blockRef])).get(blockRef) ?? [];
    return {
      blockRef,
      methodologyVersion: ctx.version,
      items: await presentLinks(db, principal, ctx, resolved.slice(0, 100)),
    };
  });

  app.get(TEMPLATE_LINKS, { config: { access: { permission: "authenticated" } } }, async (request) => {
    const { templateCode } = parse(templateParams, request.params, "params");
    const query = parseQuery(contextQuery, request.query);
    const principal = principalOf(request);
    const ctx = await readerContext(db, principal, resolver, query.transformationId);
    const known = await db
      .selectFrom("source_element")
      .select("stable_key")
      .where("set_code", "=", "template")
      .where("stable_key", "=", templateCode)
      .executeTakeFirst();
    if (known === undefined) throw templateNotFound();
    const links = await resolveBlockLinks(db, await ctx.blockElements(db));
    const refs = [...links]
      .filter(([, l]) => l.some((x) => x.targetKind === "template" && x.targetKey === templateCode))
      .map(([ref]) => ref)
      .sort();
    const rows =
      refs.length === 0
        ? []
        : await db
            .selectFrom("playbook_block")
            .select(["block_ref", "ordinal", "phase_code", "text_en", "text_ar"])
            .where("block_ref", "in", refs)
            .orderBy("ordinal")
            .limit(50)
            .execute();
    return {
      templateCode,
      methodologyVersion: ctx.version,
      items: rows.map((r) => ({
        blockRef: r.block_ref,
        ordinal: r.ordinal,
        phaseCode: r.phase_code as (typeof PHASE_CODES)[number] | null,
        excerptEn: excerpt(r.text_en),
        excerptAr: excerpt(r.text_ar),
      })),
    };
  });

  return [`GET ${BLOCK_LINKS}`, `GET ${TEMPLATE_LINKS}`];
}
