// Playbook and Procedures > Reader (T-DG5-FE-G; REQ-S03-010, REQ-PB-001, REQ-PB-002, REQ-PB-011, REQ-PB-077; ADR-0049
// §1-§5). The published methodology, read-only:
//  - "About this methodology": the provenance statement (B0004 verbatim), the PMI/Brightline connection (B0024), the
//    source-foundations table (Source / Used for, B0156, read-only) and the custom extensions (B0157–B0162). It is a
//    practical synthesis inspired by PMI/Brightline/BRM, never an official PMI standard or a certified product (M0089);
//  - the four guiding questions (B0016, verbatim in English; Arabic provisional);
//  - search in English or Arabic, with plain-text snippets whose matches are marked from the server's offsets;
//  - browsing by phase, with the Realize note (B0124) on the Realize phase;
//  - the element provenance table with the badges and question tags.
// With ?transformationId= the reader resolves that transformation's pinned methodology version (404 without read).
// Reading approves nothing.
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import { useLocale } from "../../app/locale.ts";
import { Field } from "../../components/Form.tsx";
import { Icon } from "../../components/Icon.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { ProvenanceBadge, QuestionTag } from "../../components/provenance-badge/ProvenanceBadge.tsx";
import { Section, SectionNav } from "../../components/Section.tsx";
import { EmptyState, ErrorState, LoadingState, QueryState } from "../../components/States.tsx";
import { pick } from "../automation/ui.tsx";
import {
  compact,
  PHASE_CODES,
  useGuidingQuestions,
  useMethodologyBlocks,
  useMethodologyElements,
  useMethodologyProvenance,
  useMethodologySearch,
  type PhaseCode,
  type Provenance,
} from "./api.ts";
import { excerpt, ProvisionalArabic, Snippet, SourceText } from "./ui.tsx";

export function ReaderPage() {
  const { t } = useTranslation();
  usePageTitle(t("playbookP5.reader.title"));
  const [params] = useSearchParams();
  const tid = params.get("transformationId");
  const ctx = compact({ transformationId: tid });
  const sections = [
    { id: "about", title: t("playbookP5.about.title") },
    { id: "questions", title: t("playbookP5.questions.title") },
    { id: "search", title: t("playbookP5.search.title") },
    { id: "browse", title: t("playbookP5.browse.title") },
    { id: "elements", title: t("playbookP5.elements.title") },
  ];
  return (
    <div className="page" data-p5-screen="playbook-reader">
      <PageHeader
        title={t("playbookP5.reader.title")}
        subtitle={t("playbookP5.reader.intro")}
        crumbs={[{ label: t("nav.areas.playbook.label"), to: "/playbook" }, { label: t("playbookP5.reader.title") }]}
      />
      <SectionNav sections={sections} />
      <AboutSection ctx={ctx} />
      <QuestionsSection />
      <SearchSection ctx={ctx} />
      <BrowseSection ctx={ctx} />
      <ElementsSection ctx={ctx} />
    </div>
  );
}

