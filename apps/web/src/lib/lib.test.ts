// Formatting, permission hints, API client and problem translation.
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiRequest, buildUrl, setCsrfToken } from "../api/client.ts";
import { ancestryOf, canAnywhere, canOn } from "../auth/permissions.ts";
import { createI18n } from "../i18n/index.ts";
import {
  ADMIN_GRANTS,
  BU_ID,
  OFFICE_GRANTS,
  ORG_ID,
  TR_ID,
  WL_GRANTS,
  makeMe,
  mockApi,
  problem,
  route,
} from "../test/fixtures.tsx";
import type { MethodologyCatalogue } from "../api/types.ts";
import { formatDateTime, formatDecimal, formatMoney, zonedLocalToUtcIso } from "./format.ts";
import { gateLabel, gateName } from "./methodology.ts";
import { charterUpdate, diagnosticItemUpdate, freeText } from "@mth/shared/schemas";
import { issueCode } from "../components/Form.tsx";
import { errorMessage, fieldErrorMessage, pointerToField, problemKey } from "./problem.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  setCsrfToken(null);
});

describe("decimal and money formatting (no float artefacts; Unknown is never 0)", () => {
  it("formats exact decimals", () => {
    expect(formatDecimal("0.3", "en")).toBe("0.3");
    expect(formatDecimal("12345678901234567.89", "en", { maxFractionDigits: 2 })).toBe("12,345,678,901,234,567.89");
    expect(formatDecimal("1.005", "en", { maxFractionDigits: 2 })).toBe("1.01"); // half-up on the decimal, not 1.00
    expect(formatDecimal("12.5", "ar", { maxFractionDigits: 1 })).toMatch(/12[.٫]5/);
  });
  it("returns null (rendered as Unknown) for missing or invalid values, never 0", () => {
    expect(formatDecimal(null, "en")).toBeNull();
    expect(formatDecimal("", "en")).toBeNull();
    expect(formatDecimal("abc", "en")).toBeNull();
    expect(formatMoney(undefined, "SAR", "en")).toBeNull();
  });
  it("formats money in SAR by default with Latin digits in Arabic", () => {
    expect(formatMoney("1234.5", "SAR", "en")).toMatch(/SAR\s?1,234\.50/);
    const ar = formatMoney("1234.5", undefined, "ar")!;
    expect(ar).toMatch(/1,?234[.٫]50/);
    expect(ar).not.toMatch(/[٠-٩]/);
  });
});

describe("dates", () => {
  it("shows the instant in the record's time zone (default Asia/Riyadh)", () => {
    // 2026-11-02T20:30Z is 23:30 in Riyadh (UTC+3).
    expect(formatDateTime("2026-11-02T20:30:00Z", "en")).toMatch(/2 Nov 2026.*23:30/);
    expect(formatDateTime("2026-11-02T20:30:00Z", "en", "UTC")).toMatch(/20:30/);
  });
  it("uses the Gregorian calendar and Latin digits in Arabic", () => {
    const s = formatDateTime("2026-11-02T20:30:00Z", "ar")!;
    expect(s).toContain("2026");
    expect(s).toContain("23:30");
    expect(s).not.toMatch(/[٠-٩]/);
  });
  it("returns null for missing or invalid instants", () => {
    expect(formatDateTime(null, "en")).toBeNull();
    expect(formatDateTime("not a date", "en")).toBeNull();
  });
  it("converts a wall-clock time in a zone to UTC", () => {
    expect(zonedLocalToUtcIso("2026-11-02T23:30", "Asia/Riyadh")).toBe("2026-11-02T20:30:00.000Z");
    expect(zonedLocalToUtcIso("2026-01-01", "UTC")).toBe("2026-01-01T00:00:00.000Z");
    expect(zonedLocalToUtcIso("garbage", "UTC")).toBeNull();
  });
});

