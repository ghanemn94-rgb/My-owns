// Playbook and Procedures > Reader > one block (T-DG5-FE-G; REQ-S02-004, REQ-S03-010, REQ-PB-002, REQ-PB-011; ADR-0049
// §1, §4). The block's verbatim English text (a table block as a table), its provisional Arabic, the guidance of the
// resolved methodology version, and its resolved links to the native forms (the template's register), the procedures
// (with "Launch" when the caller may launch it) and the requirement IDs that implement it.
// Launch is slice C's launchProcedureInstance with an Idempotency-Key (a retried launch creates one instance); the
// reader never launches by itself, and launching a procedure approves nothing.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router";
import { newIdempotencyKey } from "../../api/client.ts";
import { p5Paths } from "../../api/p5.ts";
import { useAllTransformations } from "../../api/queries.ts";
import { useLocale } from "../../app/locale.ts";
import { useSessionNavigate } from "../../auth/sessionBound.ts";
import { Field } from "../../components/Form.tsx";
import { Icon } from "../../components/Icon.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { ProvenanceBadge, QuestionTag } from "../../components/provenance-badge/ProvenanceBadge.tsx";
import { Section } from "../../components/Section.tsx";
import { EmptyState, QueryState } from "../../components/States.tsx";
import { pick, useRunner } from "../automation/ui.tsx";
import {
  compact,
  useMethodologyBlock,
  useMethodologyBlockLinks,
  useMethodologyElements,
  type MethodologyBlock,
  type MethodologyLink,
} from "./api.ts";
import { blockPath } from "./ReaderPage.tsx";
import { BlockText, ProvisionalArabic } from "./ui.tsx";

const refOf = (n: number) => `B${String(n).padStart(4, "0")}`;

export function BlockPage() {
  const { t } = useTranslation();
  const { blockRef = "" } = useParams();
  const [params] = useSearchParams();
  const ctx = compact({ transformationId: params.get("transformationId") });
  const block = useMethodologyBlock(blockRef, ctx);
  usePageTitle(`${blockRef} · ${t("playbookP5.block.title")}`);
  return (
    <div className="page" data-p5-screen="playbook-block" data-block-ref={blockRef}>
      <PageHeader
        title={
          <>
            <bdi dir="ltr">{blockRef}</bdi> · {t("playbookP5.block.title")}
          </>
        }
        subtitle={t("playbookP5.block.intro")}
        crumbs={[
          { label: t("nav.areas.playbook.label"), to: "/playbook" },
          { label: t("playbookP5.reader.title"), to: "/playbook/reader" },
          { label: blockRef },
        ]}
      />
      <QueryState query={block}>{(b) => <BlockBody b={b} ctx={ctx} />}</QueryState>
    </div>
  );
}

function BlockBody({ b, ctx }: { b: MethodologyBlock; ctx: Record<string, string> }) {
  const { t } = useTranslation();
  const locale = useLocale();
  return (
    <>
      <p className="muted" data-methodology-version={b.methodologyVersion.versionNo}>
        {b.phaseCode ? (
          <span className="lifecycle-chip" data-phase={b.phaseCode}>
            {t(`playbookP5.phase.${b.phaseCode}`)}
          </span>
        ) : null}{" "}
        {t("playbookP5.versionLabel", { key: b.methodologyVersion.key, n: b.methodologyVersion.versionNo })}
        {b.sectionBlockRef ? (
          <>
            {" · "}
            {t("playbookP5.block.section")}{" "}
            <Link className="link" to={blockPath(b.sectionBlockRef, ctx)}>
              <bdi dir="ltr">{b.sectionBlockRef}</bdi>
            </Link>
          </>
        ) : null}
      </p>
      <Section id="text" title={t("playbookP5.block.text")}>
        {locale === "ar" ? (
          <>
            <p>{b.arProvisional ? <ProvisionalArabic /> : null}</p>
            <BlockText text={b.textAr} lang="ar" caption={t("playbookP5.block.text")} />
            <h3>{t("playbookP5.verbatimEnglish")}</h3>
            <div data-verbatim="en">
              <BlockText text={b.textEn} lang="en" caption={t("playbookP5.verbatimEnglish")} />
            </div>
          </>
        ) : (
          <div data-verbatim="en">
            <BlockText text={b.textEn} lang="en" caption={t("playbookP5.block.text")} />
          </div>
        )}
      </Section>
      {b.guidanceEn || b.guidanceAr ? (
        <Section id="guidance" title={t("playbookP5.block.guidance")}>
          <p data-guidance="">{pick(locale, b.guidanceEn, b.guidanceAr)}</p>
        </Section>
      ) : null}
      <LinksSection blockRef={b.blockRef} ctx={ctx} />
      <nav className="form__actions" aria-label={t("playbookP5.block.pager")}>
        {b.ordinal > 1 ? (
          <Link className="button button--secondary" to={blockPath(refOf(b.ordinal - 1), ctx)} rel="prev">
            {t("playbookP5.block.previous")} <bdi dir="ltr">{refOf(b.ordinal - 1)}</bdi>
          </Link>
        ) : null}
        {b.ordinal < 165 ? (
          <Link className="button button--secondary" to={blockPath(refOf(b.ordinal + 1), ctx)} rel="next">
            {t("playbookP5.block.next")} <bdi dir="ltr">{refOf(b.ordinal + 1)}</bdi>
          </Link>
        ) : null}
      </nav>
    </>
  );
}

