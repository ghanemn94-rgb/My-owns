// P6 slice F (T-DG6-BE-E; ADR-0052 §4): zod mirror of the contract's RateLimitMatrix (docs/api/openapi.yaml
// 1.5.0-p6), the read model of getSecurityRateLimits (Administration > Security). No free-text field: every value is
// read from configuration (class budgets) and the route table; no counters, client IPs or user ids.
import { z } from "zod";

export const RATE_LIMIT_CLASS_NAMES = ["global", "auth", "upload", "search", "assistant", "webhook", "export"] as const;
export const rateLimitClassName = z.enum(RATE_LIMIT_CLASS_NAMES);
export const rateLimitKeyedBy = z.enum(["user_or_ip", "ip", "endpoint_key"]);

export const rateLimitClass = z.strictObject({
  name: rateLimitClassName,
  variable: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  perMinute: z.number().int().min(1),
  keyedBy: rateLimitKeyedBy,
  operationIds: z.array(z.string()),
});
export type RateLimitClass = z.infer<typeof rateLimitClass>;

export const rateLimitMatrix = z.strictObject({ classes: z.array(rateLimitClass) });
export type RateLimitMatrix = z.infer<typeof rateLimitMatrix>;
