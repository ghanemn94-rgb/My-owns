// T-DG5-FE-D5 (D-167; QA-E2 D-QA-E2-1; REQ-S18-001; ADR-0050 §2 b): "every record view AND FORM HEADER shows the badge
// 'Illustrative example — synthetic' / 'مثال توضيحي — اصطناعي'". The shared headers carry it while the server says the
// database is synthetic (GET /environment), in en and ar:
//  - the shared dialog header (`Dialog`), so every create or edit dialog: `RecordDialog`, `P4FormDialog`,
//    `StudioFormDialog`, `ReasonDialog` and the page-specific dialogs built on `Dialog`;
//  - a form page's or a record view's `PageHeader demoBadge` (the edit and create pages), inside the h1's own block.
// In a production database, an unknown environment (failed read) or outside the query provider: nothing (ADR-0050 §1,
// never a label on data that might be real). A list page's header (no `demoBadge`) never carries it. SYNTHETIC data.
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setCsrfToken } from "../../api/client.ts";
import { AppProviders, createQueryClient } from "../../app/App.tsx";
import { createI18n } from "../../i18n/index.ts";
import { P4FormDialog } from "../../pages/my-work/p4ui.tsx";
import { StudioFormDialog } from "../../pages/studio/StudioFormDialog.tsx";
import { mockApi, route } from "../../test/fixtures.tsx";
import { Dialog } from "../Form.tsx";
import { PageHeader } from "../Page.tsx";
import { ReasonDialog } from "../ReasonDialog.tsx";
import { RecordDialog } from "../RecordForm.tsx";

const LOCALES = ["en", "ar"] as const;
type Locale = (typeof LOCALES)[number];
const BADGE: Record<Locale, string> = { en: "Illustrative example — synthetic", ar: "مثال توضيحي — اصطناعي" };

const environment = (kind: "demo" | "production") => ({
  kind,
  synthetic: kind === "demo",
  datasetCode: kind === "demo" ? "roaming" : null,
  datasetVersion: kind === "demo" ? "1" : null,
  syntheticClockAt: null,
});

beforeEach(() => {
  localStorage.clear();
  setCsrfToken(null);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The environment the server answers: a demo database, a production one, or a failed read (unknown). */
function serve(env: "demo" | "production" | "unknown") {
  return mockApi(
    route("GET", /\/api\/v1\/environment$/, () =>
      env === "unknown" ? { status: 503, body: { code: "unavailable" } } : { status: 200, body: environment(env) },
    ),
  );
}

function renderIn(locale: Locale, ui: ReactNode) {
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  return render(
    <AppProviders i18n={createI18n(locale)} queryClient={createQueryClient()}>
      {ui}
    </AppProviders>,
  );
}

const noop = () => undefined;
const done = async () => true;
const HEADERS: Record<string, ReactNode> = {
  "the shared Dialog": (
    <Dialog title="Synthetic dialog" onClose={noop}>
      <p>Synthetic body</p>
    </Dialog>
  ),
  "RecordDialog (a create dialog, e.g. Diagnose › Add baseline)": (
    <RecordDialog
      title="Add baseline (synthetic)"
      fields={[{ name: "name", kind: "text", label: "Name (synthetic)" }]}
      record={null}
      createUrl="/api/v1/synthetic-records"
      submitLabel="Create"
      onSaved={noop}
      onCancel={noop}
    />
  ),
  "P4FormDialog (an edit dialog)": (
    <P4FormDialog
      title="Edit (synthetic)"
      fields={[{ name: "name", kind: "text", label: "Name (synthetic)" }]}
      submitLabel="Save"
      method="PATCH"
      url="/api/v1/synthetic-records/1"
      version={1}
      toBody={(v) => ({ ...v })}
      onDone={done}
      onClose={noop}
    />
  ),
  StudioFormDialog: (
    <StudioFormDialog
      title="Studio (synthetic)"
      fields={[{ name: "name", kind: "text", label: "Name (synthetic)" }]}
      submitLabel="Save"
      url="/api/v1/synthetic-records"
      toBody={(v) => ({ ...v })}
      onDone={done}
      onClose={noop}
    />
  ),
  ReasonDialog: (
    <ReasonDialog
      title="Reason (synthetic)"
      description="Synthetic"
      confirmLabel="Confirm"
      onClose={noop}
      onConfirm={async () => undefined}
    />
  ),
};

describe.each(LOCALES)("the demo record badge in form and dialog headers (%s)", (locale) => {
  describe.each(Object.keys(HEADERS))("%s", (name) => {
    it("demo database: the dialog header carries the badge, next to the dialog's title", async () => {
      serve("demo");
      renderIn(locale, HEADERS[name]);
      const dialog = screen.getByRole("dialog");
      await waitFor(() => expect(dialog.querySelector("[data-state='demo-record']")).not.toBeNull());
      const badge = dialog.querySelector<HTMLElement>("[data-state='demo-record']")!;
      expect(badge.textContent).toBe(BADGE[locale]);
      // In the header, beside the h2 that names the dialog (not in the body or the footer).
      expect(badge.parentElement?.classList.contains("dialog__header")).toBe(true);
      expect(badge.parentElement?.querySelector("h2")?.id).toBe(dialog.getAttribute("aria-labelledby"));
      // The dialog's accessible name stays its title (the badge is not part of the name).
      expect(screen.getByRole("dialog", { name: dialog.querySelector("h2")!.textContent! })).toBe(dialog);
    });

    it.each(["production", "unknown"] as const)("%s database: no badge", async (env) => {
      const { fetchMock } = serve(env);
      renderIn(locale, HEADERS[name]);
      await waitFor(() =>
        expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith("/api/v1/environment"))).toBe(true),
      );
      // Let the answer settle, then nothing is labelled.
      await new Promise((r) => setTimeout(r, 20));
      expect(document.querySelector("[data-state='demo-record']")).toBeNull();
    });
  });

  it("outside the query provider (an isolated dialog): no badge and no crash", () => {
    render(
      <I18nextProvider i18n={createI18n(locale)}>
        <Dialog title="Synthetic dialog" onClose={noop}>
          <p>Synthetic body</p>
        </Dialog>
      </I18nextProvider>,
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(document.querySelector("[data-state='demo-record']")).toBeNull();
  });

  it("demo database: a form page's PageHeader demoBadge carries the badge inside the h1's own block", async () => {
    serve("demo");
    renderIn(locale, <PageHeader demoBadge title="Edit transformation (synthetic)" subtitle="Synthetic" />);
    const h1 = screen.getByRole("heading", { level: 1 });
    await waitFor(() => expect(h1.parentElement?.querySelector("[data-state='demo-record']")).not.toBeNull());
    expect(h1.parentElement!.querySelector("[data-state='demo-record']")!.textContent).toBe(BADGE[locale]);
    // The heading's own text is unchanged.
    expect(h1.textContent).toBe("Edit transformation (synthetic)");
  });

  it.each(["production", "unknown"] as const)("%s database: PageHeader demoBadge renders no badge", async (env) => {
    const { fetchMock } = serve(env);
    renderIn(locale, <PageHeader demoBadge title="Edit transformation (synthetic)" />);
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith("/api/v1/environment"))).toBe(true),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(document.querySelector("[data-state='demo-record']")).toBeNull();
  });

  it("demo database: a list page's PageHeader (no demoBadge) carries no badge and reads nothing", async () => {
    const { fetchMock } = serve("demo");
    renderIn(locale, <PageHeader title="Transformations (synthetic)" />);
    await new Promise((r) => setTimeout(r, 20));
    expect(document.querySelector("[data-state='demo-record']")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
