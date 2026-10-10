// The schedule network and critical path on the initiative page (T-DG4-FE-D2; p4-work-split §E.5, E.8 item 8;
// ADR-0031 §8-§11; REQ-S09-009 UI half), with stubbed responses in English (LTR) and Arabic (RTL). SYNTHETIC data only.
//  - The ADR-0031 §8 fixture: P = 18, critical path INI-01 → INI-02 → INI-04, INI-03 float 6 and not critical.
//  - INI-03 without a duration: not computable, INI-03 listed, and NO critical styling or label anywhere (E.8 item 8).
//  - The initiative's duration: create (POST, no If-Match); change (PATCH with If-Match); a stale version is a 409:
//    nothing saved, the network re-read, the current value shown, the next save carries the current version; 409
//    initiative_schedule.exists is translated. AUD: read-only.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scheduleNetwork } from "@mth/shared/schemas";
import { createI18n } from "../../i18n/index.ts";
import { problem, route } from "../../test/fixtures.tsx";
import { TRP, esc, json } from "../my-work/p4fixtures.ts";
import { INI_2, NETWORK_COMPUTED, NETWORK_MISSING, renderInitiative } from "./executionFixtures.ts";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const SCHEDULE = new RegExp(`/api/v1/initiatives/${INI_2}/schedule$`);
const NETWORK = new RegExp(`${esc(TRP)}/schedule-network$`);

/** The network with this initiative (INI-02) given `duration` (the rest as in the computed fixture). */
const withOwnDuration = (duration: number | null) => ({
  ...NETWORK_MISSING,
  missingDurations:
    duration === null ? [{ initiativeId: INI_2, code: "INI-02", name: "Synthetic initiative INI-02" }] : [],
  nodes: NETWORK_MISSING.nodes.map((n) =>
    n.initiativeId === INI_2
      ? { ...n, durationWorkingDays: duration }
      : { ...n, durationWorkingDays: n.durationWorkingDays ?? 4 },
  ),
});

async function networkSection(): Promise<HTMLElement> {
  return waitFor(() => {
    const el = document.querySelector<HTMLElement>("#schedule-network [data-network-status]");
    expect(el).toBeTruthy();
    return el!;
  });
}

describe("fixtures follow the contract", () => {
  it("the computed and not-computable networks parse with the shared zod mirror", () => {
    expect(scheduleNetwork.safeParse(NETWORK_COMPUTED).success).toBe(true);
    expect(scheduleNetwork.safeParse(NETWORK_MISSING).success).toBe(true);
  });
});

