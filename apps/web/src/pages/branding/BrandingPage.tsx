// Administration > Branding (T-DG5-FE-G; REQ-S15-004, REQ-S01-002; ADR-0049 §8, §11; M0301). The Branding Settings
// screen: product name (en, ar), primary and secondary colours with the admin's own approval reference, the bundled
// fonts, the logo (PNG only) or the provisional text wordmark, and the report header and footer in both languages.
// Saving publishes a new immutable branding version at once (If-Match = the head version, "0" for the first save);
// every screen and every newly generated report or export reads it at render time, issued outputs never change.
// Rules shown on screen:
//  - an approval reference records the brand approval the admin holds; the platform approves nothing, and colours stay
//    "provisional" without one (#0078FF is provisional, not a verified Mobily colour);
//  - the action shade for buttons and links is derived from the primary colour by the server (ADR-0009 §3), and the
//    screen shows the contrast of white navigation text on the secondary colour, in words, before saving;
//  - the server's refusals are shown by their code (branding.colour_invalid, .logo_invalid, .font_unavailable,
//    .text_pair_required, .prohibited_claim, .engineering_gate_reference); 409 shows the conflict and re-applies.
// Branding is configuration, not a business approval. Needs branding.configure (ADM_TECH); others get the 403 state.
// T-DG6-FE-F (ADR-0061 §1, §5, §6, §7.3; REQ-S15-003, REQ-S15-007): a publish below the contrast rule is refused with
// 422 branding.contrast_insufficient; the one form-level alert lists each failing pair (the translated pair code and the
// language-neutral "<fg> / <bg> | <use> | <ratio>:1 < <threshold>:1" inside an LTR isolate), and the colour field the
// pair resolves through shows the pair code. The "Contrast report" section reads getBrandingVersionContrast for the
// selected version (the current one by default); a version published before the rule (`not_recorded`) whose colours
// fail shows the warning to publish corrected colours.
import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { BRANDING_FONT_ARABIC, BRANDING_FONT_LATIN } from "@mth/shared/schemas";
import { api, ApiError } from "../../api/client.ts";
import { useLocale } from "../../app/locale.ts";
import { useSessionBoundAction } from "../../auth/sessionBound.ts";
import { Field } from "../../components/Form.tsx";
import { Icon } from "../../components/Icon.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { Section } from "../../components/Section.tsx";
import {
  ConflictPanel,
  EmptyState,
  LoadingState,
  NoPermissionState,
  ErrorState,
  QueryState,
  type ConflictRow,
} from "../../components/States.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { deriveNavigationBackground } from "@mth/design-tokens";
import { FormAlert } from "../my-work/p4ui.tsx";
import {
  brandingKeys,
  brandingPaths,
  contrastRatio,
  HEX_COLOUR,
  useBrandingContrast,
  useBrandingSettings,
  useBrandingVersions,
  type BrandingContrastReport,
  type BrandingSettings,
} from "./api.ts";
import { problemText } from "../../lib/problem.ts";

const NS = ["playbookP5"] as const;
const WHITE = "#FFFFFF";
const PAGE_BG = "#F5F8FC";

type LogoMode = "keep" | "none" | "set";

interface Draft {
  productNameEn: string;
  productNameAr: string;
  primaryColour: string;
  secondaryColour: string;
  colourApprovalReference: string;
  logoMode: LogoMode;
  pngBase64: string;
  altEn: string;
  altAr: string;
  reportHeaderEn: string;
  reportHeaderAr: string;
  reportFooterEn: string;
  reportFooterAr: string;
  changeNote: string;
}

function draftOf(s: BrandingSettings): Draft {
  return {
    productNameEn: s.productNameEn,
    productNameAr: s.productNameAr,
    primaryColour: s.primaryColour,
    secondaryColour: s.secondaryColour,
    colourApprovalReference: s.colourApprovalReference ?? "",
    logoMode: "keep",
    pngBase64: "",
    altEn: s.logo?.altEn ?? "",
    altAr: s.logo?.altAr ?? "",
    reportHeaderEn: s.reportHeaderEn ?? "",
    reportHeaderAr: s.reportHeaderAr ?? "",
    reportFooterEn: s.reportFooterEn ?? "",
    reportFooterAr: s.reportFooterAr ?? "",
    changeNote: "",
  };
}

