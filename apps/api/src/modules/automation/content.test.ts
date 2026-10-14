// Pure parts of the automation rule builder (ADR-0043 §1, §2, §9; REQ-S12-002, REQ-S12-026; T-DG5-BE-H): the refusal
// order of content validation (human-only first), the canonical content hash, the readable en/ar summary, and the
// registry's refusal to register a human decision. The database-backed behaviour is in
// test/integration/automation/automation-rules.test.ts. All data is synthetic.
import { HUMAN_ONLY_ACTION_CODES, type AutomationRuleContentInput } from "@mth/shared/schemas";
import { createTaskActionParameters } from "@mth/shared/schemas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HttpProblem } from "../platform/index.ts";
import type { ActionTypeRow, CatalogueRows, TriggerRow } from "./catalogue.ts";
import {
  automationActionRegistry,
  createAutomationActionRegistry,
  setAutomationActionRegistry,
  type AutomationActionDescriptor,
} from "./registry.ts";
import { automationContentSha256, canonicalAutomationJson, summarize, validateContent } from "./versions.ts";

const trigger = (code: string, fields: string[], user: string | null, selectable = true): TriggerRow => ({
  code,
  trigger_kind: "event",
  owner_module: "workflows",
  label_en: `Label ${code}`,
  label_ar: `تسمية ${code}`,
  condition_fields: fields,
  initiating_user_field: user,
  admin_selectable: selectable,
  source_ref: "M0221",
});
const action = (code: string, cls: "automatic" | "human_only", selectable: boolean): ActionTypeRow => ({
  code,
  action_class: cls,
  owner_module: "tasks",
  label_en: `Do ${code}`,
  label_ar: `تنفيذ ${code}`,
  required_permission_code: null,
  admin_selectable: selectable,
  source_ref: "M0221",
});
const catalogue: CatalogueRows = {
  triggers: new Map([
    ["gate.decided", trigger("gate.decided", ["gateCode", "outcome"], null)],
    ["transformation.created", trigger("transformation.created", ["mode", "entryPhase"], "createdBy")],
    ["gate.submission_requested", trigger("gate.submission_requested", [], null, false)],
  ]),
  actions: new Map([
    ["create_task", action("create_task", "automatic", true)],
    ["starter_handler", action("starter_handler", "automatic", false)],
    ...HUMAN_ONLY_ACTION_CODES.map((c) => [c, action(c, "human_only", false)] as const),
  ]),
};

const stub: AutomationActionDescriptor = {
  code: "create_task",
  ownerModule: "tasks",
  parametersSchema: createTaskActionParameters,
  requiredPermission: null,
  plan: () => Promise.reject(new Error("not used")),
};
let previous = automationActionRegistry();
beforeAll(() => {
  previous = automationActionRegistry();
  const r = createAutomationActionRegistry();
  r.register(stub);
  setAutomationActionRegistry(r);
});
afterAll(() => setAutomationActionRegistry(previous));

const admin = { origin: "admin", code: "test.rule" } as const;
const task = { type: "create_task", parameters: { assigneeRole: "TL", messageKey: "automation.message.follow_up" } };
const ok: AutomationRuleContentInput = { triggerCodes: ["gate.decided"], actions: [task], runAs: "service" };
const codeOf = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (e) {
    if (e instanceof HttpProblem) return e.code;
    throw e;
  }
};