describe("permission hints mirror the server rules", () => {
  const office = makeMe(OFFICE_GRANTS);
  const admin = makeMe(ADMIN_GRANTS);
  const wl = makeMe(WL_GRANTS);
  const lead = makeMe([
    {
      scope: { type: "business_unit", id: BU_ID },
      inheritsDownward: false,
      permissions: ["transformation.read", "transformation.create", "transformation.update"],
    },
  ]);
  const tr = {
    level: "transformation" as const,
    organizationId: ORG_ID,
    businessUnitId: BU_ID,
    transformationId: TR_ID,
  };

  it("inheriting organization grants apply to transformations inside", () => {
    expect(canOn(office, "transformation.update", tr)).toBe(true);
  });
  it("technical administrators get no business-record permissions", () => {
    expect(canAnywhere(admin, "transformation.read")).toBe(false);
    expect(canOn(admin, "transformation.update", tr)).toBe(false);
    expect(canOn(admin, "user.manage", { level: "organization", organizationId: ORG_ID })).toBe(true);
  });
  it("non-inheriting business-unit grants do not reach transformations (server rule), but allow create at the BU", () => {
    expect(canOn(lead, "transformation.update", tr)).toBe(false);
    expect(
      canOn(lead, "transformation.create", { level: "business_unit", organizationId: ORG_ID, businessUnitId: BU_ID }),
    ).toBe(true);
  });
  it("a transformation grant applies only to that transformation", () => {
    expect(canOn(wl, "transformation.read", tr)).toBe(true);
    expect(canOn(wl, "transformation.read", { ...tr, transformationId: "other" })).toBe(false);
    expect(canAnywhere(wl, "access.read")).toBe(false);
  });
  it("computes business-unit ancestry and stops on cycles", () => {
    const units = [
      { id: "a", parentBusinessUnitId: null },
      { id: "b", parentBusinessUnitId: "a" },
      { id: "c", parentBusinessUnitId: "b" },
      { id: "x", parentBusinessUnitId: "y" },
      { id: "y", parentBusinessUnitId: "x" },
    ];
    expect(ancestryOf("c", units)).toEqual(["c", "b", "a"]);
    expect(ancestryOf("x", units)).toEqual(["x", "y"]);
  });
});

describe("API client", () => {
  it("sends CSRF, If-Match and Idempotency-Key and parses problem+json", async () => {
    const { requests } = mockApi(route("PATCH", /\/x$/, () => problem(409, "version_conflict", { currentVersion: 5 })));
    setCsrfToken("tok".repeat(11));
    const err = await apiRequest("/x", {
      method: "PATCH",
      body: { a: 1 },
      ifMatch: 4,
      idempotencyKey: "key-12345",
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).isConflict).toBe(true);
    expect((err as ApiError).currentVersion).toBe(5);
    expect(requests[0]!.headers["x-csrf-token"]).toBe("tok".repeat(11));
    expect(requests[0]!.headers["if-match"]).toBe('"4"');
    expect(requests[0]!.headers["idempotency-key"]).toBe("key-12345");
    expect(requests[0]!.body).toEqual({ a: 1 });
  });
  it("does not send the CSRF token on GET", async () => {
    const { requests } = mockApi(route("GET", /\/y/, () => ({ status: 200, body: { ok: true } })));
    setCsrfToken("tok".repeat(11));
    await apiRequest("/y");
    expect(requests[0]!.headers["x-csrf-token"]).toBeUndefined();
  });
  it("builds query strings with repeated keys and skips empty values", () => {
    expect(buildUrl("/t", { status: ["draft", "active"], q: "", limit: 25, x: undefined })).toBe(
      "/t?status=draft&status=active&limit=25",
    );
  });
});