const orNull = (v: string): string | null => (v.trim() === "" ? null : v.trim());

/** The PUT body (BrandingSettingsPut): the complete settings. */
export function bodyOf(d: Draft) {
  return {
    productNameEn: d.productNameEn.trim(),
    productNameAr: d.productNameAr.trim(),
    primaryColour: d.primaryColour,
    secondaryColour: d.secondaryColour,
    colourApprovalReference: orNull(d.colourApprovalReference),
    fontLatin: BRANDING_FONT_LATIN,
    fontArabic: BRANDING_FONT_ARABIC,
    logo:
      d.logoMode === "set"
        ? { mode: "set" as const, pngBase64: d.pngBase64, altEn: d.altEn.trim(), altAr: d.altAr.trim() }
        : { mode: d.logoMode },
    reportHeaderEn: orNull(d.reportHeaderEn),
    reportHeaderAr: orNull(d.reportHeaderAr),
    reportFooterEn: orNull(d.reportFooterEn),
    reportFooterAr: orNull(d.reportFooterAr),
    changeNote: orNull(d.changeNote),
  };
}

type Errors = Partial<Record<keyof Draft, string>>;

/** The client-side checks that mirror the server's rules (the server decides; ADR-0049 §11 codes). */
export function validate(d: Draft): Errors {
  const e: Errors = {};
  const len = (v: string) => v.trim().length;
  if (len(d.productNameEn) < 1 || len(d.productNameEn) > 80) e.productNameEn = "validation__required";
  if (len(d.productNameAr) < 1 || len(d.productNameAr) > 80) e.productNameAr = "validation__required";
  if (!HEX_COLOUR.test(d.primaryColour)) e.primaryColour = "branding__colour_invalid";
  if (!HEX_COLOUR.test(d.secondaryColour)) e.secondaryColour = "branding__colour_invalid";
  if (d.logoMode === "set" && (!d.pngBase64 || !d.altEn.trim() || !d.altAr.trim()))
    e.pngBase64 = "branding__logo_invalid";
  if (len(d.reportHeaderEn) > 0 !== len(d.reportHeaderAr) > 0) e.reportHeaderEn = "branding__text_pair_required";
  if (len(d.reportFooterEn) > 0 !== len(d.reportFooterAr) > 0) e.reportFooterEn = "branding__text_pair_required";
  return e;
}

export function BrandingPage() {
  const { t } = useTranslation();
  usePageTitle(t("playbookP5.branding.title"));
  const settings = useBrandingSettings();
  return (
    <div className="page" data-p5-screen="branding">
      <PageHeader
        demoBadge
        title={t("playbookP5.branding.title")}
        subtitle={t("playbookP5.branding.intro")}
        crumbs={[{ label: t("nav.areas.admin.label"), to: "/admin" }, { label: t("playbookP5.branding.title") }]}
      />
      <p className="banner banner--info" role="note" data-state="branding-rules">
        <Icon name="info" /> {t("playbookP5.branding.rules")}
      </p>
      {settings.isPending ? (
        <LoadingState />
      ) : settings.isError ? (
        settings.error instanceof ApiError && (settings.error.status === 403 || settings.error.status === 404) ? (
          <NoPermissionState error={settings.error} />
        ) : (
          <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />
        )
      ) : (
        <>
          <CurrentSummary s={settings.data} />
          <SettingsForm s={settings.data} />
          <VersionsAndContrast current={settings.data.source === "default" ? null : settings.data.versionNo} />
        </>
      )}
    </div>
  );
}

function ColourStatus({ s }: { s: Pick<BrandingSettings, "coloursProvisional"> }) {
  const { t } = useTranslation();
  return s.coloursProvisional ? (
    <span className="badge badge--provisional" data-state="colours-provisional">
      {t("playbookP5.branding.coloursProvisional")}
    </span>
  ) : (
    <span className="lifecycle-chip" data-state="colours-reference">
      <Icon name="check" /> {t("playbookP5.branding.coloursReferenced")}
    </span>
  );
}

