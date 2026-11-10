// The global search box of the header (T-DG6-FE-D; ADR-0057 §3; REQ-S15-010 "global search"): a labelled search
// landmark that opens the search page with the query. A query shorter than 2 characters is not sent; the ADR-0057 §10
// text is announced instead. The navigation is bound to the session of the submit (auth/sessionBound.ts).
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSessionNavigate } from "../../auth/sessionBound.ts";
import { SEARCH_MAX_LENGTH, SEARCH_MIN_LENGTH } from "./api.ts";
import "../../components/saved-views/productivity.css";

export function GlobalSearchBox() {
  const { t } = useTranslation();
  const navigate = useSessionNavigate();
  const inputId = useId();
  const errId = useId();
  const [q, setQ] = useState("");
  const [tooShort, setTooShort] = useState(false);
  const submit = () => {
    const trimmed = q.trim();
    if (trimmed.length < SEARCH_MIN_LENGTH) {
      setTooShort(true);
      return;
    }
    setTooShort(false);
    navigate(`/search?q=${encodeURIComponent(trimmed)}`);
  };
  return (
    // A search landmark without a <form> or a second "searchbox": the page's own search fields (lessons, the playbook
    // reader, this search page) stay the only form and searchbox of their page. Enter in the field submits.
    <div className="global-search" role="search" aria-label={t("productivity.search.globalLabel")}>
      <label htmlFor={inputId} className="visually-hidden">
        {t("productivity.search.queryLabel")}
      </label>
      <input
        id={inputId}
        type="text"
        inputMode="search"
        enterKeyHint="search"
        className="global-search__input"
        placeholder={t("productivity.search.placeholder")}
        value={q}
        maxLength={SEARCH_MAX_LENGTH}
        onChange={(e) => {
          setQ(e.target.value);
          setTooShort(false);
        }}
        aria-invalid={tooShort}
        aria-describedby={tooShort ? errId : undefined}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        data-global-search
      />
      <button
        type="button"
        className="button button--ghost-inverse button--small"
        aria-label={t("productivity.search.globalLabel")}
        onClick={submit}
      >
        {t("productivity.search.submit")}
      </button>
      {tooShort ? (
        <span id={errId} className="global-search__error" role="alert">
          {t("problems.search__query_too_short")}
        </span>
      ) : null}
    </div>
  );
}
