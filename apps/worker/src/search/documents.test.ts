// T-DG6-BE-P (ADR-0057 §1, §2; REQ-S15-010): the pure parts of the search index. The document builders read exactly
// the ADR-0057 §1 columns (the table restated here row by row), cut free text only through the shared truncateText
// (never splitting a surrogate pair), and derive is_archived per type; the declared sensitive-read exception covers the
// two search job codes only; the two queues, handlers and their 0115 schedule rows agree. No database: the
// database-backed proofs are in apps/api/test/integration/search/index-feed.test.ts.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { JOB_SERVICE_IDENTITIES } from "../kit.ts";
import {
  SEARCH_HANDLERS,
  SEARCH_INDEX_FEED_QUEUE,
  SEARCH_REINDEX_LOCK,
  SEARCH_REINDEX_QUEUE,
} from "../handlers/search.ts";
import { SEARCH_QUEUES } from "../queues/search.ts";
import type { ServicePrincipal } from "../service-scope.ts";
import {
  buildDocument,
  exceptionAdmits,
  SEARCH_DOCUMENT_SPECS,
  SEARCH_RECORD_TYPES,
  SEARCH_SENSITIVE_READ_EXCEPTION,
  sourceColumnsOf,
  type SearchRecordType,
  type SourceRow,
} from "./documents.ts";

const MIGRATION_0108 = new URL(
  "../../../../packages/db/migrations/0108_p6_search_saved_views_help.sql",
  import.meta.url,
);
const MIGRATION_0115 = new URL("../../../../packages/db/migrations/0115_p6_search_index_jobs.sql", import.meta.url);

/** ADR-0057 §1, verbatim: type -> [code, title, summary, archived when]. */
const ADR_TABLE: Record<SearchRecordType, [string | null, string, string | null, string]> = {
  transformation: ["code", "name", "description", "archived_at"],
  initiative: ["code", "name", "objective", "never"],
  kpi_definition: [null, "name", "description", "archived"],
  benefit: ["code", "title", "description", "archived"],
  raid_entry: ["code", "description", null, "never"],
  dependency: ["code", "description", null, "archived"],
  decision: ["code", "title", "context", "never"],
  deliverable: [null, "title", "description", "archived"],
  evidence: [null, "title", "description", "archived"],
  business_case: ["code", "title", null, "archived"],
  lesson: ["code", "title", "context", "archived"],
  change_request: ["code", "reason", null, "withdrawn"],
};

const row = (over: Partial<SourceRow> = {}): SourceRow => ({
  id: "01920006-0115-7000-8000-0000000000c1",
  organization_id: "01920006-0115-7000-8000-0000000000c2",
  transformation_id: "01920006-0115-7000-8000-0000000000c3",
  version: 3,
  status: "active",
  code: "INI-02",
  title: "Synthetic network initiative",
  summary: "Upgrade towers",
  archived_at: null,
  ...over,
});

const principal = (code: string): ServicePrincipal => ({
  kind: "service",
  identityId: "01920006-0115-7000-8000-0000000000c4",
  code,
  organizationId: "01920006-0115-7000-8000-0000000000c2",
  permissions: new Set(["transformation.read"]),
  sensitiveAccess: "none",
});

