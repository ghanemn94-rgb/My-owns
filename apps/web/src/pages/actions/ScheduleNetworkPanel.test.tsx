// The schedule network and critical path on the initiative page (T-DG4-FE-D2; p4-work-split §E.5, E.8 item 8;
// ADR-0031 §8-§11; REQ-S09-009 UI half), with stubbed responses in English (LTR) and Arabic (RTL). SYNTHETIC data only.
//  - The ADR-0031 §8 fixture: P = 18, critical path INI-01 → INI-02 → INI-04, INI-03 float 6 and not critical.
//  - INI-03 without a duration: not computable, INI-03 listed, and NO critical styling or label anywhere (E.8 item 8).
//  - The initiative's duration (T-DG4-FE-R3; ADR-0031 amendment S1): the dialog reads getInitiativeSchedule; 404 →
//    create (POST, no If-Match); 200 → change (PATCH, If-Match = the read's ETag), also for a row with a null duration;
//    a stale version is a 409: nothing saved, the row and network re-read, the current value shown, the user's input
//    kept, the next save carries the re-read ETag; 409 initiative_schedule.exists is translated; a failed read offers a
//    retry and blocks saving. AUD: read-only.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initiativeSchedule, scheduleNetwork } from "@mth/shared/schemas";
import { createI18n } from "../../i18n/index.ts";
import { problem, route } from "../../test/fixtures.tsx";
import { json } from "../my-work/p4fixtures.ts";
import { INI_2, NETWORK_COMPUTED, NETWORK_MISSING, renderInitiative } from "./executionFixtures.ts";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const SCHEDULE = new RegExp(`/api/v1/initiatives/${INI_2}/schedule$`);

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

