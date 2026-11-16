// The identity rebind under IT control (ADR-0064 §8; D-243 Q5; p7-work-split §C.2, §C.5; T-DG7-BE-D):
// `mth-db rebind-identity --mapping <file> --operator <name>` (owner role, lock class identityRebind, key
// "identity-rebind").
//
// The mapping file is CSV, strict UTF-8, header `user_id,action,new_issuer,new_subject`. `action` is `rebind` (the user
// signs in with a new issuer and subject from now on) or `retain` (the carried issuer and subject are confirmed; the
// new pair must equal it). Every line is validated BEFORE any write, inside the transaction that would apply them and
// under the lock, so the check and the write see the same state:
//   - the user exists and has an `unbound` identity_binding_hold;
//   - no user appears twice;
//   - the new (issuer, subject) is not bound to another user (in the database or by another line of the file);
//   - `retain` names exactly the carried pair.
// Any invalid line refuses the whole file: nothing is written, exit 2, every problem listed (`line <k>: <reason>`, k
// the line number in the file, the header being line 1). Otherwise, in that one transaction: user_identity is updated
// (rebind), each hold moves unbound -> rebound | retained (version + 1, optimistic: the update names the version it
// read), one identity_rebind_event is appended per line, and one audit event identity.rebound | identity.retained per
// hold (record identity_binding_hold, actor system, source cli) with the old and new pair and the mapping file's
// SHA-256. Users not in the file stay unbound and cannot sign in (identity/oidc.ts `identity_unbound`).
//
// The rebind is an IT identity operation. It approves nothing (no G1-G6, Finance or IT approval) and never reads or
// writes DG0-DG7.
import { sql } from "kysely";
import { v7 as uuidv7 } from "uuid";
import { insertAuditEvent, type AuditActor } from "../audit.ts";
import type { Db, Tx } from "../pool.ts";
import { transferSha256 } from "./export.ts";
import { decodeStrictUtf8 } from "./manifest.ts";

/** ADR-0016 §6 `identityRebind` (apps/api platform/advisory-locks.ts); pinned to the registry by transfer-locks.test. */
export const IDENTITY_REBIND_LOCK_CLASS = 730404;
/** The registry's one class-wide key of the class. */
export const IDENTITY_REBIND_LOCK_KEY = "identity-rebind";

export const MAPPING_HEADER = "user_id,action,new_issuer,new_subject";

export interface MappingLine {
  /** The line number in the file (the header is line 1). */
  readonly line: number;
  readonly userId: string;
  readonly action: "rebind" | "retain";
  readonly newIssuer: string;
  readonly newSubject: string;
}

export interface MappingProblem {
  readonly line: number;
  readonly reason: string;
}

