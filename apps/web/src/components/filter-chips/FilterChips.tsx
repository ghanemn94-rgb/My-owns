// Filter chips (T-DG6-FE-D; ADR-0057 §5 "one chip per active filter parameter, with a remove control; the chip label
// is the filter's translated name and value (render-time translation, en/ar)"; REQ-S15-010 "lists support saved views
// and chips"). The caller translates the name and the value when it renders, so switching the language re-labels the
// chips. A value that is a code, an id or user text is isolated with <bdi> so it keeps its own direction in Arabic.
import { useTranslation } from "react-i18next";
import { Icon } from "../Icon.tsx";
import "../saved-views/productivity.css";

export interface FilterChip {
  /** The list's query parameter (stable; used as the test hook). */
  readonly key: string;
  /** The filter's translated name. */
  readonly label: string;
  /** The translated value (or the values, joined by the caller). */
  readonly value: string;
  readonly onRemove: () => void;
}

export function FilterChips({ chips, onClearAll }: { chips: readonly FilterChip[]; onClearAll?: () => void }) {
  const { t } = useTranslation();
  if (chips.length === 0) return null;
  return (
    <div className="filter-chips" role="group" aria-label={t("productivity.chips.label")} data-filter-chips>
      <ul className="filter-chips__list">
        {chips.map((c) => (
          <li key={c.key} className="filter-chip" data-chip={c.key}>
            <span className="filter-chip__text">
              <span className="filter-chip__name">{c.label}:</span> <bdi>{c.value}</bdi>
            </span>
            <button
              type="button"
              className="filter-chip__remove"
              onClick={c.onRemove}
              aria-label={t("productivity.chips.remove", { name: c.label, value: c.value })}
            >
              <Icon name="cross" />
            </button>
          </li>
        ))}
      </ul>
      {onClearAll && chips.length > 1 ? (
        <button type="button" className="button button--secondary button--small" onClick={onClearAll} data-chips-clear>
          {t("productivity.chips.clearAll")}
        </button>
      ) : null}
    </div>
  );
}
