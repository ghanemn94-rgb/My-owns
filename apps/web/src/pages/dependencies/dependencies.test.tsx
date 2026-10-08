// Dependency Map (T08) screen, stubbed API, English LTR and Arabic RTL (T-DG3-FE-B; REQ-PB-051, REQ-PB-052,
// REQ-S09-008). SYNTHETIC data.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ORG_ID, problem, route } from "../../test/fixtures.tsx";
import {
  AUDITOR_GRANTS,
  INI,
  TR,
  esc,
  grants,
  dependency,
  page,
  roadmapView,
  renderWorkspace,
  initiative,
} from "../prioritization/fe-b.fixtures.tsx";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const TYPES = [
  ["decision", "Decision", "قرار", true],
  ["tech", "Tech", "تقنية", true],
  ["data", "Data", "بيانات", true],
  ["vendor", "Vendor", "مورّد", true],
  ["other", "Other", "أخرى", true],
  ["regulatory", "Regulatory", "تنظيمي", false],
].map(([code, en, ar, sys], i) => ({
  id: `01920000-0000-7000-9900-00000000000${i}`,
  code,
  labelEn: en,
  labelAr: ar,
  isSystem: sys,
  sourceRef: sys ? "B0081" : null,
  ordinal: i + 1,
  status: "active",
  version: 1,
}));

const TEXT = {
  en: {
    cols: ["Dependency", "From", "To", "Type", "Needed by", "Owner", "Status / mitigation"],
    external: "External: Telecom regulator",
    neededBy: "Needed-by conflict: the predecessor finishes after the date it is needed",
    add: "Add dependency",
    save: "Save dependency",
    cyclePrefix: "Dependency cycle: ",
    undeletable: "System type: cannot be deleted",
    retireCustom: "Retire regulatory",
    data: "Data",
  },
  ar: {
    cols: ["الاعتمادية", "من", "إلى", "النوع", "مطلوبة بحلول", "المسؤول", "الحالة / المعالجة"],
    external: "جهة خارجية: Telecom regulator",
    neededBy: "تعارض مع موعد الحاجة: ينتهي السابق بعد التاريخ المطلوب",
    add: "إضافة اعتمادية",
    save: "حفظ الاعتمادية",
    cyclePrefix: "حلقة اعتماديات: ",
    undeletable: "نوع نظامي: لا يمكن حذفه",
    retireCustom: "إيقاف regulatory",
    data: "بيانات",
  },
} as const;

const view = () => roadmapView({ initiatives: [initiative(1), initiative(2), initiative(3)] });

function handlers(
  rows = [
    dependency(),
    dependency({
      id: "01920000-0000-7000-f000-000000000002",
      code: "DEP-02",
      fromKind: "external",
      fromInitiativeId: null,
      fromLabel: "Telecom regulator",
      flags: [],
    }),
  ],
) {
  return [
    route("GET", /\/api\/v1\/dependencies\?/, () => page(rows)),
    route("GET", /\/api\/v1\/dependency-types$/, () => ({ status: 200, body: { items: TYPES } })),
    route("GET", new RegExp(`${esc(TR)}/roadmap$`), () => ({ status: 200, body: view() })),
  ];
}

const ADMIN = [
  ...grants(["dependency.edit"]),
  {
    scope: { type: "organization" as const, id: ORG_ID },
    inheritsDownward: true,
    permissions: ["dependency_type.configure" as never],
  },
];