describe("problem translation", () => {
  it("translates the problem code, not the English title", async () => {
    const i18n = createI18n("ar");
    const err = new ApiError(422, {
      type: "urn:mth:problem:validation",
      title: "Business rule violated",
      status: 422,
      code: "sod.admin_approver",
      requestId: "r1",
    });
    expect(errorMessage(i18n.t, err)).toContain("الفصل بين المهام");
    await i18n.changeLanguage("en");
    expect(errorMessage(i18n.t, err)).toContain("Separation of duties");
  });
  it("falls back to a status message for unknown codes", () => {
    const i18n = createI18n("en");
    const err = new ApiError(403, {
      type: "urn:mth:problem:forbidden",
      title: "x",
      status: 403,
      code: "brand_new_code",
      requestId: "r",
    });
    expect(errorMessage(i18n.t, err)).toBe("You do not have permission for this action.");
  });
  it("maps pointers and codes to keys", () => {
    expect(pointerToField("/identity/subject")).toBe("identity.subject");
    expect(pointerToField("/query/q")).toBe("q");
    expect(problemKey("validation.too_small")).toBe("problems.validation__too_small");
  });
});

describe("blank free text (F-DG2-150): caught client-side by the shared schemas, localized in EN and AR", () => {
  it("whitespace-only text maps to validation.blank, an empty string to required; null still clears", () => {
    const blank = freeText(1, 20).safeParse(" \t\n ");
    expect(blank.success).toBe(false);
    expect(blank.error!.issues.map(issueCode)).toEqual(["validation.blank"]);
    expect(freeText(1, 20).safeParse("").error!.issues.map(issueCode)).toEqual(["validation.required"]);
    const charter = charterUpdate.safeParse({ inScope: "   ", changeSummary: "Synthetic" });
    expect(charter.error!.issues.map((i) => [i.path.join("/"), issueCode(i)])).toEqual([
      ["inScope", "validation.blank"],
    ]);
    expect(charterUpdate.safeParse({ inScope: null, changeSummary: "Synthetic" }).success).toBe(true);
    expect(diagnosticItemUpdate.safeParse({ currentState: "  " }).success).toBe(false);
    expect(diagnosticItemUpdate.safeParse({ currentState: "  kept as typed  " }).data).toEqual({
      currentState: "  kept as typed  ",
    });
  });
  it("invisible-only text (format characters, U+0085, fillers) also maps to validation.blank (F-DG2-160)", () => {
    for (const v of ["\u200f", "\u0085", "\u2060\u2060\u2060", "\u061c", "\u200b\u3164\u2800"]) {
      const r = freeText(1, 20).safeParse(v);
      expect(r.success, JSON.stringify(v)).toBe(false);
      expect(r.error!.issues.map(issueCode)).toEqual(["validation.blank"]);
    }
    const arabic = "\u200fخارج النطاق\u200f";
    expect(charterUpdate.safeParse({ outOfScope: arabic, changeSummary: "Synthetic" }).data?.outOfScope).toBe(arabic);
  });
  it("the code has a translated message in both languages", async () => {
    const i18n = createI18n("en");
    expect(fieldErrorMessage(i18n.t, "validation.blank")).toBe("Enter some text; spaces alone are not a value.");
    await i18n.changeLanguage("ar");
    expect(fieldErrorMessage(i18n.t, "validation.blank")).toBe("أدخِل نصاً؛ المسافات وحدها ليست قيمة.");
  });
});

describe("product gate label (F-DG2-151, REQ-PB-017 / B0023)", () => {
  const catalogue = {
    gateDefinitions: [{ code: "G2", sourceNameEn: "G2 - Direction", nameAr: "G2 - التوجّه" }],
  } as unknown as MethodologyCatalogue;

  it("shows the verbatim source name once, as given, in each language", () => {
    expect(gateLabel({ sourceNameEn: "G2 - Direction", nameAr: "G2 - التوجّه" }, "en")).toBe("G2 - Direction");
    expect(gateLabel({ sourceNameEn: "G2 - Direction", nameAr: "G2 - التوجّه" }, "ar")).toBe("G2 - التوجّه");
    expect(gateName(catalogue, "G2", "en")).toBe("G2 - Direction");
    expect(gateName(catalogue, "G2", "ar")).toBe("G2 - التوجّه");
  });

  it("falls back to the bare code for a gate the catalogue does not contain", () => {
    expect(gateName(catalogue, "G9", "en")).toBe("G9");
  });
});