/** An InitiativeSchedule (the getInitiativeSchedule / PATCH answer) of INI-02. */
const scheduleRow = (durationWorkingDays: number | null, version: number, note: string | null = null) => ({
  id: INI_2,
  initiativeId: INI_2,
  durationWorkingDays,
  note,
  version,
  createdAt: "2026-10-01T09:00:00Z",
  createdBy: INI_2,
  updatedAt: "2026-10-01T09:00:00Z",
  updatedBy: INI_2,
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
  it("the schedule rows parse with the InitiativeSchedule mirror", () => {
    expect(initiativeSchedule.safeParse(scheduleRow(9, 1)).success).toBe(true);
    expect(initiativeSchedule.safeParse(scheduleRow(null, 3, "Synthetic note")).success).toBe(true);
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

  it("record a duration: getInitiativeSchedule 404 → POST without If-Match; 409 initiative_schedule.exists re-reads the row and the next save is a PATCH with its ETag", async () => {
    let posts = 0;
    let recorded = false;
    const api = renderInitiative(
      locale,
      ["roadmap.edit"],
      [
        // 404 until someone else records the row (the 409 below); then 200 with ETag "1".
        (req) =>
          req.method === "GET" && SCHEDULE.test(req.url)
            ? recorded
              ? { status: 200, body: scheduleRow(9, 1), headers: { ETag: '"1"' } }
              : problem(404, "not_found")
            : undefined,
        route("POST", SCHEDULE, () => {
          posts += 1;
          recorded = true;
          return problem(409, "initiative_schedule.exists", { type: "urn:mth:problem:duplicate" });
        }),
        route("PATCH", SCHEDULE, () => json(scheduleRow(12, 2))),
      ],
      { network: withOwnDuration(null) },
    );
    const section = await networkSection();
    fireEvent.click(within(section).getByRole("button", { name: t("executionP4.network.duration.set") }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog.querySelector("[data-schedule-exists='false']")).toBeTruthy());
    expect(within(dialog).getByRole("heading", { name: t("executionP4.network.duration.setTitle") })).toBeTruthy();
    expect(api.requests.filter((r) => r.method === "GET" && SCHEDULE.test(r.url))).toHaveLength(1);
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
    // The row was re-read: its current value and version are shown; the typed value is kept; nothing else was sent.
    await waitFor(() =>
      expect(dialog.querySelector("[data-current-duration='9'][data-schedule-version='1']")).toBeTruthy(),
    );
    expect((dialog.querySelector("[data-field='durationWorkingDays']") as HTMLInputElement).value).toBe("12");
    expect(api.requests.some((r) => r.method === "PATCH")).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: t("common.action.save") }));
    await waitFor(() => expect(api.requests.some((r) => r.method === "PATCH")).toBe(true));
    expect(posts).toBe(1);
    expect(api.requests.find((r) => r.method === "PATCH")!.headers["if-match"]).toBe('"1"');
  });

  it("change a duration: If-Match is the getInitiativeSchedule ETag; a stale version is a 409 (nothing saved), the row is re-read and shown, the next save sends the re-read ETag", async () => {
    let reads = 0;
    let patches = 0;
    const api = renderInitiative(
      locale,
      ["roadmap.edit"],
      [
        (req) => {
          if (req.method !== "GET" || !SCHEDULE.test(req.url)) return undefined;
          reads += 1;
          return reads === 1
            ? { status: 200, body: scheduleRow(10, 7, "Synthetic note"), headers: { ETag: '"7"' } }
            : { status: 200, body: scheduleRow(14, 8, "Synthetic note"), headers: { ETag: '"8"' } };
        },
        route("PATCH", SCHEDULE, () => {
          patches += 1;
          return patches === 1 ? problem(409, "version_conflict", { currentVersion: 8 }) : json(scheduleRow(12, 9));
        }),
      ],
      { network: withOwnDuration(10) },
    );
    const section = await networkSection();
    expect(section.querySelector("[data-own-duration='10']")).toBeTruthy();
    fireEvent.click(within(section).getByRole("button", { name: t("executionP4.network.duration.change") }));
    const dialog = await screen.findByRole("dialog");
    // The form is filled from the read (duration and note), never from a guessed version.
    await waitFor(() =>
      expect(dialog.querySelector("[data-current-duration='10'][data-schedule-version='7']")).toBeTruthy(),
    );
    expect(within(dialog).getByRole("heading", { name: t("executionP4.network.duration.changeTitle") })).toBeTruthy();
    expect((dialog.querySelector("[data-field='durationWorkingDays']") as HTMLInputElement).value).toBe("10");
    expect((dialog.querySelector("[data-field='note']") as HTMLTextAreaElement).value).toBe("Synthetic note");
    fireEvent.change(dialog.querySelector("[data-field='durationWorkingDays']")!, { target: { value: "12" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("common.action.save") }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.getAttribute("data-state")).toBe("conflict");
    const first = api.requests.filter((r) => r.method === "PATCH")[0]!;
    expect(first.headers["if-match"]).toBe('"7"');
    expect(first.body).toEqual({ durationWorkingDays: 12 });
    // The re-read value is shown in the open dialog; the typed value stays; no second PATCH is sent by itself.
    await waitFor(() =>
      expect(dialog.querySelector("[data-current-duration='14'][data-schedule-version='8']")).toBeTruthy(),
    );
    expect((dialog.querySelector("[data-field='durationWorkingDays']") as HTMLInputElement).value).toBe("12");
    expect(patches).toBe(1);
    fireEvent.click(within(dialog).getByRole("button", { name: t("common.action.save") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const second = api.requests.filter((r) => r.method === "PATCH")[1]!;
    expect(second.headers["if-match"]).toBe('"8"');
    expect(second.body).toEqual({ durationWorkingDays: 12 });
  });

  it("a recorded row with a null duration is a change (PATCH), and an emptied note is sent as null", async () => {
    const api = renderInitiative(
      locale,
      ["roadmap.edit"],
      [
        (req) =>
          req.method === "GET" && SCHEDULE.test(req.url)
            ? { status: 200, body: scheduleRow(null, 3, "Synthetic note"), headers: { ETag: '"3"' } }
            : undefined,
        route("PATCH", SCHEDULE, () => json(scheduleRow(5, 4))),
      ],
      { network: withOwnDuration(null) },
    );
    const section = await networkSection();
    fireEvent.click(within(section).getByRole("button", { name: t("executionP4.network.duration.set") }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog.querySelector("[data-schedule-exists='true']")).toBeTruthy());
    expect(dialog.querySelector("[data-current-duration='none']")!.textContent).toBe(
      t("executionP4.network.duration.none"),
    );
    fireEvent.change(dialog.querySelector("[data-field='durationWorkingDays']")!, { target: { value: "5" } });
    fireEvent.change(dialog.querySelector("[data-field='note']")!, { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("common.action.save") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.requests.some((r) => r.method === "POST")).toBe(false);
    const patch = api.requests.find((r) => r.method === "PATCH")!;
    expect(patch.headers["if-match"]).toBe('"3"');
    expect(patch.body).toEqual({ durationWorkingDays: 5, note: null });
  });

  it("a failed read shows its error and a retry; nothing can be saved until the row is read", async () => {
    let reads = 0;
    const api = renderInitiative(
      locale,
      ["roadmap.edit"],
      [
        (req) => {
          if (req.method !== "GET" || !SCHEDULE.test(req.url)) return undefined;
          reads += 1;
          return reads === 1
            ? problem(500, "internal")
            : { status: 200, body: scheduleRow(6, 2), headers: { ETag: '"2"' } };
        },
      ],
      { network: withOwnDuration(6) },
    );
    const section = await networkSection();
    fireEvent.click(within(section).getByRole("button", { name: t("executionP4.network.duration.change") }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog.querySelector("[data-state='schedule-read-error'] [role='alert']")).toBeTruthy());
    const save = within(dialog).getByRole("button", { name: t("common.action.save") });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole("button", { name: t("common.action.retry") }));
    await waitFor(() => expect(dialog.querySelector("[data-schedule-version='2']")).toBeTruthy());
    expect((save as HTMLButtonElement).disabled).toBe(false);
    expect(api.requests.some((r) => r.method === "PATCH" || r.method === "POST")).toBe(false);
  });

  it("the auditor (no roadmap.edit) sees the network read-only: no duration control", async () => {
    renderInitiative(locale, []);
    const section = await networkSection();
    expect(section.querySelector("[data-action='set-duration'], [data-action='change-duration']")).toBeNull();
    expect(section.querySelector("[data-state='panel-read-only']")!.textContent).toContain(t("executionP4.readOnly"));
  });
});