function AboutSection({ ctx }: { ctx: Record<string, string> }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const provenance = useMethodologyProvenance(ctx);
  return (
    <Section id="about" title={t("playbookP5.about.title")} intro={t("playbookP5.about.intro")}>
      <QueryState query={provenance}>
        {(p) => (
          <>
            <p className="muted" data-methodology-version={p.methodologyVersion.versionNo}>
              {t("playbookP5.versionLabel", { key: p.methodologyVersion.key, n: p.methodologyVersion.versionNo })}
            </p>
            <h3>{t("playbookP5.about.statement")}</h3>
            <SourceText block={p.statement} testId="statement" />
            <h3>{t("playbookP5.about.connection")}</h3>
            <SourceText block={p.connectionNote} testId="connection" />
            <div className="table-wrap" tabIndex={0} role="region" aria-label={t("playbookP5.about.foundations")}>
              <table className="table" data-table="source-foundations">
                <caption>{t("playbookP5.about.foundations")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("playbookP5.about.source")}</th>
                    <th scope="col">{t("playbookP5.about.usedFor")}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...p.foundations]
                    .sort((a, b) => a.ordinal - b.ordinal)
                    .map((f) => (
                      <tr key={f.code} data-foundation={f.code}>
                        <th scope="row">{pick(locale, f.sourceEn, f.sourceAr)}</th>
                        <td>{pick(locale, f.usedForEn, f.usedForAr)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {locale === "ar" ? (
              <p className="muted">
                <ProvisionalArabic /> {t("playbookP5.about.foundationsVerbatim")}
              </p>
            ) : null}
            <h3>{t("playbookP5.about.customExtensions")}</h3>
            <ul className="plain-list" data-list="custom-extensions">
              {p.customExtensions.map((c) => (
                <li key={c.blockRef}>
                  <ProvenanceBadge provenance="custom_extension" /> <SourceText block={c} testId={c.blockRef} />
                </li>
              ))}
            </ul>
            {p.note && (p.note.bodyEn || p.note.bodyAr) ? (
              <>
                <h3>{t("playbookP5.about.note")}</h3>
                <p data-provenance-note="">{pick(locale, p.note.bodyEn, p.note.bodyAr)}</p>
              </>
            ) : null}
          </>
        )}
      </QueryState>
    </Section>
  );
}

function QuestionsSection() {
  const { t } = useTranslation();
  const locale = useLocale();
  const questions = useGuidingQuestions();
  return (
    <Section id="questions" title={t("playbookP5.questions.title")} intro={t("playbookP5.questions.intro")}>
      <QueryState query={questions}>
        {(q) => (
          <ol data-list="guiding-questions">
            {[...q.items]
              .sort((a, b) => a.ordinal - b.ordinal)
              .map((g) => (
                <li key={g.code} data-question={g.code}>
                  <span lang={locale}>{locale === "ar" ? g.textAr : g.textEn}</span>
                  {locale === "ar" ? (
                    <span className="muted" lang="en" dir="ltr">
                      {" "}
                      ({g.textEn})
                    </span>
                  ) : null}{" "}
                  <span className="muted">
                    <bdi dir="ltr">{g.sourceRef}</bdi>
                  </span>
                </li>
              ))}
          </ol>
        )}
      </QueryState>
    </Section>
  );
}

function SearchSection({ ctx }: { ctx: Record<string, string> }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const [text, setText] = useState("");
  const [lang, setLang] = useState<"en" | "ar">(locale);
  const [phase, setPhase] = useState<PhaseCode | "">("");
  const [submitted, setSubmitted] = useState<Record<string, string> | null>(null);
  const [cursors, setCursors] = useState<string[]>([]);
  const [invalid, setInvalid] = useState(false);
  const query = submitted
    ? { ...submitted, ...(cursors.length ? { cursor: cursors[cursors.length - 1]! } : {}) }
    : null;
  const results = useMethodologySearch(query);
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const q = text.trim();
    // The server's rule (ADR-0049 §3): 2–200 characters; checked here first so the field explains it.
    if (q.length < 2 || q.length > 200) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setCursors([]);
    setSubmitted(compact({ ...ctx, q, lang, phase, limit: "20" }));
  };
  return (
    <Section id="search" title={t("playbookP5.search.title")} intro={t("playbookP5.search.intro")}>
      <form className="form" role="search" noValidate onSubmit={onSubmit} data-form="reader-search">
        <div className="form__row">
          <Field
            label={t("playbookP5.search.query")}
            required
            error={invalid ? t("problems.validation__search_query") : undefined}
          >
            {(p) => (
              <input {...p} type="search" value={text} maxLength={200} onChange={(e) => setText(e.target.value)} />
            )}
          </Field>
          <Field label={t("playbookP5.search.lang")}>
            {(p) => (
              <select {...p} value={lang} onChange={(e) => setLang(e.target.value as "en" | "ar")}>
                <option value="en">{t("playbookP5.search.langEn")}</option>
                <option value="ar">{t("playbookP5.search.langAr")}</option>
              </select>
            )}
          </Field>
          <Field label={t("playbookP5.phase.label")}>
            {(p) => (
              <select {...p} value={phase} onChange={(e) => setPhase(e.target.value as PhaseCode | "")}>
                <option value="">{t("playbookP5.phase.all")}</option>
                {PHASE_CODES.map((c) => (
                  <option key={c} value={c}>
                    {t(`playbookP5.phase.${c}`)}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <div className="form__actions">
          <button type="submit" className="button button--primary">
            {t("playbookP5.search.submit")}
          </button>
        </div>
      </form>
      {submitted === null ? null : results.isPending ? (
        <LoadingState />
      ) : results.isError ? (
        <ErrorState error={results.error} onRetry={() => void results.refetch()} />
      ) : results.data.items.length === 0 ? (
        <EmptyState title={t("playbookP5.search.none")} body={t("playbookP5.search.noneBody")} />
      ) : (
        <>
          <p role="status" className="muted">
            {t("playbookP5.search.resultsFor", { q: submitted["q"] })}
          </p>
          <ol className="plain-list search-results" data-list="search-results">
            {results.data.items.map((hit) => (
              <li key={hit.blockRef} data-hit={hit.blockRef} data-phase={hit.phaseCode ?? ""}>
                <Link className="link" to={blockPath(hit.blockRef, ctx)}>
                  <bdi dir="ltr">{hit.blockRef}</bdi>
                </Link>{" "}
                {hit.phaseCode ? (
                  <span className="lifecycle-chip">{t(`playbookP5.phase.${hit.phaseCode}`)}</span>
                ) : null}
                <p>
                  <Snippet text={hit.snippet} highlights={hit.highlights} lang={hit.lang} />
                </p>
              </li>
            ))}
          </ol>
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
            {results.data.nextCursor ? (
              <button
                type="button"
                className="button button--secondary"
                onClick={() => setCursors((c) => [...c, results.data.nextCursor!])}
              >
                {t("playbookP5.search.more")}
              </button>
            ) : null}
          </div>
        </>
      )}
    </Section>
  );
}

export function blockPath(ref: string, ctx: Record<string, string>): string {
  return ctx["transformationId"]
    ? `/playbook/reader/${ref}?transformationId=${encodeURIComponent(ctx["transformationId"])}`
    : `/playbook/reader/${ref}`;
}

function BrowseSection({ ctx }: { ctx: Record<string, string> }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const [phase, setPhase] = useState<PhaseCode | "">("");
  const blocks = useMethodologyBlocks(compact({ ...ctx, phase }));
  const provenance = useMethodologyProvenance(ctx);
  return (
    <Section id="browse" title={t("playbookP5.browse.title")} intro={t("playbookP5.browse.intro")}>
      <div className="form__row">
        <Field label={t("playbookP5.phase.label")}>
          {(p) => (
            <select
              {...p}
              value={phase}
              onChange={(e) => setPhase(e.target.value as PhaseCode | "")}
              data-filter="phase"
            >
              <option value="">{t("playbookP5.phase.all")}</option>
              {PHASE_CODES.map((c) => (
                <option key={c} value={c}>
                  {t(`playbookP5.phase.${c}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      {phase === "realize" && provenance.data ? (
        <div className="banner banner--info" role="note" data-state="realize-guidance">
          <p className="state__title">
            <Icon name="info" /> {t("playbookP5.browse.realizeGuidance")}
          </p>
          <SourceText block={provenance.data.realizeNote} testId="realize" />
        </div>
      ) : null}
      <QueryState
        query={blocks}
        isEmpty={(items) => items.length === 0}
        empty={<EmptyState title={t("playbookP5.browse.none")} />}
      >
        {(items) => (
          <ol className="plain-list block-list" data-list="blocks">
            {[...items]
              .sort((a, b) => a.ordinal - b.ordinal)
              .map((b) => (
                <li key={b.blockRef} data-block={b.blockRef}>
                  <Link className="link" to={blockPath(b.blockRef, ctx)}>
                    <bdi dir="ltr">{b.blockRef}</bdi>
                  </Link>{" "}
                  {b.isHeading ? (
                    <strong>{excerpt(pick(locale, b.textEn, b.textAr) ?? b.textEn, 120)}</strong>
                  ) : (
                    <span>{excerpt(pick(locale, b.textEn, b.textAr) ?? b.textEn)}</span>
                  )}{" "}
                  {b.linkCount > 0 ? (
                    <span className="lifecycle-chip" data-link-count={b.linkCount}>
                      <Icon name="dot" /> {t("playbookP5.browse.links", { n: b.linkCount })}
                    </span>
                  ) : null}
                  {b.guidanceEn || b.guidanceAr ? (
                    <span className="lifecycle-chip">
                      <Icon name="info" /> {t("playbookP5.browse.hasGuidance")}
                    </span>
                  ) : null}
                </li>
              ))}
          </ol>
        )}
      </QueryState>
    </Section>
  );
}

function ElementsSection({ ctx }: { ctx: Record<string, string> }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const [provenance, setProvenance] = useState<Provenance | "">("");
  const elements = useMethodologyElements(compact({ ...ctx, provenance }));
  return (
    <Section id="elements" title={t("playbookP5.elements.title")} intro={t("playbookP5.elements.intro")}>
      <div className="form__row">
        <Field label={t("playbookP5.elements.filter")}>
          {(p) => (
            <select
              {...p}
              value={provenance}
              onChange={(e) => setProvenance(e.target.value as Provenance | "")}
              data-filter="provenance"
            >
              <option value="">{t("playbookP5.elements.all")}</option>
              <option value="custom_extension">{t("playbookP5.provenance.custom_extension")}</option>
              <option value="foundation_inspired">{t("playbookP5.provenance.foundation_inspired")}</option>
            </select>
          )}
        </Field>
      </div>
      <QueryState
        query={elements}
        isEmpty={(list) => list.items.length === 0}
        empty={<EmptyState title={t("playbookP5.elements.none")} />}
      >
        {(list) => (
          <div className="table-wrap" tabIndex={0} role="region" aria-label={t("playbookP5.elements.title")}>
            <table className="table" data-table="element-profiles">
              <caption className="visually-hidden">{t("playbookP5.elements.title")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("playbookP5.elements.element")}</th>
                  <th scope="col">{t("playbookP5.elements.kind")}</th>
                  <th scope="col">{t("playbookP5.elements.provenance")}</th>
                  <th scope="col">{t("playbookP5.elements.question")}</th>
                  <th scope="col">{t("playbookP5.elements.sources")}</th>
                </tr>
              </thead>
              <tbody>
                {list.items.map((e) => (
                  <tr key={e.elementRef} data-element={e.elementRef}>
                    <th scope="row">{pick(locale, e.labelEn, e.labelAr)}</th>
                    <td>{t(`playbookP5.kind.${e.kind}`, { defaultValue: e.kind })}</td>
                    <td>
                      <ProvenanceBadge provenance={e.provenance} overridden={e.overridden} />{" "}
                      <span className="muted">
                        <bdi dir="ltr">{e.provenanceSourceRef}</bdi>
                      </span>
                    </td>
                    <td>{e.questionTag ? <QuestionTag code={e.questionTag} /> : <span className="muted">—</span>}</td>
                    <td>
                      {e.sourceRefs.map((r, i) => (
                        <span key={r}>
                          {i > 0 ? ", " : null}
                          <Link className="link" to={blockPath(r, ctx)}>
                            <bdi dir="ltr">{r}</bdi>
                          </Link>
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </QueryState>
    </Section>
  );
}