function LinksSection({ blockRef, ctx }: { blockRef: string; ctx: Record<string, string> }) {
  const { t } = useTranslation();
  const links = useMethodologyBlockLinks(blockRef, ctx);
  const templates = useMethodologyElements({ ...ctx, kind: "template" });
  const [launching, setLaunching] = useState<MethodologyLink | null>(null);
  return (
    <Section id="links" title={t("playbookP5.links.title")} intro={t("playbookP5.links.intro")}>
      <QueryState
        query={links}
        isEmpty={(l) => l.items.length === 0}
        empty={<EmptyState title={t("playbookP5.links.none")} />}
      >
        {(l) => (
          <ul className="plain-list" data-list="block-links">
            {l.items.map((link) => {
              const profile =
                link.targetKind === "template"
                  ? templates.data?.items.find((p) => p.stableKey === link.targetKey)
                  : undefined;
              return (
                <li key={`${link.targetKind}:${link.targetKey}`} data-link={`${link.targetKind}:${link.targetKey}`}>
                  <LinkRow link={link} />{" "}
                  {profile ? (
                    <>
                      <ProvenanceBadge provenance={profile.provenance} overridden={profile.overridden} />{" "}
                      {profile.questionTag ? <QuestionTag code={profile.questionTag} /> : null}
                    </>
                  ) : null}{" "}
                  {link.origin === "version" ? (
                    <span className="lifecycle-chip lifecycle-chip--draft">{t("playbookP5.links.fromVersion")}</span>
                  ) : null}{" "}
                  {link.targetKind === "procedure" && link.launchable ? (
                    <button
                      type="button"
                      className="button button--primary button--small"
                      onClick={() => setLaunching(link)}
                      aria-expanded={launching?.targetKey === link.targetKey}
                      data-action={`launch-${link.targetKey}`}
                    >
                      {t("playbookP5.links.launch")}
                    </button>
                  ) : null}
                  {launching && launching.targetKey === link.targetKey && link.targetKind === "procedure" ? (
                    <LaunchForm
                      link={link}
                      defaultTid={ctx["transformationId"] ?? ""}
                      onCancel={() => setLaunching(null)}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </QueryState>
    </Section>
  );
}

function LinkRow({ link }: { link: MethodologyLink }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const label = pick(locale, link.labelEn, link.labelAr) ?? link.targetKey;
  const kind = t(`playbookP5.links.kind.${link.targetKind}`);
  // A requirement ID names a row of the requirement register; the product has no register screen to open, so it is
  // shown as its ID (never as a link to a page that does not exist).
  if (link.targetKind === "requirement") {
    return (
      <span data-target-kind="requirement">
        <span className="lifecycle-chip">{kind}</span> <bdi dir="ltr">{link.targetKey}</bdi>
      </span>
    );
  }
  return (
    <span data-target-kind={link.targetKind}>
      <span className="lifecycle-chip">{kind}</span>{" "}
      <Link className="link" to={link.route}>
        <bdi dir="ltr">{link.targetKey}</bdi> {label !== link.targetKey ? `· ${label}` : null}
      </Link>
    </span>
  );
}

function LaunchForm({
  link,
  defaultTid,
  onCancel,
}: {
  link: MethodologyLink;
  defaultTid: string;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useSessionNavigate();
  // D-181: every transformation the user may see (all pages): the preset `defaultTid` is always among the choices,
  // so a launch never falls back to organization level because the list was cut.
  const transformations = useAllTransformations({ sort: "updatedAt:desc" });
  const [tid, setTid] = useState(defaultTid);
  // One idempotency key per intended launch: a retry of the same submission reuses it (one instance).
  const key = useMemo(() => newIdempotencyKey(), [link.targetKey, tid]); // eslint-disable-line react-hooks/exhaustive-deps
  const runner = useRunner(() => Promise.resolve());
  return (
    <form
      className="form"
      noValidate
      data-form="launch-procedure"
      onSubmit={(e) => {
        e.preventDefault();
        void runner
          .run<{ id: string }>(p5Paths.procedureInstances, {
            body: { procedureCode: link.targetKey, transformationId: tid || null },
            idempotencyKey: key,
          })
          .then((created) => {
            if (created) navigate(`/playbook/procedures/${created.id}`);
          });
      }}
    >
      {runner.alert}
      <p className="muted">
        <Icon name="info" /> {t("playbookP5.links.launchIntro")}
      </p>
      <QueryState query={transformations}>
        {(items) => (
          <Field label={t("playbookP5.links.transformation")} hint={t("playbookP5.links.transformationHint")}>
            {(p) => (
              <select {...p} value={tid} onChange={(e) => setTid(e.target.value)}>
                <option value="">{t("playbookP5.links.noTransformation")}</option>
                {items.map((tr) => (
                  <option key={tr.id} value={tr.id}>
                    {tr.code} · {tr.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
      </QueryState>
      <div className="form__actions">
        <button type="submit" className="button button--primary" disabled={runner.busy}>
          {t("playbookP5.links.launchConfirm")}
        </button>
        <button type="button" className="button button--secondary" onClick={onCancel} disabled={runner.busy}>
          {t("common.action.cancel")}
        </button>
      </div>
    </form>
  );
}
