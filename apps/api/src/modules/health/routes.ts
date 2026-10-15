// The health-check routes (P5 slice H; ADR-0048 §5-§7, §9; p5-work-split §H.3; T-DG5-KBE-G fills BE-A's stub).
// KBE-G2 appends the assessments' registration lines after these (p5-work-split §H.4).
import type { FastifyInstance } from "fastify";
import type { ModuleDeps } from "../platform/index.ts";
import { registerHealthQuestionRoutes } from "./questions.ts";
import { registerHealthSchemeRoutes } from "./schemes.ts";

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerHealthCheckRoutes(app: FastifyInstance, deps: ModuleDeps): string[] {
  return [...registerHealthQuestionRoutes(app, deps), ...registerHealthSchemeRoutes(app, deps)];
}
