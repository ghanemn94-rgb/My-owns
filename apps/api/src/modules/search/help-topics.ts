// Contextual help topics (OpenAPI tag "search"; ADR-0057 §9, §10; REQ-S15-010 "contextual help"; p6-work-split §H/G.4,
// T-DG6-BE-Q2). Route file created as a stub by T-DG6-BE-A with its registration line:
//   GET /api/v1/help-topics?screenKey=     listHelpTopics   (signed in; by screen and ordinal; cursor-paginated)
//   GET /api/v1/help-topics/{topicKey}     getHelpTopic     (signed in; 404 for an unknown key)
// The catalogue is `help_topic` (0108: 11 seeded topics on 5 screens; SELECT-only for mth_app, so nothing here can
// change it). Each topic is served in English and Arabic; `arabicProvisional` is the stored flag (true for every seed:
// the Arabic is a provisional translation, ending "(ترجمة مؤقتة)"). The client chooses the language at render time.
// Read-only: no audit event (no mutation), nothing approves anything (G1-G6) or touches DG0-DG7.
import type { HelpTopicRow } from "@mth/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  cursorSchema,
  decodeCursor,
  filterHash,
  limitSchema,
  paginate,
  parse,
  parseQuery,
  problems,
  type ModuleDeps,
} from "../platform/index.ts";

const HELP_TOPICS = "/api/v1/help-topics";
const HELP_TOPIC = `${HELP_TOPICS}/:topicKey`;
/** The contract's `screenKey` / `topicKey` pattern (0108 `help_topic_topic_key`). */
const KEY = z
  .string()
  .max(80)
  .regex(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/);
const listQuery = z.strictObject({ screenKey: KEY.optional(), cursor: cursorSchema, limit: limitSchema });
const topicParams = z.strictObject({ topicKey: KEY });

/** The contract's `HelpTopic`. */
export interface HelpTopic {
  topicKey: string;
  screenKey: string;
  ordinal: number;
  titleEn: string;
  titleAr: string;
  bodyEn: string;
  bodyAr: string;
  arabicProvisional: boolean;
  sourceRefs: string[];
}

export function toHelpTopic(r: HelpTopicRow): HelpTopic {
  return {
    topicKey: r.topic_key,
    screenKey: r.screen_key,
    ordinal: r.ordinal,
    titleEn: r.title_en,
    titleAr: r.title_ar,
    bodyEn: r.body_en,
    bodyAr: r.body_ar,
    arabicProvisional: r.arabic_provisional,
    sourceRefs: [...r.source_refs],
  };
}

const badCursor = () =>
  problems.badRequest("validation.cursor", "The cursor is invalid or belongs to other filters.", "/query/cursor");

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerHelpTopicRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  app.get(HELP_TOPICS, { config: { access: { permission: "authenticated" } } }, async (request) => {
    const query = parseQuery(listQuery, request.query);
    const hash = filterHash({ list: "help_topics", screenKey: query.screenKey ?? null });
    const after = decodeCursor(query.cursor, hash, 2);
    let q = db.selectFrom("help_topic").selectAll();
    if (query.screenKey !== undefined) q = q.where("screen_key", "=", query.screenKey);
    if (after !== null) {
      const screen = String(after[0]);
      const ordinal = Number(after[1]);
      if (!KEY.safeParse(screen).success || !Number.isInteger(ordinal) || ordinal < 1) throw badCursor();
      q = q.where((eb) =>
        eb.or([eb("screen_key", ">", screen), eb.and([eb("screen_key", "=", screen), eb("ordinal", ">", ordinal)])]),
      );
    }
    const rows = await q
      .orderBy("screen_key", "asc")
      .orderBy("ordinal", "asc")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.screen_key, String(r.ordinal)], hash);
    return { items: page.items.map(toHelpTopic), nextCursor: page.nextCursor };
  });

  app.get(HELP_TOPIC, { config: { access: { permission: "authenticated" } } }, async (request) => {
    const p = parse(topicParams, request.params, "params");
    parseQuery(z.strictObject({}), request.query);
    const row = await db.selectFrom("help_topic").selectAll().where("topic_key", "=", p.topicKey).executeTakeFirst();
    if (row === undefined) throw problems.notFound();
    return toHelpTopic(row);
  });

  return [`GET ${HELP_TOPICS}`, `GET ${HELP_TOPIC}`];
}
