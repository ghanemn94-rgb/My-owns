// ADR-0053 §4 item 4 (T-DG6-BE-K): the redaction applied to an error text before it is stored in
// operational_exception.last_error_message and operational_failure.error_message. Every value is SYNTHETIC.
import { describe, expect, it } from "vitest";
import { redactErrorText } from "./kit.ts";

describe("redactErrorText (ADR-0053 §4)", () => {
  it.each([
    ["-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAK\n-----END RSA PRIVATE KEY----- tail", "MIIBOgIBAAJBAK"],
    ["key AKIAABCDEFGHIJKLMNOP used", "AKIAABCDEFGHIJKLMNOP"],
    ["https://h/o?X-Amz-Signature=deadbeef&X-Amz-Credential=AK/2026&x=1", "deadbeef"],
    ["Authorization: Bearer abc.def-ghi_jkl~mno+pqr/stu=", "abc.def-ghi_jkl~mno+pqr/stu"],
    ["token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln end", "eyJzdWIiOiJ4In0"],
    ["open /links/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ now", "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ"],
    ["postgres://mth_app:s3cret-pw@db:5432/mth refused", "s3cret-pw"],
    ["/auth/callback?code=c0de&state=st4te", "c0de"],
  ])("removes the secret from %j", (text, secret) => {
    const out = redactErrorText(text);
    expect(out).not.toContain(secret);
    expect(out.length).toBeGreaterThan(0);
  });

  it("leaves an ordinary message unchanged", () => {
    const text = "connect ECONNREFUSED 127.0.0.1:5432 (job kpi.recalculate)";
    expect(redactErrorText(text)).toBe(text);
  });
});
