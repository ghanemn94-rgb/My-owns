// The demo labels (T-DG5-FE-G; ADR-0050 §2; REQ-S18-001, REQ-PB-089, REQ-S21-001, M0339, M0412).
// The synthetic flag is the environment (GET /environment): in a demo database every record and number is an
// illustrative example and every approval approves nothing real. Three render-time labels, in en and ar:
//  (a) `DemoBanner`: a persistent banner on every screen of the shell while `synthetic`;
//  (b) `DemoRecordBadge`: "Illustrative example — synthetic" in record views and form headers;
//  (c) `SyntheticApprovalLabel`: "Synthetic demonstration - approves nothing real" on every product-gate decision,
//      approval and Finance validation.
// Fail-safe (ADR-0050 §1): an unknown environment (not loaded, failed, or no marker) is never labelled synthetic, so a
// label never appears on data that might be real; the server's own `synthetic` flag is the only source.
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.ts";
import { shouldRetry } from "../../api/queries.ts";
import { SHELL_READ } from "../../app/shell-read.ts";
import { Icon } from "../Icon.tsx";

export interface EnvironmentInfo {
  readonly kind: "production" | "demo";
  readonly synthetic: boolean;
  readonly datasetCode: string | null;
  readonly datasetVersion: string | null;
  readonly syntheticClockAt: string | null;
}

export const environmentPath = "/api/v1/environment"; // getEnvironment
export const environmentKey = ["p5", "feg", "environment"] as const;

export function useEnvironment() {
  return useQuery({
    queryKey: environmentKey,
    ...SHELL_READ,
    queryFn: () => api.get<EnvironmentInfo>(environmentPath),
    retry: shouldRetry,
  });
}

/** True only when the server says this database is a demo database. */
export function useSynthetic(): boolean {
  const env = useEnvironment();
  return env.data?.synthetic === true;
}

/** (a) The persistent banner of the shell (role note, icon and words; never colour alone). */
export function DemoBanner() {
  const { t } = useTranslation();
  if (!useSynthetic()) return null;
  return (
    <p className="banner banner--warning demo-banner" role="note" data-state="demo-synthetic">
      <Icon name="info" /> <strong>{t("playbookP5.demo.banner")}</strong>
    </p>
  );
}

/** (b) The record badge of record views and form headers. */
export function DemoRecordBadge() {
  const { t } = useTranslation();
  if (!useSynthetic()) return null;
  return (
    <span className="badge badge--provisional" data-state="demo-record">
      {t("playbookP5.demo.recordBadge")}
    </span>
  );
}

/** (c) The label of a product-gate decision, an approval or a Finance validation in a demo database. */
export function SyntheticApprovalLabel() {
  const { t } = useTranslation();
  if (!useSynthetic()) return null;
  return (
    <p className="banner banner--warning" role="note" data-state="synthetic-approval">
      <Icon name="alert" /> {t("playbookP5.demo.approvalLabel")}
    </p>
  );
}

/**
 * The B0144 sentence on a transformation's overview in a demo database (ADR-0050 §2): "Illustrative example only.
 * Replace assumptions with validated company data." (verbatim in English; Arabic provisional).
 */
export function IllustrativeExampleNote() {
  const { t } = useTranslation();
  if (!useSynthetic()) return null;
  return (
    <p className="banner banner--warning" role="note" data-state="illustrative-example">
      <Icon name="info" /> {t("playbookP5.demo.illustrative")}
    </p>
  );
}