describe("the search document builders (ADR-0057 §1)", () => {
  it("cover exactly the 12 types of 0108 p6_search_record_type_valid", () => {
    const sql = readFileSync(MIGRATION_0108, "utf8");
    const fn = sql.slice(sql.indexOf("CREATE FUNCTION p6_search_record_type_valid"), sql.indexOf("$$;"));
    const declared = [...fn.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect([...SEARCH_RECORD_TYPES].sort()).toEqual([...declared].sort());
    expect(Object.keys(SEARCH_DOCUMENT_SPECS).sort()).toEqual([...SEARCH_RECORD_TYPES].sort());
  });

  it("read exactly the ADR-0057 §1 columns, plus the scope keys, version and status", () => {
    for (const t of SEARCH_RECORD_TYPES) {
      const s = SEARCH_DOCUMENT_SPECS[t];
      const [code, title, summary, archived] = ADR_TABLE[t];
      expect([s.code, s.title, s.summary], t).toEqual([code, title, summary]);
      const rule = s.archived.kind === "status" ? s.archived.status : s.archived.kind;
      expect(rule, t).toBe(archived);
      const expected = ["id", "organization_id", "version", "status"];
      if (t !== "transformation") expected.push("transformation_id");
      for (const c of [code, title, summary]) if (c !== null) expected.push(c);
      if (archived === "archived_at") expected.push("archived_at");
      expect([...sourceColumnsOf(t)].sort(), t).toEqual(expected.sort());
    }
  });

  it("never name a value column (money, rate, FTE, KPI, score)", () => {
    const value = /amount|value|rate|fte|score|cost|baseline|target|actual|saving|npv|currency|budget|weight|percent/;
    for (const t of SEARCH_RECORD_TYPES) for (const c of sourceColumnsOf(t)) expect(c, `${t}.${c}`).not.toMatch(value);
  });

  it("derive is_archived per type; a transformation is its own transformation", () => {
    expect(buildDocument("benefit", row({ status: "archived" })).isArchived).toBe(true);
    expect(buildDocument("benefit", row({ status: "active" })).isArchived).toBe(false);
    expect(buildDocument("initiative", row({ status: "archived" })).isArchived).toBe(false);
    expect(buildDocument("change_request", row({ status: "withdrawn" })).isArchived).toBe(true);
    expect(buildDocument("change_request", row({ status: "archived" })).isArchived).toBe(false);
    const tx = buildDocument("transformation", row({ archived_at: new Date("2026-10-01T00:00:00Z") }));
    expect(tx.isArchived).toBe(true);
    expect(tx.transformationId).toBe(row().id);
    expect(buildDocument("transformation", row()).isArchived).toBe(false);
    expect(buildDocument("decision", row()).transformationId).toBe(row().transformation_id);
  });

  it("cut free text through truncateText (500 / 1000 / 40), never splitting a surrogate pair; blank is absent", () => {
    const emoji = "\u{1F600}";
    const long = `${"a".repeat(499)}${emoji}tail`;
    const d = buildDocument("raid_entry", row({ title: long, summary: "ignored for raid" }));
    expect(d.title).toBe("a".repeat(499));
    expect(d.summary).toBeNull(); // raid_entry has no summary column
    expect(buildDocument("benefit", row({ summary: "x".repeat(1200) })).summary).toHaveLength(1000);
    expect(buildDocument("benefit", row({ summary: "  ​ " })).summary).toBeNull();
    expect(buildDocument("benefit", row({ code: "C".repeat(50) })).code).toHaveLength(40);
    expect(buildDocument("kpi_definition", row({ code: "IGNORED" })).code).toBeNull();
    expect(() => buildDocument("benefit", row({ title: "   " }))).toThrow(/no title/);
    expect(buildDocument("benefit", row()).recordVersion).toBe(3);
  });
});

describe("the declared sensitive-read exception (ADR-0057 §2; D-199 item 3)", () => {
  it("covers the two search job codes and the three sensitive types only", () => {
    expect([...SEARCH_SENSITIVE_READ_EXCEPTION.jobCodes].sort()).toEqual([
      "job:search.index_feed",
      "job:search.reindex",
    ]);
    for (const t of SEARCH_RECORD_TYPES) {
      const sensitive = ["benefit", "business_case", "evidence"].includes(t);
      expect(exceptionAdmits(principal("job:search.index_feed"), t), t).toBe(sensitive);
      expect(exceptionAdmits(principal("job:search.reindex"), t), t).toBe(sensitive);
      expect(exceptionAdmits(principal("job:kpi.recalculate"), t), t).toBe(false);
      expect(exceptionAdmits(principal("job:reports.export"), t), t).toBe(false);
    }
  });

  it("the two identities declare transformation.read only and no aggregate access", () => {
    for (const q of [SEARCH_INDEX_FEED_QUEUE, SEARCH_REINDEX_QUEUE]) {
      const d = JOB_SERVICE_IDENTITIES.find((x) => x.queue === q)!;
      expect(d.permissions).toEqual(["transformation.read"]);
      expect(d.sensitiveAccess).toBe("none");
      expect(d.scope).toBe("platform");
    }
    const reason = readFileSync(MIGRATION_0115, "utf8");
    expect(reason).toContain("Declared exception (ADR-0057 §2, D-199)");
  });
});

describe("the two search jobs (ADR-0057 §2)", () => {
  it("one queue and one handler each; lock class 730318", () => {
    expect(SEARCH_QUEUES.map((q) => q.name)).toEqual(["search.index_feed", "search.reindex"]);
    expect(SEARCH_HANDLERS.map((h) => h.queue)).toEqual(["search.index_feed", "search.reindex"]);
    expect(SEARCH_REINDEX_LOCK).toBe(730318);
  });

  it("0115 schedules them: every minute, and Sunday 02:30, Asia/Riyadh, owner module search", () => {
    const sql = readFileSync(MIGRATION_0115, "utf8");
    const rows = [
      ...sql.matchAll(/\('([0-9a-f-]{36})', '([a-z_.]+)', '([a-z_.]+)', '([^']+)', '([^']+)',[\s\S]*?'([a-z_]+)'\)/g),
    ].map((m) => ({ code: m[2], queue: m[3], cron: m[4], tz: m[5], owner: m[6] }));
    expect(rows).toEqual([
      { code: "search.index_feed", queue: "search.index_feed", cron: "* * * * *", tz: "Asia/Riyadh", owner: "search" },
      { code: "search.reindex", queue: "search.reindex", cron: "30 2 * * 0", tz: "Asia/Riyadh", owner: "search" },
    ]);
    expect(sql).toContain("'job_schedule.create', 'job_schedule'");
  });
});