describe.each(["en", "ar"] as const)("dependencies (%s)", (locale) => {
  const tx = TEXT[locale];

  it("shows the seven T08 columns, an External source, the type label and the needed-by conflict flag", async () => {
    renderWorkspace("dependencies", locale, grants(["dependency.edit"]), handlers());
    const table = await screen.findByTestId("t08");
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((h) => h.textContent);
    expect(headers.slice(0, 7)).toEqual(tx.cols);
    expect(table.textContent).toContain(tx.external);
    expect(table.textContent).toContain(tx.neededBy);
    await waitFor(() => expect(within(table).getAllByRole("row")[1]!.textContent).toContain(tx.data));
  });

  it("a cycle is refused and shown as the translated message with the path INI-01 → INI-02 → INI-03 → INI-01", async () => {
    const { api } = renderWorkspace("dependencies", locale, grants(["dependency.edit"]), [
      ...handlers(),
      route("POST", /\/api\/v1\/dependencies$/, () =>
        problem(422, "dependency.cycle", {
          detail: "Dependency cycle: INI-01 → INI-02 → INI-03 → INI-01",
          errors: [{ pointer: "/toInitiativeId", code: "dependency.cycle", message: "x" }],
          cycle: [1, 2, 3, 1].map((n) => ({
            initiativeId: INI(n),
            code: `INI-0${n}`,
            name: `Synthetic initiative ${n}`,
          })),
        }),
      ),
    ]);
    fireEvent.click(await screen.findByRole("button", { name: tx.add }));
    const dialog = await screen.findByRole("dialog");
    const [desc] = within(dialog).getAllByRole("textbox");
    fireEvent.change(desc!, { target: { value: "INI-03 needs INI-01" } });
    const selects = within(dialog).getAllByRole("combobox");
    fireEvent.change(selects[0]!, { target: { value: INI(3) } });
    fireEvent.change(selects[1]!, { target: { value: INI(1) } });
    await waitFor(() => expect(within(selects[2]!).getAllByRole("option").length).toBeGreaterThan(1));
    fireEvent.change(selects[2]!, { target: { value: "data" } });
    fireEvent.click(within(dialog).getByRole("button", { name: tx.save }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain(tx.cyclePrefix);
    expect(alert.textContent).toContain("INI-01 → INI-02 → INI-03 → INI-01");
    // The English server detail is never shown to an Arabic user.
    if (locale === "ar") expect(alert.textContent).not.toContain("Dependency cycle");
    expect(within(dialog).getAllByRole("alert")).toHaveLength(1);
    expect(selects[1]!.getAttribute("aria-invalid")).toBe("true");
    const post = api.requests.find((r) => r.method === "POST")!;
    expect(post.body).toMatchObject({
      from: { kind: "initiative", initiativeId: INI(3) },
      toInitiativeId: INI(1),
      dependencyType: "data",
    });
  });

  it("an External source is sent as {kind: external, label}", async () => {
    const { api } = renderWorkspace("dependencies", locale, grants(["dependency.edit"]), [
      ...handlers(),
      route("POST", /\/api\/v1\/dependencies$/, () => ({ status: 201, body: dependency() })),
    ]);
    fireEvent.click(await screen.findByRole("button", { name: tx.add }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getAllByRole("textbox")[0]!, { target: { value: "Spectrum licence" } });
    fireEvent.click(within(dialog).getAllByRole("radio")[1]!);
    fireEvent.change(within(dialog).getAllByRole("textbox")[1]!, { target: { value: "Telecom regulator" } });
    const selects = within(dialog).getAllByRole("combobox");
    fireEvent.change(selects[0]!, { target: { value: INI(2) } });
    await waitFor(() => expect(within(selects[1]!).getAllByRole("option").length).toBeGreaterThan(1));
    fireEvent.change(selects[1]!, { target: { value: "regulatory" } });
    fireEvent.click(within(dialog).getByRole("button", { name: tx.save }));
    await waitFor(() => expect(api.requests.some((r) => r.method === "POST")).toBe(true));
    expect(api.requests.find((r) => r.method === "POST")!.body).toMatchObject({
      from: { kind: "external", label: "Telecom regulator" },
      toInitiativeId: INI(2),
      dependencyType: "regulatory",
    });
  });

  it("dependency types: system types are undeletable; an administrator may retire a custom type", async () => {
    const { api } = renderWorkspace("dependencies", locale, ADMIN, [
      ...handlers(),
      route("DELETE", /\/api\/v1\/dependency-types\/regulatory$/, () => ({
        status: 200,
        body: { ...TYPES[5], status: "retired" },
      })),
    ]);
    const types = await screen.findByTestId("dependency-types");
    for (const code of ["decision", "tech", "data", "vendor", "other"]) {
      const row = types.querySelector(`[data-type='${code}']`)!;
      expect(row.textContent).toContain(tx.undeletable);
      expect(within(row as HTMLElement).queryByRole("button", { name: new RegExp(`${code}$`) })).not.toBeNull(); // relabel only
      expect(within(row as HTMLElement).getAllByRole("button")).toHaveLength(1);
    }
    fireEvent.click(screen.getByRole("button", { name: tx.retireCustom }));
    await waitFor(() => expect(api.requests.some((r) => r.method === "DELETE")).toBe(true));
    expect(api.requests.find((r) => r.method === "DELETE")!.headers["if-match"]).toBe('"1"');
  });

  it("a system type's 422 dependency_type.system_undeletable is translated", async () => {
    renderWorkspace("dependencies", locale, ADMIN, [
      route("GET", /\/api\/v1\/dependency-types$/, () => ({
        status: 200,
        body: { items: [{ ...TYPES[5], isSystem: false }] },
      })),
      ...handlers(),
      route("DELETE", /\/api\/v1\/dependency-types\//, () => problem(422, "dependency_type.system_undeletable")),
    ]);
    fireEvent.click(await screen.findByRole("button", { name: tx.retireCustom }));
    expect(
      await screen.findByText(
        locale === "en"
          ? "A system dependency type cannot be deleted or retired."
          : "لا يمكن حذف نوع اعتمادية نظامي أو إيقافه.",
      ),
    ).toBeTruthy();
  });

  it("the read-only auditor sees the map and no write control", async () => {
    renderWorkspace("dependencies", locale, AUDITOR_GRANTS, handlers());
    await screen.findByTestId("t08");
    expect(document.querySelector("[data-state='read-only']")).not.toBeNull();
    expect(screen.queryByRole("button", { name: tx.add })).toBeNull();
    expect(screen.queryByRole("button", { name: tx.retireCustom })).toBeNull();
  });
});
