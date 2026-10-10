// Shared UI of the slice K screens (T-DG4-FE-G2; ADR-0038): node-type labels, the web path of a chain record (every
// node is clickable: it opens the record's screen, REQ-PB-044), decimal shares shown as percentages (never floats; a
// target with no share is "unallocated 100 %", never 0 %), the orphan "expected step" text, and the sub-navigation
// between Traceability, Modular entry and Workstreams.
import type { TFunction } from "i18next";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router";
import { percentText } from "@mth/shared/schemas";
import { Icon } from "../../components/Icon.tsx";
import { P4FormDialog } from "../my-work/p4ui.tsx";
import type { TraceabilityGraph, TraceNodeType } from "./api.ts";

/** Page namespaces whose `<ns>.problem.<code>` texts are tried before `problems.*`. */
export const NS = ["traceability"] as const;

/** The chain order (B0070): every edge points forward in it. */
export const CHAIN_ORDER: readonly TraceNodeType[] = [
  "diagnostic_finding",
  "tom_gap",
  "initiative",
  "deliverable",
  "capability",
  "outcome",
  "outcome_kpi",
  "benefit",
];

export function nodeTypeText(t: TFunction, type: string): string {
  return t(`traceability.nodeType.${type}`, { defaultValue: type });
}

/**
 * The web screen of a chain record. Records with their own detail route open it; the others open the workspace screen
 * that lists them (the Define, Design and Diagnose registers), so a click never leads to "page not found". A
 * deliverable opens its initiative, found through the graph's `initiative_deliverable` edge when known.
 */
export function recordWebPath(
  type: string,
  id: string,
  tid: string,
  graph?: Pick<TraceabilityGraph, "edges"> | null,
): string {
  const base = `/transformations/${tid}`;
  switch (type) {
    case "diagnostic_finding":
      return `${base}/diagnose`;
    case "tom_gap":
    case "capability":
      return `${base}/design`;
    case "initiative":
      return `${base}/initiatives/${id}`;
    case "deliverable": {
      const parent = graph?.edges.find((e) => e.edgeKind === "initiative_deliverable" && e.toId === id);
      return parent ? `${base}/initiatives/${parent.fromId}` : `${base}/portfolio`;
    }
    case "outcome":
    case "outcome_kpi":
      return `${base}/define`;
    case "benefit":
      return `${base}/benefits/${id}`;
    case "kpi_definition":
      return `${base}/kpis/${id}`;
    default:
      return base;
  }
}

/** The web path of an API href of a missing-link item (its record, else the screen where it is supplied). */
export function apiHrefToWebPath(href: string | null, tid: string): string | null {
  if (!href) return null;
  const path = href.replace(/^\/api\/v1/, "").split("?")[0]!;
  const base = `/transformations/${tid}`;
  const m = /^\/transformations\/[0-9a-f-]{36}\/([a-z-]+)(?:\/([0-9a-f-]{36}))?/.exec(path);
  const ini = /^\/initiatives\/([0-9a-f-]{36})/.exec(path);
  if (ini) return `${base}/initiatives/${ini[1]}`;
  if (!m) return null;
  switch (m[1]) {
    case "benefits":
      return m[2] ? `${base}/benefits/${m[2]}` : `${base}/benefits`;
    case "baselines":
    case "outcomes":
    case "outcome-kpis":
    case "kpi-definitions":
      return `${base}/define`;
    case "gate-dispensations":
      return `${base}/dispensations`;
    case "initiatives":
      return `${base}/portfolio`;
    default:
      return base;
  }
}

/** A decimal fraction as a percentage ("0.600000" → "60%"), exact (string arithmetic), always left-to-right. */
export function Pct({ share }: { share: string }) {
  return (
    <bdi dir="ltr" className="num" data-share={share}>
      {percentText(share)}%
    </bdi>
  );
}

/** An orphan's expected step ("tom_gap → initiative"), each node type translated. */
export function expectedText(t: TFunction, expected: string): string {
  const parts = expected.split(/\s*→\s*/);
  if (parts.length !== 2) return expected;
  return t("traceability.orphans.expectedStep", {
    from: nodeTypeText(t, parts[0]!),
    to: nodeTypeText(t, parts[1]!),
  });
}

/** A record's code and label; a record without a label reads "No label", never blank. */
export function RecordName({ code, label }: { code: string | null; label: string | null }) {
  const { t } = useTranslation();
  return (
    <>
      {code ? (
        <bdi dir="ltr" className="code">
          {code}
        </bdi>
      ) : null}
      {code ? " " : null}
      {label ?? <span className="muted">{t("traceability.noLabel")}</span>}
    </>
  );
}

/** Text + icon status (never colour alone). */
export function StatusTag({
  tone,
  wrap = false,
  children,
}: {
  tone: "ok" | "warn" | "block" | "info";
  /** Long labels (e.g. the inherited label) wrap inside their cell; short ones never break mid-word. */
  wrap?: boolean;
  children: ReactNode;
}) {
  const icon = tone === "ok" ? "check" : tone === "block" ? "cross" : tone === "warn" ? "alert" : "info";
  const css = tone === "ok" ? "on-track" : tone === "block" ? "off-track" : tone === "warn" ? "at-risk" : "unknown";
  return (
    <span className={`status-chip${wrap ? " status-chip--wrap" : ""} status-chip--${css}`} data-tone={tone}>
      <Icon name={icon} /> <span>{children}</span>
    </span>
  );
}

/** The sub-navigation of the slice K workspace screens. */
export function TraceSubNav({ tid }: { tid: string }) {
  const { t } = useTranslation();
  const items = [
    { to: `/transformations/${tid}/traceability`, label: t("traceability.tab") },
    { to: `/transformations/${tid}/modular-entry`, label: t("traceability.modular.tab") },
    { to: `/transformations/${tid}/workstreams`, label: t("traceability.workstreams.tab") },
  ];
  return (
    <nav className="section-nav" aria-label={t("traceability.subnav")}>
      <ul className="section-nav__list">
        {items.map((i) => (
          <li key={i.to}>
            <NavLink end className="link" to={i.to}>
              {i.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * A reasoned action (remove a link, withdraw an inherited record, remove a membership): one reason field (the shared
 * `reason` rule, 3–1000 characters), `If-Match` from the record version the user saw, one form-level alert.
 */
export function ReasonAction({
  title,
  description,
  url,
  version,
  submitLabel,
  onDone,
  onClose,
}: {
  title: string;
  description: string;
  url: string;
  version: number;
  submitLabel: string;
  onDone: (result: unknown) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <P4FormDialog
      title={title}
      description={description}
      fields={[
        { name: "reason", label: t("traceability.reason"), kind: "textarea", required: true, min: 3, max: 1000 },
      ]}
      submitLabel={submitLabel}
      danger
      method="POST"
      url={url}
      version={version}
      namespaces={NS}
      toBody={(v) => ({ reason: v["reason"] })}
      onDone={onDone}
      onClose={onClose}
    />
  );
}