function Swatch({ hex }: { hex: string }) {
  return (
    <span
      className="branding-swatch"
      aria-hidden="true"
      style={{
        background: hex,
        display: "inline-block",
        inlineSize: "1rem",
        blockSize: "1rem",
        border: "1px solid var(--mth-border-control)",
        verticalAlign: "middle",
      }}
    />
  );
}

function CurrentSummary({ s }: { s: BrandingSettings }) {
  const { t } = useTranslation();
  const locale = useLocale();
  return (
    <Section id="current" title={t("playbookP5.branding.current")}>
      <dl className="workspace-header__grid" data-branding-version={s.versionNo}>
        <dt>{t("playbookP5.branding.publishedVersion")}</dt>
        <dd>
          {s.source === "default"
            ? t("playbookP5.branding.defaultVersion")
            : t("playbookP5.branding.versionN", { n: s.versionNo })}
        </dd>
        <dt>{t("playbookP5.branding.productName")}</dt>
        <dd>
          <span lang="en" dir="ltr">
            {s.productNameEn}
          </span>{" "}
          ·{" "}
          <span lang="ar" dir="rtl">
            {s.productNameAr}
          </span>
        </dd>
        <dt>{t("playbookP5.branding.colours")}</dt>
        <dd>
          <Swatch hex={s.primaryColour} /> <bdi dir="ltr">{s.primaryColour}</bdi> · <Swatch hex={s.secondaryColour} />{" "}
          <bdi dir="ltr">{s.secondaryColour}</bdi> <ColourStatus s={s} />
        </dd>
        <dt>{t("playbookP5.branding.logo")}</dt>
        <dd>
          {s.logo ? (
            <img
              src={s.logo.url}
              alt={locale === "ar" ? s.logo.altAr : s.logo.altEn}
              style={{ maxBlockSize: "2rem" }}
            />
          ) : (
            <span className="badge badge--provisional" data-state="wordmark-provisional">
              {t("playbookP5.branding.wordmark")}
            </span>
          )}
        </dd>
        <dt>{t("playbookP5.branding.lastSaved")}</dt>
        <dd>{s.updatedAt ? formatDateTime(s.updatedAt, locale) : t("playbookP5.branding.neverSaved")}</dd>
      </dl>
    </Section>
  );
}

