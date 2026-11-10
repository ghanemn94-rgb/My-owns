// The server field errors a form shows no field for (F-DG6-222). A 400 `validation` answer's banner says "check the
// highlighted fields"; when a field error names something the form does not show (for example the host of a secret
// reference on a connector without an endpoint field), its translated text is said here, inside the form's one alert,
// instead of pointing at a highlighted field that does not exist. Texts are translated at render time (FE12).
import { useTranslation } from "react-i18next";
import { errorMessage, unplacedMessages, type UnplacedFieldError } from "../lib/problem.ts";
import { Icon } from "./Icon.tsx";

/** The list of the unplaced field errors' texts, each once and never the banner's own text (none: nothing). */
export function UnplacedFieldErrors({
  banner,
  unplaced,
}: {
  banner: string | null | undefined;
  unplaced: readonly UnplacedFieldError[];
}) {
  const { t } = useTranslation();
  const messages = unplacedMessages(t, banner, unplaced);
  if (messages.length === 0) return null;
  return (
    <ul className="plain-list" data-list="unplaced-field-errors">
      {messages.map((m) => (
        <li key={m}>{m}</li>
      ))}
    </ul>
  );
}

/** A form's one alert (S-7): the problem's translated text and the unplaced field errors' texts. */
export function FormProblemAlert({ error, unplaced }: { error: unknown; unplaced: readonly UnplacedFieldError[] }) {
  const { t } = useTranslation();
  if (!error) return null;
  const banner = errorMessage(t, error);
  return (
    <div className="banner banner--error" role="alert" data-state="form-errors">
      <p>
        <Icon name="alert" /> <span>{banner}</span>
      </p>
      <UnplacedFieldErrors banner={banner} unplaced={unplaced} />
    </div>
  );
}
