// Unit tests of the identity rebind's mapping file parser and its C.5 lines (ADR-0064 §8; p7-work-split §C.5;
// T-DG7-BE-D). The database checks and the all-or-nothing write are proven on PostgreSQL by
// apps/api/test/integration/identity/unbound-signin.test.ts (T-C15). Every id and subject is synthetic.
import { describe, expect, it } from "vitest";
import { MAPPING_HEADER, parseMapping, rebindLines, splitCsvRecord } from "./rebind.ts";

const U1 = "01920000-0000-7000-8000-000000000001";
const U2 = "01920000-0000-7000-8000-000000000002";
const bytes = (s: string) => Buffer.from(s, "utf8");

describe("splitCsvRecord", () => {
  it("splits plain and RFC 4180 quoted fields", () => {
    expect(splitCsvRecord("a,b,c,d")).toEqual(["a", "b", "c", "d"]);
    expect(splitCsvRecord('a,"b,1","c ""q""",')).toEqual(["a", "b,1", 'c "q"', ""]);
  });
  it("refuses broken quoting", () => {
    expect(splitCsvRecord('a,"b')).toBeNull();
    expect(splitCsvRecord('a,b"c')).toBeNull();
    expect(splitCsvRecord('"a"x,b')).toBeNull();
  });
});

describe("parseMapping", () => {
  it("reads rebind and retain lines with their file line numbers (CRLF, BOM, final newline)", () => {
    const parsed = parseMapping(
      bytes(`﻿${MAPPING_HEADER}\r\n${U1},rebind,https://idp.invalid,new-1\r\n${U2},retain,https://old.invalid,s2\r\n`),
    );
    expect(parsed.problems).toEqual([]);
    expect(parsed.lines).toEqual([
      { line: 2, userId: U1, action: "rebind", newIssuer: "https://idp.invalid", newSubject: "new-1" },
      { line: 3, userId: U2, action: "retain", newIssuer: "https://old.invalid", newSubject: "s2" },
    ]);
  });
  it("refuses a wrong header, an empty file, invalid UTF-8", () => {
    expect(parseMapping(bytes("user,action\n")).problems).toEqual([
      { line: 1, reason: `the header must be ${MAPPING_HEADER}` },
    ]);
    expect(parseMapping(bytes(`${MAPPING_HEADER}\n`)).problems).toEqual([
      { line: 1, reason: "the mapping file has no line" },
    ]);
    expect(parseMapping(new Uint8Array([0xff, 0xfe])).problems[0]!.reason).toBe("the mapping file is not valid UTF-8");
  });
  it("lists every structural problem with its C.5 reason", () => {
    const parsed = parseMapping(
      bytes(
        [MAPPING_HEADER, `${U1},move,a,b`, "not-a-uuid,retain,a,b", `${U2},rebind,a`, `${U2},rebind,a,b`].join("\n"),
      ),
    );
    expect(parsed.problems).toEqual([
      { line: 2, reason: "action must be rebind or retain" },
      { line: 3, reason: "unknown user not-a-uuid" },
      { line: 4, reason: "a line has exactly 4 fields: user_id,action,new_issuer,new_subject" },
    ]);
    expect(parsed.lines.map((l) => l.line)).toEqual([5]);
  });
});

describe("rebindLines (C.5)", () => {
  it("prints the refusal and one line per problem, or the summary", () => {
    expect(
      rebindLines({
        ok: false,
        problems: [
          { line: 2, reason: `user ${U1} appears twice` },
          { line: 3, reason: "retain needs the carried issuer and subject" },
        ],
      }),
    ).toEqual([
      "rebind-identity: refused: 2 invalid lines; nothing was changed",
      `line 2: user ${U1} appears twice`,
      "line 3: retain needs the carried issuer and subject",
    ]);
    expect(
      rebindLines({ ok: true, rebound: 3, retained: 1, remainingUnbound: 2, mappingSha256: "0".repeat(64) }),
    ).toEqual(["rebind-identity: rebound 3, retained 1; 2 users remain unbound"]);
  });
});