describe.each(["en", "ar"] as const)("schedule network panel (%s)", (locale) => {
  const t = createI18n(locale).t;

  it("computed (ADR-0031 §8 fixture): P = 18, path INI-01 → INI-02 → INI-04, INI-03 float 6 not critical", async () => {
    renderInitiative(locale, []);
    const section = await networkSection();
    expect(section.getAttribute("data-network-status")).toBe("computed");
    expect(section.querySelector("[data-state='network-computed']")!.textContent).toContain(
      t("executionP4.network.computed", { n: 18 }),
    );
    const paths = section.querySelector("[data-critical-paths='1']")!;
    expect(paths.querySelector("[data-critical-path='INI-01>INI-02>INI-04']")).toBeTruthy();
    const nodes = within(section).getByRole("table", { name: t("executionP4.network.nodesTitle") });
    const row = (code: string) => within(nodes).getByText(code).closest("tr")!;
    expect(row("INI-02").querySelector("[data-critical='true']")!.textContent).toContain(
      t("executionP4.network.critical"),
    );
    expect(row("INI-02").querySelector("[data-this-initiative]")).toBeTruthy();
    const ini3 = row("INI-03");
    expect(ini3.querySelector("[data-critical='false']")!.textContent).toBe(t("executionP4.network.notCritical"));
    expect([...ini3.querySelectorAll("[data-offset]")].map((e) => e.getAttribute("data-offset"))).toEqual([
      "5",
      "9",
      "11",
      "15",
      "6",
    ]);
    const edges = within(section).getByRole("table", { name: t("executionP4.network.edgesTitle") });
    expect(within(edges).getByText("DEP-01").closest("tr")!.querySelector("[data-critical='true']")).toBeTruthy();
    expect(within(edges).getByText("DEP-03").closest("tr")!.querySelector("[data-critical='false']")).toBeTruthy();
  });

  it("not computable (missing duration): the reason and INI-03 listed; no critical styling or label at all", async () => {
    renderInitiative(locale, [], [], { network: NETWORK_MISSING });
    const section = await networkSection();
    expect(section.getAttribute("data-network-status")).toBe("not_computable");
    expect(section.querySelector("[data-reason='missing_durations']")!.textContent).toBe(
      t("executionP4.network.reason.missing_durations"),
    );
    expect(section.querySelector("[data-missing='INI-03']")).toBeTruthy();
    // E.8 item 8: nothing is highlighted: no critical marker, column, path, offset or label in the network.
    expect(section.querySelector("[data-critical]")).toBeNull();
    expect(section.querySelector("[data-critical-paths]")).toBeNull();
    expect(section.querySelector("[data-offset]")).toBeNull();
    expect(section.querySelector(".lifecycle-chip")).toBeNull();
    const headers = [...section.querySelectorAll("th")].map((th) => th.textContent ?? "");
    expect(headers.some((h) => h.includes(t("executionP4.network.col.critical")))).toBe(false);
    expect(headers.some((h) => h.includes(t("executionP4.network.col.float")))).toBe(false);
    // No element is labelled "Critical" (the reason sentence may use the word; a label is a standalone element).
    const label = t("executionP4.network.critical");
    expect([...section.querySelectorAll("span, td, li")].filter((e) => (e.textContent ?? "").trim() === label)).toEqual(
      [],
    );
    const nodes = within(section).getByRole("table", { name: t("executionP4.network.nodesTitle") });
    expect(
      within(nodes).getByText("INI-03").closest("tr")!.querySelector("[data-duration='none'] [data-health='unknown']"),
    ).toBeTruthy();
  });

  it("record a duration: POST without If-Match; 409 initiative_schedule.exists is translated and the next save is a PATCH", async () => {
    let posts = 0;
    const api = renderInitiative(
      locale,
      ["roadmap.edit"],
      [
        route("POST", SCHEDULE, () => {
          posts += 1;
          return problem(409, "initiative_schedule.exists", { type: "urn:mth:problem:duplicate" });
        }),
        route("PATCH", SCHEDULE, () =>
          json({
            id: INI_2,
            initiativeId: INI_2,
            durationWorkingDays: 12,
            note: null,
            version: 2,
            createdAt: "2026-10-01T09:00:00Z",
            createdBy: INI_2,
            updatedAt: "2026-10-01T09:00:00Z",
            updatedBy: INI_2,
          }),
        ),
      ],
      { network: withOwnDuration(null) },
    );
    const section = await networkSection();
    fireEvent.click(within(section).getByRole("button", { name: t("executionP4.network.duration.set") }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(dialog.querySelector("[data-field='durationWorkingDays']")!, { target: { value: "3000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("common.action.save") }));
    await waitFor(() =>
      expect(dialog.querySelector("[data-field='durationWorkingDays']")!.getAttribute("aria-invalid")).toBe("true"),
    );
    expect(posts).toBe(0);
    fireEvent.change(dialog.querySelector("[data-field='durationWorkingDays']")!, { target: { value: "12" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("common.action.save") }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain(t("problems.initiative_schedule__exists"));
    const post = api.requests.find((r) => r.method === "POST")!;
    expect(post.body).toEqual({ durationWorkingDays: 12 });
    expect(post.headers["if-match"]).toBeUndefined();
    fireEvent.click(within(dialog).getByRole("button", { name: t("common.action.save") }));
    await waitFor(() => expect(api.requests.some((r) => r.method === "PATCH")).toBe(true));
    expect(posts).toBe(1);
    expect(api.requests.find((r) => r.method === "PATCH")!.headers["if-match"]).toBe('"1"');
  });

  it("change a duration: a stale version is a 409 (nothing saved), the current value is re-read and shown, the next save sends the current version", async () => {
    let reads = 0;
    let patches = 0;
    const api = renderInitiative(
      locale,
      ["roadmap.edit"],
      [
        route("GET", NETWORK, () => {
          reads += 1;
          return json(withOwnDuration(reads === 1 ? 10 : 14));
        }),
        route("PATCH", SCHEDULE, () => {
          patches += 1;
          return patches === 1
            ? problem(409, "version_conflict", { currentVersion: 4 })
            : json({
                id: INI_2,
                initiativeId: INI_2,
                durationWorkingDays: 12,
                note: null,
                version: 5,
                createdAt: "2026-10-01T09:00:00Z",
                createdBy: INI_2,
                updatedAt: "2026-10-01T09:00:00Z",
                updatedBy: INI_2,
              });
        }),
      ],
    );
    const section = await networkSection();
    expect(section.querySelector("[data-own-duration='10']")).toBeTruthy();
    fireEvent.click(within(section).getByRole("button", { name: t("executionP4.network.duration.change") }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.querySelector("[data-version-baseline='1']")!.textContent).toBe(
      t("executionP4.network.duration.versionUnknown", { version: 1 }),
    );
    fireEvent.change(dialog.querySelector("[data-field='durationWorkingDays']")!, { target: { value: "12" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("common.action.save") }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.getAttribute("data-state")).toBe("conflict");
    expect(api.requests.filter((r) => r.method === "PATCH")[0]!.headers["if-match"]).toBe('"1"');
    // The re-read value is shown in the open dialog before the user saves again.
    await waitFor(() => expect(dialog.querySelector("[data-current-duration='14']")).toBeTruthy());
    expect(dialog.querySelector("[data-version-baseline]")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: t("common.action.save") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const second = api.requests.filter((r) => r.method === "PATCH")[1]!;
    expect(second.headers["if-match"]).toBe('"4"');
    expect(second.body).toEqual({ durationWorkingDays: 12 });
  });

  it("the auditor (no roadmap.edit) sees the network read-only: no duration control", async () => {
    renderInitiative(locale, []);
    const section = await networkSection();
    expect(section.querySelector("[data-action='set-duration'], [data-action='change-duration']")).toBeNull();
    expect(section.querySelector("[data-state='panel-read-only']")!.textContent).toContain(t("executionP4.readOnly"));
  });
});
