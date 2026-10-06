// F-DG2-290 (T-DG2-BE13): strict UTF-8 decoding of JSON bodies and query strings - the pure functions (no Fastify, no
// database). The parser and the query check wired into Fastify are tested in apps/api/src/request-encoding.test.ts.
import { describe, expect, it } from "vitest";
import { decodeUtf8Body, parseQueryString, undecodableQueryPointer } from "./request-encoding.ts";

const utf8 = (s: string) => Buffer.from(s, "utf8");
const bytes = (...parts: Array<string | number[]>) =>
  Buffer.concat(parts.map((p) => (typeof p === "string" ? utf8(p) : Buffer.from(p))));
const BOM = [0xef, 0xbb, 0xbf];
const ARABIC = "تحول اصطناعي";
const EMOJI = "🚀👩🏽‍💻";

describe("decodeUtf8Body", () => {
  it("decodes well-formed UTF-8 verbatim (Arabic, emoji, astral, U+FFFD itself)", () => {
    for (const s of ["", "{}", ARABIC, EMOJI, "\u{10FFFF}", "a�b", "\u0000"]) expect(decodeUtf8Body(utf8(s))).toBe(s);
  });

  it("returns null for every ill-formed sequence instead of U+FFFD", () => {
    const bad = [
      [0xff], // never valid
      [0xc3], // truncated 2-byte sequence
      [0xc3, 0x28], // invalid continuation
      [0xe2, 0x82], // truncated 3-byte sequence
      [0xed, 0xa0, 0x80], // CESU-8 lone high surrogate
      [0xed, 0xbf, 0xbf], // CESU-8 lone low surrogate
      [0xc0, 0xaf], // overlong "/"
      [0xf4, 0x90, 0x80, 0x80], // above U+10FFFF
      [0x80], // lone continuation byte
    ];
    for (const b of bad) {
      expect(decodeUtf8Body(bytes('{"a":"x', b, 'y"}')), JSON.stringify(b)).toBeNull();
      expect(decodeUtf8Body(Buffer.from(b)), JSON.stringify(b)).toBeNull();
    }
  });

  it("strips exactly one leading BOM", () => {
    expect(decodeUtf8Body(bytes(BOM, "{}"))).toBe("{}");
    expect(decodeUtf8Body(bytes(BOM, BOM, "{}"))).toBe("﻿{}");
    expect(decodeUtf8Body(bytes("{", BOM, "}"))).toBe("{﻿}");
  });
});

describe("parseQueryString", () => {
  it("has the default parser's shape for well-formed input", () => {
    const q = parseQueryString("a=1&b=&c&a=2&d=x%20y+z&e=%D8%AA%D8%AD%D9%88%D9%84&&f=a=b");
    expect("toString" in q).toBe(false); // null prototype, like the default parser's object
    expect({ ...q }).toEqual({ a: ["1", "2"], b: "", c: "", d: "x y z", e: "تحول", f: "a=b" });
    expect(undecodableQueryPointer(q)).toBeNull();
    expect({ ...parseQueryString("") }).toEqual({});
    expect({ ...parseQueryString("q=%F0%9F%9A%80") }).toEqual({ q: "🚀" });
    expect(Object.keys(parseQueryString("valueOf=x&toString=y"))).toEqual(["valueOf", "toString"]);
  });

  it("marks an undecodable value with /query/<key> and keeps the raw text as the fallback", () => {
    for (const raw of ["%FF", "%ED%A0%80", "%C3", "%ZZ", "50%", "%C0%AF"]) {
      const q = parseQueryString(`ok=1&q=${raw}&later=%FF`);
      expect(undecodableQueryPointer(q), raw).toBe("/query/q");
      expect(q["q"]).toBe(raw);
      expect(q["ok"]).toBe("1");
    }
    expect(undecodableQueryPointer(parseQueryString("a~/b=%FF"))).toBe("/query/a~0~1b");
  });

  it("marks an undecodable key with /query (the raw key is never echoed)", () => {
    const q = parseQueryString("%FF=1");
    expect(undecodableQueryPointer(q)).toBe("/query");
    expect(q["%FF"]).toBe("1");
  });

  it("reports nothing for objects it did not build", () => {
    expect(undecodableQueryPointer({ q: "%FF" })).toBeNull();
    expect(undecodableQueryPointer(undefined)).toBeNull();
  });
});
