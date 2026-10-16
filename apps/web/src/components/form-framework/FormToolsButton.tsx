// The "Form tools" entry of one record (T-DG5-FE-C): a button that opens the common form framework of the record in
// a dialog (edit and drafts, version history, comments, attachments). Used where a register shows records in a table
// (T01); a record page (T14) renders `FormFramework` in a section instead.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog } from "../Form.tsx";
import { Icon } from "../Icon.tsx";
import { FormFramework, type FormFrameworkProps } from "./FormFramework.tsx";

export function FormToolsButton(props: FormFrameworkProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="button button--link button--small"
        data-form-tools={props.recordId}
        onClick={() => setOpen(true)}
      >
        <Icon name="menu" /> {t("forms.framework.open")}
        <span className="visually-hidden">: {props.recordLabel}</span>
      </button>
      {open ? (
        <Dialog
          title={t("forms.framework.title", { record: props.recordLabel })}
          onClose={() => setOpen(false)}
          footer={
            <div className="form__actions">
              <button type="button" className="button button--secondary" onClick={() => setOpen(false)}>
                {t("forms.framework.close")}
              </button>
            </div>
          }
        >
          <FormFramework {...props} />
        </Dialog>
      ) : null}
    </>
  );
}