export interface ParsedMapping {
  readonly lines: readonly MappingLine[];
  readonly problems: readonly MappingProblem[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Splits one CSV record (RFC 4180 quoting: `"…"`, `""` inside quotes); null when the quoting is broken. */
export function splitCsvRecord(record: string): string[] | null {
  const out: string[] = [];
  let i = 0;
  for (;;) {
    if (record[i] === '"') {
      let value = "";
      i += 1;
      for (;;) {
        if (i >= record.length) return null;
        const ch = record[i]!;
        if (ch === '"') {
          if (record[i + 1] === '"') {
            value += '"';
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        value += ch;
        i += 1;
      }
      out.push(value);
      if (i === record.length) return out;
      if (record[i] !== ",") return null;
      i += 1;
    } else {
      const next = record.indexOf(",", i);
      const value = next === -1 ? record.slice(i) : record.slice(i, next);
      if (value.includes('"')) return null;
      out.push(value);
      if (next === -1) return out;
      i = next + 1;
    }
  }
}

/**
 * Parses the mapping file (strict UTF-8). Structural problems (header, field count, quoting, an invalid action, a
 * user id that is not a uuid) are reported here; the database checks are `validateMapping`'s.
 */
export function parseMapping(bytes: Uint8Array): ParsedMapping {
  let text: string;
  try {
    text = decodeStrictUtf8(bytes);
  } catch {
    return { lines: [], problems: [{ line: 1, reason: "the mapping file is not valid UTF-8" }] };
  }
  const records = text.replace(/^﻿/, "").split(/\r?\n/);
  if (records.length > 0 && records[records.length - 1] === "") records.pop();
  if (records[0] !== MAPPING_HEADER)
    return { lines: [], problems: [{ line: 1, reason: `the header must be ${MAPPING_HEADER}` }] };
  const lines: MappingLine[] = [];
  const problems: MappingProblem[] = [];
  records.slice(1).forEach((record, index) => {
    const line = index + 2;
    const fields = splitCsvRecord(record);
    if (fields === null || fields.length !== 4) {
      problems.push({ line, reason: "a line has exactly 4 fields: user_id,action,new_issuer,new_subject" });
      return;
    }
    const [userId, action, newIssuer, newSubject] = fields as [string, string, string, string];
    if (!UUID.test(userId)) {
      problems.push({ line, reason: `unknown user ${userId}` });
      return;
    }
    if (action !== "rebind" && action !== "retain") {
      problems.push({ line, reason: "action must be rebind or retain" });
      return;
    }
    lines.push({ line, userId, action, newIssuer, newSubject });
  });
  if (lines.length === 0 && problems.length === 0) problems.push({ line: 1, reason: "the mapping file has no line" });
  return { lines, problems };
}

interface CarriedUser {
  readonly userId: string;
  readonly organizationId: string;
  readonly holdId: string | null;
  readonly holdState: string | null;
  readonly holdVersion: number | null;
  readonly identities: readonly { readonly id: string; readonly issuer: string; readonly subject: string }[];
}

interface PlannedLine extends MappingLine {
  readonly holdId: string;
  readonly holdVersion: number;
  readonly organizationId: string;
  readonly identityId: string;
  readonly oldIssuer: string;
  readonly oldSubject: string;
}

const codePoints = (s: string): number => [...s].length;

/** Validates every parsed line against the database (in the caller's transaction, under the lock). */
export async function validateMapping(
  tx: Tx,
  lines: readonly MappingLine[],
): Promise<{ planned: PlannedLine[]; problems: MappingProblem[] }> {
  const problems: MappingProblem[] = [];
  const planned: PlannedLine[] = [];
  const ids = [...new Set(lines.map((l) => l.userId))];
  const users = new Map<string, CarriedUser>();
  if (ids.length > 0) {
    const rows = await tx
      .selectFrom("app_user as u")
      .leftJoin("identity_binding_hold as h", "h.user_id", "u.id")
      .select(["u.id", "u.organization_id", "h.id as hold_id", "h.state", "h.version"])
      .where("u.id", "in", ids)
      .execute();
    const identities = await tx
      .selectFrom("user_identity")
      .select(["id", "user_id", "issuer", "subject"])
      .where("user_id", "in", ids)
      .orderBy("created_at")
      .orderBy("id")
      .execute();
    for (const r of rows)
      users.set(r.id, {
        userId: r.id,
        organizationId: r.organization_id,
        holdId: r.hold_id,
        holdState: r.state,
        holdVersion: r.version,
        identities: identities.filter((i) => i.user_id === r.id),
      });
  }
  const seen = new Set<string>();
  const claimed = new Map<string, string>(); // "issuer\nsubject" -> user id (by an earlier line of the file)
  for (const l of lines) {
    const problem = (reason: string) => problems.push({ line: l.line, reason });
    if (seen.has(l.userId)) {
      problem(`user ${l.userId} appears twice`);
      continue;
    }
    seen.add(l.userId);
    const user = users.get(l.userId);
    if (user === undefined) {
      problem(`unknown user ${l.userId}`);
      continue;
    }
    if (user.holdId === null || user.holdState !== "unbound" || user.holdVersion === null) {
      problem(`user ${l.userId} has no unbound hold`);
      continue;
    }
    // A carried user has exactly one identity to confirm or replace (the event records one old pair).
    if (user.identities.length !== 1) {
      problem(`user ${l.userId} has ${user.identities.length} carried identities; exactly 1 is needed`);
      continue;
    }
    const carried = user.identities[0]!;
    if (l.action === "retain") {
      if (l.newIssuer !== carried.issuer || l.newSubject !== carried.subject) {
        problem("retain needs the carried issuer and subject");
        continue;
      }
    } else {
      const issuerLength = codePoints(l.newIssuer);
      const subjectLength = codePoints(l.newSubject);
      if (issuerLength < 1 || issuerLength > 512 || subjectLength < 1 || subjectLength > 255) {
        problem("rebind needs a new issuer of 1-512 and a new subject of 1-255 characters");
        continue;
      }
      if (l.newIssuer === carried.issuer && l.newSubject === carried.subject) {
        problem("rebind needs a pair other than the carried one; use retain to confirm it");
        continue;
      }
      const pair = `${l.newIssuer}\n${l.newSubject}`;
      const other = claimed.get(pair);
      const bound = await tx
        .selectFrom("user_identity")
        .select("user_id")
        .where("issuer", "=", l.newIssuer)
        .where("subject", "=", l.newSubject)
        .executeTakeFirst();
      if ((other !== undefined && other !== l.userId) || (bound !== undefined && bound.user_id !== l.userId)) {
        problem(`${l.newIssuer} ${l.newSubject} is already bound to another user`);
        continue;
      }
      claimed.set(pair, l.userId);
    }
    planned.push({
      ...l,
      holdId: user.holdId,
      holdVersion: user.holdVersion,
      organizationId: user.organizationId,
      identityId: carried.id,
      oldIssuer: carried.issuer,
      oldSubject: carried.subject,
    });
  }
  return { planned, problems: problems.sort((a, b) => a.line - b.line) };
}

export type RebindOutcome =
  | { readonly ok: false; readonly problems: readonly MappingProblem[] }
  | {
      readonly ok: true;
      readonly rebound: number;
      readonly retained: number;
      readonly remainingUnbound: number;
      readonly mappingSha256: string;
    };

/** A hold changed between the read and the write (the optimistic check). */
export class RebindConflict extends Error {
  constructor(holdId: string) {
    super(`identity_binding_hold ${holdId} changed during the rebind`);
    this.name = "RebindConflict";
  }
}

class Refused extends Error {
  readonly problems: readonly MappingProblem[];
  constructor(problems: readonly MappingProblem[]) {
    super("refused");
    this.problems = problems;
  }
}

/** Applies the mapping file whole or not at all (ADR-0064 §8). */
export async function applyRebind(db: Db, bytes: Uint8Array, operator: string): Promise<RebindOutcome> {
  const mappingSha256 = transferSha256(bytes);
  const parsed = parseMapping(bytes);
  const actor: AuditActor = { actorType: "system", actorUserId: null, source: "cli" };
  try {
    return await db.transaction().execute(async (tx) => {
      await sql`SELECT pg_advisory_xact_lock(${IDENTITY_REBIND_LOCK_CLASS}::int, hashtext(${IDENTITY_REBIND_LOCK_KEY}))`.execute(
        tx,
      );
      const checked = await validateMapping(tx, parsed.lines);
      const problems = [...parsed.problems, ...checked.problems].sort((a, b) => a.line - b.line);
      if (problems.length > 0) throw new Refused(problems);
      let rebound = 0;
      let retained = 0;
      for (const p of checked.planned) {
        const state = p.action === "rebind" ? "rebound" : "retained";
        if (p.action === "rebind") {
          await tx
            .updateTable("user_identity")
            .set({ issuer: p.newIssuer, subject: p.newSubject })
            .where("id", "=", p.identityId)
            .execute();
          rebound += 1;
        } else retained += 1;
        const version = p.holdVersion + 1;
        const updated = await tx
          .updateTable("identity_binding_hold")
          .set({
            state,
            mapping_sha256: mappingSha256,
            operator_name: operator,
            resolved_at: sql<Date>`now()`,
            version,
            updated_at: sql<Date>`now()`,
          })
          .where("id", "=", p.holdId)
          .where("version", "=", p.holdVersion)
          .where("state", "=", "unbound")
          .executeTakeFirst();
        if (updated.numUpdatedRows !== 1n) throw new RebindConflict(p.holdId);
        await tx
          .insertInto("identity_rebind_event")
          .values({
            id: uuidv7(),
            identity_binding_hold_id: p.holdId,
            user_id: p.userId,
            action: state,
            old_issuer: p.oldIssuer,
            old_subject: p.oldSubject,
            new_issuer: p.newIssuer,
            new_subject: p.newSubject,
            mapping_sha256: mappingSha256,
            operator_name: operator,
            applied_at: sql<Date>`now()`,
          })
          .execute();
        await insertAuditEvent(tx, actor, {
          action: p.action === "rebind" ? "identity.rebound" : "identity.retained",
          recordType: "identity_binding_hold",
          recordId: p.holdId,
          organizationId: p.organizationId,
          priorVersion: p.holdVersion,
          newVersion: version,
          reason: `mth-db rebind-identity by operator ${operator}`,
          changes: {
            state: { from: "unbound", to: state },
            identity: {
              from: { issuer: p.oldIssuer, subject: p.oldSubject },
              to: { issuer: p.newIssuer, subject: p.newSubject },
            },
            mapping_sha256: { from: null, to: mappingSha256 },
            user_id: { from: p.userId, to: p.userId },
          },
        });
      }
      const left = await tx
        .selectFrom("identity_binding_hold")
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .where("state", "=", "unbound")
        .executeTakeFirstOrThrow();
      return { ok: true as const, rebound, retained, remainingUnbound: Number(left.n), mappingSha256 };
    });
  } catch (err) {
    if (err instanceof Refused) return { ok: false, problems: err.problems };
    throw err;
  }
}

/** The C.5 lines of an outcome. */
export function rebindLines(outcome: RebindOutcome): string[] {
  if (!outcome.ok)
    return [
      `rebind-identity: refused: ${outcome.problems.length} invalid lines; nothing was changed`,
      ...outcome.problems.map((p) => `line ${p.line}: ${p.reason}`),
    ];
  return [
    `rebind-identity: rebound ${outcome.rebound}, retained ${outcome.retained}; ${outcome.remainingUnbound} users remain unbound`,
  ];
}