describe("validateContent (ADR-0043 §2, §9)", () => {
  it("accepts a valid admin rule and normalizes the optional members", () => {
    expect(validateContent(admin, ok, catalogue, null)).toEqual({
      triggerCodes: ["gate.decided"],
      conditions: [],
      actions: [task],
      runAs: "service",
      servicePermissionCodes: [],
      parameters: {},
    });
  });

  it("REQ-S12-026: each of the six human-only actions is refused first, even next to other faults", () => {
    for (const code of HUMAN_ONLY_ACTION_CODES) {
      const bad = { ...ok, triggerCodes: ["no.such_trigger"], actions: [task, { type: code }] };
      expect(
        codeOf(() => validateContent(admin, bad, catalogue, null)),
        code,
      ).toBe("automation_rule.human_only_action");
    }
  });

  it("refuses unknown or starter-only triggers and actions, bad conditions and bad settings with the §9 codes", () => {
    const cases: [AutomationRuleContentInput, string][] = [
      [{ ...ok, triggerCodes: ["no.such_trigger"] }, "automation_rule.trigger_unknown"],
      [{ ...ok, triggerCodes: ["gate.submission_requested"] }, "automation_rule.trigger_unknown"],
      [{ ...ok, triggerCodes: ["gate.decided", "gate.decided"] }, "automation_rule.trigger_unknown"],
      [{ ...ok, actions: [{ type: "starter_handler" }] }, "automation_rule.action_unknown"],
      [{ ...ok, actions: [{ type: "launch_rocket" }] }, "automation_rule.action_unknown"],
      [{ ...ok, conditions: [{ field: "mode", op: "eq", value: "x" }] }, "automation_rule.condition_invalid"],
      [{ ...ok, conditions: [{ field: "gateCode", op: "gt", value: "G2" }] }, "automation_rule.condition_invalid"],
      [{ ...ok, conditions: [{ field: "gateCode", op: "present", value: "G2" }] }, "automation_rule.condition_invalid"],
      [{ ...ok, conditions: [{ field: "gateCode", op: "in", value: "G2" }] }, "automation_rule.condition_invalid"],
      [
        { ...ok, actions: [{ type: "create_task", parameters: { assigneeRole: "TL" } }] },
        "automation_rule.action_parameters_invalid",
      ],
      [{ ...ok, actions: [{ ...task, handlers: ["x"] }] }, "automation_rule.action_parameters_invalid"],
      [{ ...ok, parameters: { minimumSlipDays: 2 } }, "automation_rule.action_parameters_invalid"],
      [{ ...ok, runAs: "initiating_user" }, "automation_rule.initiating_user_unavailable"],
      [{ ...ok, servicePermissionCodes: ["approval.decide"] }, "automation_rule.service_permission_forbidden"],
    ];
    for (const [content, code] of cases)
      expect(
        codeOf(() => validateContent(admin, content, catalogue, null)),
        JSON.stringify(content),
      ).toBe(code);
  });

  it("conditions: fields common to every trigger, decimal strings for the numeric operators", () => {
    expect(
      codeOf(() =>
        validateContent(
          admin,
          {
            ...ok,
            conditions: [
              { field: "outcome", op: "gte", value: "1.50" },
              { field: "gateCode", op: "absent" },
            ],
          },
          catalogue,
          null,
        ),
      ),
    ).toBeNull();
    // Initiating user: allowed when every trigger names one.
    expect(
      codeOf(() =>
        validateContent(
          admin,
          { ...ok, triggerCodes: ["transformation.created"], runAs: "initiating_user" },
          catalogue,
          null,
        ),
      ),
    ).toBeNull();
  });

  it("a starter keeps its fixed part (no condition, same triggers and handler); only declared settings change", () => {
    const fixed = {
      triggerCodes: ["dependency.slipped"],
      conditions: [],
      actions: [{ type: "starter_handler", handlers: ["portfolio.dependency_slip"] }],
      runAs: "service" as const,
      servicePermissionCodes: [],
      parameters: { minimumSlipDays: 1 },
    };
    const starter = { origin: "starter", code: "starter.dependency_slip" } as const;
    expect(
      validateContent(starter, { ...fixed, parameters: { minimumSlipDays: 3 } }, catalogue, fixed).parameters,
    ).toEqual({
      minimumSlipDays: 3,
    });
    expect(
      codeOf(() =>
        validateContent(
          starter,
          { ...fixed, conditions: [{ field: "slipDays", op: "gt", value: "2" }] },
          catalogue,
          fixed,
        ),
      ),
    ).toBe("automation_rule.starter_fixed");
    expect(codeOf(() => validateContent(starter, { ...fixed, triggerCodes: ["gate.decided"] }, catalogue, fixed))).toBe(
      "automation_rule.starter_fixed",
    );
    expect(
      codeOf(() => validateContent(starter, { ...fixed, parameters: { minimumSlipDays: 0 } }, catalogue, fixed)),
    ).toBe("automation_rule.action_parameters_invalid");
    expect(
      codeOf(() => validateContent(starter, { ...fixed, actions: [{ type: "approve_gate" }] }, catalogue, fixed)),
    ).toBe("automation_rule.human_only_action");
  });
});

describe("content hash and summary (ADR-0043 §1)", () => {
  it("is the SHA-256 of canonical JSON: key order and optional members do not change it; content does", () => {
    const a = validateContent(admin, ok, catalogue, null);
    const b = validateContent(
      admin,
      { runAs: "service", actions: [task], triggerCodes: ["gate.decided"], conditions: [] },
      catalogue,
      null,
    );
    expect(automationContentSha256(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(automationContentSha256(a)).toBe(automationContentSha256(b));
    expect(automationContentSha256({ ...a, runAs: "initiating_user" })).not.toBe(automationContentSha256(a));
    expect(canonicalAutomationJson({ b: 1, a: [true, null, "x"] })).toBe('{"a":[true,null,"x"],"b":1}');
    expect(() => canonicalAutomationJson({ x: 1.5 })).toThrow(/integers/);
  });

  it("renders a readable summary in English and Arabic from the catalogue labels", () => {
    const c = validateContent(
      admin,
      { ...ok, conditions: [{ field: "gateCode", op: "eq", value: "G2" }] },
      catalogue,
      null,
    );
    expect(summarize(c, catalogue)).toEqual({
      en: "When Label gate.decided, if gateCode is G2: Do create_task (TL). Runs as the service identity.",
      ar: "عند تسمية gate.decided، إذا كان gateCode يساوي G2: تنفيذ create_task (TL). يعمل بصفة هوية الخدمة.",
    });
  });
});

describe("AutomationActionRegistry (ADR-0043 §2)", () => {
  it("never registers a human decision, and replaces a re-registered code", () => {
    const r = createAutomationActionRegistry();
    for (const code of HUMAN_ONLY_ACTION_CODES) expect(() => r.register({ ...stub, code })).toThrow(/human decision/);
    r.register(stub);
    r.register({ ...stub, ownerModule: "tasks2" });
    expect(r.codes()).toEqual(["create_task"]);
    expect(r.get("create_task")?.ownerModule).toBe("tasks2");
  });
});