function readPng(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

function SettingsForm({ s }: { s: BrandingSettings }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const beginAction = useSessionBoundAction();
  const [draft, setDraft] = useState<Draft>(() => draftOf(s));
  const [baseVersion, setBaseVersion] = useState(s.version);
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<number | null>(null);
  const [conflict, setConflict] = useState<BrandingSettings | null>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const err = (k: keyof Draft) => (errors[k] ? t(`problems.${errors[k]}`) : undefined);

  const save = async (version: number) => {
    const v = validate(draft);
    setErrors(v);
    setSaved(null);
    if (Object.keys(v).length > 0) return;
    const action = beginAction();
    setBusy(true);
    setError(null);
    try {
      const result = await api.send<BrandingSettings>(brandingPaths.settings, {
        method: "PUT",
        body: bodyOf(draft),
        ifMatch: version,
      });
      if (action.stale()) return;
      setConflict(null);
      setBaseVersion(result.version);
      setSaved(result.versionNo);
      setDraft(draftOf(result));
      action.setQueryData(brandingKeys.settings, () => result);
      await qc.invalidateQueries({ queryKey: brandingKeys.all });
    } catch (e) {
      if (action.stale(e)) return;
      const pairs = contrastFailures(e);
      if (pairs.length > 0) {
        const fieldErrs: Errors = {};
        for (const f of pairs) {
          const k =
            f.pointer === "/primaryColour"
              ? "primaryColour"
              : f.pointer === "/secondaryColour"
                ? "secondaryColour"
                : null;
          if (k) fieldErrs[k] = "branding__contrast_pair_below_threshold";
        }
        setErrors(fieldErrs);
      }
      if (e instanceof ApiError && e.status === 409) {
        const current = await api.get<BrandingSettings>(brandingPaths.settings).catch(() => null);
        if (action.stale()) return;
        if (current) {
          setConflict(current);
          action.setQueryData(brandingKeys.settings, () => current);
          return;
        }
      }
      setError(e);
    } finally {
      if (action.current()) setBusy(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void save(baseVersion);
  };

  // T-DG5-FE-G2 (D-163, REQ-S15-004): the navigation background is derived from the PRIMARY colour by the one rule of
  // @mth/design-tokens (white text >= 4.5:1); the secondary colour carries the header's white text.
  const navShade = HEX_COLOUR.test(draft.primaryColour) ? deriveNavigationBackground(draft.primaryColour) : null;
  const headerRatio = HEX_COLOUR.test(draft.secondaryColour) ? contrastRatio(WHITE, draft.secondaryColour) : null;
  const accentRatio = HEX_COLOUR.test(draft.primaryColour) ? contrastRatio(draft.primaryColour, PAGE_BG) : null;
  const conflictRows: ConflictRow[] = conflict
    ? (
        [
          ["productNameEn", conflict.productNameEn],
          ["productNameAr", conflict.productNameAr],
          ["primaryColour", conflict.primaryColour],
          ["secondaryColour", conflict.secondaryColour],
          ["colourApprovalReference", conflict.colourApprovalReference ?? ""],
          ["reportHeaderEn", conflict.reportHeaderEn ?? ""],
          ["reportHeaderAr", conflict.reportHeaderAr ?? ""],
          ["reportFooterEn", conflict.reportFooterEn ?? ""],
          ["reportFooterAr", conflict.reportFooterAr ?? ""],
        ] as const
      )
        .filter(([k, v]) => String(draft[k]).trim() !== v)
        .map(([k, v]) => ({ field: k, label: t(`playbookP5.branding.field.${k}`), mine: String(draft[k]), current: v }))
    : [];

  return (
    <Section id="settings" title={t("playbookP5.branding.settings")} intro={t("playbookP5.branding.settingsIntro")}>
      <form className="form" noValidate onSubmit={onSubmit} data-form="branding">
        <FormAlert error={error} namespaces={NS} extra={<ContrastFailureList error={error} />} />
        {conflict ? (
          <ConflictPanel
            yourVersion={baseVersion}
            currentVersion={conflict.version}
            rows={conflictRows}
            busy={busy}
            onReapply={() => {
              setBaseVersion(conflict.version);
              void save(conflict.version);
            }}
            onDiscard={() => {
              setDraft(draftOf(conflict));
              setBaseVersion(conflict.version);
              setConflict(null);
            }}
          />
        ) : null}
        {saved !== null ? (
          <p className="banner banner--success" role="status" data-state="branding-saved">
            <Icon name="check" /> {t("playbookP5.branding.savedVersion", { n: saved })}
          </p>
        ) : null}
        <fieldset className="form-section">
          <legend>{t("playbookP5.branding.productName")}</legend>
          <div className="form__row">
            <Field label={t("playbookP5.branding.field.productNameEn")} required error={err("productNameEn")}>
              {(p) => (
                <input
                  {...p}
                  lang="en"
                  dir="ltr"
                  maxLength={80}
                  value={draft.productNameEn}
                  onChange={(e) => set("productNameEn", e.target.value)}
                />
              )}
            </Field>
            <Field label={t("playbookP5.branding.field.productNameAr")} required error={err("productNameAr")}>
              {(p) => (
                <input
                  {...p}
                  lang="ar"
                  dir="rtl"
                  maxLength={80}
                  value={draft.productNameAr}
                  onChange={(e) => set("productNameAr", e.target.value)}
                />
              )}
            </Field>
          </div>
        </fieldset>
        <fieldset className="form-section">
          <legend>{t("playbookP5.branding.colours")}</legend>
          <div className="form__row">
            <Field
              label={t("playbookP5.branding.field.primaryColour")}
              hint={t("playbookP5.branding.hexHint")}
              required
              error={err("primaryColour")}
            >
              {(p) => (
                <input
                  {...p}
                  dir="ltr"
                  maxLength={7}
                  value={draft.primaryColour}
                  onChange={(e) => set("primaryColour", e.target.value.trim().toUpperCase())}
                />
              )}
            </Field>
            <Field
              label={t("playbookP5.branding.field.secondaryColour")}
              hint={t("playbookP5.branding.hexHint")}
              required
              error={err("secondaryColour")}
            >
              {(p) => (
                <input
                  {...p}
                  dir="ltr"
                  maxLength={7}
                  value={draft.secondaryColour}
                  onChange={(e) => set("secondaryColour", e.target.value.trim().toUpperCase())}
                />
              )}
            </Field>
          </div>
          <ul className="plain-list" data-list="contrast">
            <li data-contrast="navigation" data-pass={navShade === null ? "unknown" : "yes"}>
              <Swatch hex={navShade ?? WHITE} />{" "}
              {navShade === null
                ? t("playbookP5.branding.contrastUnknown")
                : t("playbookP5.branding.contrastNavDerived", {
                    shade: `\u2066${navShade}\u2069`, // an LTR run inside Arabic text
                    ratio: (Math.floor(contrastRatio(WHITE, navShade) * 100) / 100).toFixed(2),
                  })}
            </li>
            <li data-contrast="header" data-pass={headerRatio === null ? "unknown" : headerRatio >= 4.5 ? "yes" : "no"}>
              <Swatch hex={HEX_COLOUR.test(draft.secondaryColour) ? draft.secondaryColour : WHITE} />{" "}
              {headerRatio === null
                ? t("playbookP5.branding.contrastUnknown")
                : t(
                    headerRatio >= 4.5
                      ? "playbookP5.branding.contrastHeaderPass"
                      : "playbookP5.branding.contrastHeaderFail",
                    { ratio: headerRatio.toFixed(2) },
                  )}
            </li>
            <li data-contrast="accent" data-pass={accentRatio === null ? "unknown" : accentRatio >= 3 ? "yes" : "no"}>
              <Swatch hex={HEX_COLOUR.test(draft.primaryColour) ? draft.primaryColour : WHITE} />{" "}
              {accentRatio === null
                ? t("playbookP5.branding.contrastUnknown")
                : t(
                    accentRatio >= 3
                      ? "playbookP5.branding.contrastAccentPass"
                      : "playbookP5.branding.contrastAccentFail",
                    {
                      ratio: accentRatio.toFixed(2),
                    },
                  )}
            </li>
            <li>
              <Icon name="info" /> {t("playbookP5.branding.actionShade")}
            </li>
          </ul>
          <Field
            label={t("playbookP5.branding.field.colourApprovalReference")}
            hint={t("playbookP5.branding.approvalHint")}
          >
            {(p) => (
              <input
                {...p}
                maxLength={300}
                value={draft.colourApprovalReference}
                onChange={(e) => set("colourApprovalReference", e.target.value)}
              />
            )}
          </Field>
        </fieldset>
        <fieldset className="form-section">
          <legend>{t("playbookP5.branding.fonts")}</legend>
          <p className="muted">{t("playbookP5.branding.fontsHint")}</p>
          <div className="form__row">
            <Field label={t("playbookP5.branding.fontLatin")}>
              {(p) => (
                <select {...p} value={BRANDING_FONT_LATIN} disabled>
                  <option value={BRANDING_FONT_LATIN}>{BRANDING_FONT_LATIN}</option>
                </select>
              )}
            </Field>
            <Field label={t("playbookP5.branding.fontArabic")}>
              {(p) => (
                <select {...p} value={BRANDING_FONT_ARABIC} disabled>
                  <option value={BRANDING_FONT_ARABIC}>{BRANDING_FONT_ARABIC}</option>
                </select>
              )}
            </Field>
          </div>
        </fieldset>
        <fieldset className="form-section">
          <legend>{t("playbookP5.branding.logo")}</legend>
          <p className="muted">{t("playbookP5.branding.logoHint")}</p>
          <div role="radiogroup" aria-label={t("playbookP5.branding.logo")} className="form__row">
            {(["keep", "none", "set"] as const).map((m) => (
              <label key={m} className="checkbox">
                <input
                  type="radio"
                  name="logo-mode"
                  value={m}
                  checked={draft.logoMode === m}
                  onChange={() => set("logoMode", m)}
                />{" "}
                {t(`playbookP5.branding.logoMode.${m}`)}
              </label>
            ))}
          </div>
          {draft.logoMode === "set" ? (
            <div className="form__row">
              <Field
                label={t("playbookP5.branding.logoFile")}
                hint={t("playbookP5.branding.logoFileHint")}
                required
                error={err("pngBase64")}
              >
                {(p) => (
                  <input
                    {...p}
                    type="file"
                    accept="image/png"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return set("pngBase64", "");
                      void readPng(file).then((b64) => set("pngBase64", b64));
                    }}
                  />
                )}
              </Field>
              <Field label={t("playbookP5.branding.field.altEn")} required>
                {(p) => (
                  <input
                    {...p}
                    lang="en"
                    dir="ltr"
                    maxLength={200}
                    value={draft.altEn}
                    onChange={(e) => set("altEn", e.target.value)}
                  />
                )}
              </Field>
              <Field label={t("playbookP5.branding.field.altAr")} required>
                {(p) => (
                  <input
                    {...p}
                    lang="ar"
                    dir="rtl"
                    maxLength={200}
                    value={draft.altAr}
                    onChange={(e) => set("altAr", e.target.value)}
                  />
                )}
              </Field>
            </div>
          ) : null}
        </fieldset>
        <fieldset className="form-section">
          <legend>{t("playbookP5.branding.report")}</legend>
          <p className="muted">{t("playbookP5.branding.reportHint")}</p>
          <div className="form__row">
            <Field label={t("playbookP5.branding.field.reportHeaderEn")} error={err("reportHeaderEn")}>
              {(p) => (
                <input
                  {...p}
                  lang="en"
                  dir="ltr"
                  maxLength={300}
                  value={draft.reportHeaderEn}
                  onChange={(e) => set("reportHeaderEn", e.target.value)}
                />
              )}
            </Field>
            <Field label={t("playbookP5.branding.field.reportHeaderAr")}>
              {(p) => (
                <input
                  {...p}
                  lang="ar"
                  dir="rtl"
                  maxLength={300}
                  value={draft.reportHeaderAr}
                  onChange={(e) => set("reportHeaderAr", e.target.value)}
                />
              )}
            </Field>
          </div>
          <div className="form__row">
            <Field label={t("playbookP5.branding.field.reportFooterEn")} error={err("reportFooterEn")}>
              {(p) => (
                <input
                  {...p}
                  lang="en"
                  dir="ltr"
                  maxLength={300}
                  value={draft.reportFooterEn}
                  onChange={(e) => set("reportFooterEn", e.target.value)}
                />
              )}
            </Field>
            <Field label={t("playbookP5.branding.field.reportFooterAr")}>
              {(p) => (
                <input
                  {...p}
                  lang="ar"
                  dir="rtl"
                  maxLength={300}
                  value={draft.reportFooterAr}
                  onChange={(e) => set("reportFooterAr", e.target.value)}
                />
              )}
            </Field>
          </div>
        </fieldset>
        <Field label={t("playbookP5.branding.field.changeNote")}>
          {(p) => (
            <textarea
              {...p}
              maxLength={1000}
              value={draft.changeNote}
              onChange={(e) => set("changeNote", e.target.value)}
            />
          )}
        </Field>
        <div className="form__actions">
          <button type="submit" className="button button--primary" disabled={busy} data-action="publish-branding">
            {busy ? t("common.state.saving") : t("playbookP5.branding.publish")}
          </button>
        </div>
      </form>
    </Section>
  );
}

/** The failing pairs of a 422 branding.contrast_insufficient (ADR-0061 §6 `errors` items), in declared order. */
export function contrastFailures(error: unknown): readonly { pointer: string; message: string }[] {
  if (!(error instanceof ApiError) || error.code !== "branding.contrast_insufficient") return [];
  return error.fieldErrors
    .filter((f) => f.code === "branding.contrast_pair_below_threshold")
    .map((f) => ({ pointer: f.pointer, message: f.message ?? "" }));
}

/** Inside the one form-level alert: each failing pair, its translated code and the token pair and ratio as LTR data. */
export function ContrastFailureList({ error }: { error: unknown }) {
  const { t } = useTranslation();
  const pairs = contrastFailures(error);
  if (pairs.length === 0) return null;
  const pairText = problemText(t, "branding.contrast_pair_below_threshold");
  return (
    <div data-contrast-failures={pairs.length}>
      <p className="small">
        <strong>{t("explanations.contrast.failingPairs")}</strong>
      </p>
      <ul className="plain-list">
        {pairs.map((p, i) => (
          <li key={i} data-contrast-failure={p.pointer}>
            {pairText}{" "}
            <bdi dir="ltr" className="code">
              {p.message}
            </bdi>
          </li>
        ))}
      </ul>
    </div>
  );
}

function VersionsAndContrast({ current }: { current: number | null }) {
  const [selected, setSelected] = useState<number | null>(null);
  const shown = selected ?? current;
  return (
    <>
      <VersionsSection selected={shown} onSelect={setSelected} />
      <ContrastReportSection versionNo={shown} />
    </>
  );
}

function PassChip({ pass }: { pass: boolean }) {
  const { t } = useTranslation();
  return pass ? (
    <span className="lifecycle-chip" data-pass="yes">
      <Icon name="check" /> {t("explanations.contrast.pass")}
    </span>
  ) : (
    <span className="status-chip status-chip--off-track" data-health="off_track" data-pass="no">
      <Icon name="cross" /> {t("explanations.contrast.fail")}
    </span>
  );
}

/** ADR-0061 §5: the contrast report of one published version (getBrandingVersionContrast). */
function ContrastReportSection({ versionNo }: { versionNo: number | null }) {
  const { t } = useTranslation();
  const report = useBrandingContrast(versionNo);
  return (
    <Section id="contrast-report" title={t("explanations.contrast.title")} intro={t("explanations.contrast.intro")}>
      {versionNo === null ? (
        <EmptyState title={t("playbookP5.branding.noVersions")} body={t("playbookP5.branding.noVersionsBody")} />
      ) : (
        <QueryState query={report}>{(r) => <ContrastReport r={r} />}</QueryState>
      )}
    </Section>
  );
}

export function ContrastReport({ r }: { r: BrandingContrastReport }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const failing = r.status === "not_recorded" && r.failingCount > 0;
  return (
    <div data-contrast-report={r.versionNo} data-contrast-status={r.status} data-failing={r.failingCount}>
      <dl className="workspace-header__grid">
        <dt>{t("explanations.contrast.version")}</dt>
        <dd>{t("playbookP5.branding.versionN", { n: r.versionNo })}</dd>
        <dt>{t("explanations.contrast.result")}</dt>
        <dd>
          {r.status === "recorded" ? t("explanations.contrast.recorded") : t("explanations.contrast.notRecorded")}
          {r.recordedAt ? (
            <> · {t("explanations.contrast.recordedAt", { at: formatDateTime(r.recordedAt, locale) })}</>
          ) : null}
        </dd>
        <dt>{t("explanations.contrast.summary", { count: r.pairCount, failing: r.failingCount })}</dt>
        <dd>
          {r.failingCount > 0 ? (
            <PassChip pass={false} />
          ) : (
            <>
              <PassChip pass /> {t("explanations.contrast.allPass")}
            </>
          )}
        </dd>
        {r.tokenSourceSha256 ? (
          <>
            <dt>{t("explanations.contrast.sha")}</dt>
            {/* 64 hex characters with no break opportunity: wrap anywhere, so a 320–390 px screen does not scroll. */}
            <dd className="code--wrap">
              <bdi dir="ltr" className="code small">
                {r.tokenSourceSha256}
              </bdi>
            </dd>
          </>
        ) : null}
      </dl>
      {failing ? (
        <p className="banner banner--warning" role="status" data-state="contrast-failing">
          <Icon name="alert" /> {t("explanations.contrast.failing")}
        </p>
      ) : null}
      <div className="table-wrap" tabIndex={0} role="region" aria-label={t("explanations.contrast.title")}>
        <table className="table table--compact" data-table="branding-contrast">
          <caption className="visually-hidden">{t("explanations.contrast.title")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("explanations.contrast.pair")}</th>
              <th scope="col">{t("explanations.contrast.use")}</th>
              <th scope="col">{t("explanations.contrast.colours")}</th>
              <th scope="col">{t("explanations.contrast.ratio")}</th>
              <th scope="col">{t("explanations.contrast.threshold")}</th>
              <th scope="col">{t("explanations.contrast.result")}</th>
            </tr>
          </thead>
          <tbody>
            {r.pairs.map((p) => (
              <tr key={p.ordinal} data-pair={`${p.fg}/${p.bg}/${p.use}`} data-pass={p.pass ? "yes" : "no"}>
                <th scope="row">
                  <bdi dir="ltr" className="code">
                    {p.fg} / {p.bg}
                  </bdi>
                </th>
                <td>{t(`explanations.contrast.useKind.${p.use}`)}</td>
                <td>
                  <Swatch hex={p.fgHex} /> <bdi dir="ltr">{p.fgHex}</bdi> · <Swatch hex={p.bgHex} />{" "}
                  <bdi dir="ltr">{p.bgHex}</bdi>
                </td>
                <td>
                  <bdi dir="ltr">{p.ratio}:1</bdi>
                </td>
                <td>
                  <bdi dir="ltr">{p.threshold}:1</bdi>
                </td>
                <td>
                  <PassChip pass={p.pass} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function VersionsSection({ selected, onSelect }: { selected: number | null; onSelect: (n: number) => void }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const [cursors, setCursors] = useState<string[]>([]);
  const versions = useBrandingVersions(cursors[cursors.length - 1] ?? null);
  return (
    <Section id="versions" title={t("playbookP5.branding.versions")} intro={t("playbookP5.branding.versionsIntro")}>
      <QueryState
        query={versions}
        isEmpty={(p) => p.items.length === 0 && cursors.length === 0}
        empty={
          <EmptyState title={t("playbookP5.branding.noVersions")} body={t("playbookP5.branding.noVersionsBody")} />
        }
      >
        {(page) => (
          <>
            <div className="table-wrap" tabIndex={0} role="region" aria-label={t("playbookP5.branding.versions")}>
              <table className="table" data-table="branding-versions">
                <caption className="visually-hidden">{t("playbookP5.branding.versions")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("playbookP5.branding.version")}</th>
                    <th scope="col">{t("playbookP5.branding.productName")}</th>
                    <th scope="col">{t("playbookP5.branding.colours")}</th>
                    <th scope="col">{t("playbookP5.branding.field.colourApprovalReference")}</th>
                    <th scope="col">{t("playbookP5.branding.field.changeNote")}</th>
                    <th scope="col">{t("playbookP5.branding.created")}</th>
                    <th scope="col">{t("explanations.contrast.title")}</th>
                  </tr>
                </thead>
                <tbody>
                  {page.items.map((v) => (
                    <tr key={v.versionNo} data-version={v.versionNo}>
                      <th scope="row">{t("playbookP5.branding.versionN", { n: v.versionNo })}</th>
                      <td>{locale === "ar" ? v.productNameAr : v.productNameEn}</td>
                      <td>
                        <Swatch hex={v.primaryColour} /> <bdi dir="ltr">{v.primaryColour}</bdi> ·{" "}
                        <Swatch hex={v.secondaryColour} /> <bdi dir="ltr">{v.secondaryColour}</bdi>{" "}
                        <ColourStatus s={v} />
                      </td>
                      <td>{v.colourApprovalReference ?? <span className="muted">—</span>}</td>
                      <td>{v.changeNote ?? <span className="muted">—</span>}</td>
                      <td>{formatDateTime(v.createdAt, locale)}</td>
                      <td>
                        <button
                          type="button"
                          className="button button--small button--secondary"
                          aria-pressed={selected === v.versionNo}
                          data-action="show-contrast"
                          onClick={() => onSelect(v.versionNo)}
                        >
                          {t("explanations.contrast.show")}
                          <span className="visually-hidden">
                            {" "}
                            {t("playbookP5.branding.versionN", { n: v.versionNo })}
                          </span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="form__actions">
              {cursors.length > 0 ? (
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={() => setCursors((c) => c.slice(0, -1))}
                >
                  {t("playbookP5.search.previous")}
                </button>
              ) : null}
              {page.nextCursor ? (
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={() => setCursors((c) => [...c, page.nextCursor!])}
                >
                  {t("playbookP5.search.more")}
                </button>
              ) : null}
            </div>
          </>
        )}
      </QueryState>
    </Section>
  );
}
