import { z } from "zod";
import { PROBLEM_TYPES } from "../problem.ts";

export const fieldError = z.strictObject({ pointer: z.string(), code: z.string(), message: z.string() });
export const problem = z.object({
  type: z.enum(Object.values(PROBLEM_TYPES) as [string, ...string[]]),
  title: z.string(),
  status: z.number().int().min(400).max(599),
  detail: z.string().optional(),
  instance: z.string().optional(),
  code: z.string().regex(/^[a-z][a-z0-9_.]*$/),
  requestId: z.string(),
  errors: z.array(fieldError).optional(),
  currentVersion: z.number().int().min(1).optional(),
});
