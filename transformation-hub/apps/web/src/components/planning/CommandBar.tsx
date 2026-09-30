'use client';

import { useState, type ReactNode } from 'react';
import { useI18n } from '@/i18n/provider';
import { useProjectContext } from '@/lib/project-context';
import { ConfirmCommandDialog } from '../ConfirmCommandDialog';
import { TextField } from '../Field';
import { useToast } from '../Toast';
import { btn } from '../ui';

export type CommandExtra =
  | {
      kind: 'date' | 'number';
      label: string;
      required: boolean;
      min?: number;
      max?: number;
      defaultValue?: string;
    }
  | {
      /** A command-specific input (e.g. the governance decision backing an approval); its value is passed as `extra`. */
      kind: 'custom';
      required: boolean;
      defaultValue?: string;
      render: (value: string, onChange: (value: string) => void) => ReactNode;
    };

/**
 * One domain command of a record. Shown only when the state machine allows it (`allowedCommands` from the API)
 * AND the caller holds the permission (UI hint — the API decides, incl. separation of duties and ownership).
 */
export interface CommandSpec {
  key: string;
  label: string;
  /** Plain-language consequences shown before confirming. */
  effects: ReactNode[];
  permission: string | readonly string[];
  noteMode: 'none' | 'optional' | 'required';
  noteLabel?: string;
  danger?: boolean;
  primary?: boolean;
  extra?: CommandExtra;
  /** Hide even when allowed (e.g. the caller is the submitter and cannot accept their own work). */
  hidden?: boolean;
  run: (input: { note: string; expectedVersion: number; extra: string }) => Promise<unknown>;
}

export function CommandBar({
  commands,
  allowed,
  expectedVersion,
  onDone,
  onReload,
  className,
}: {
  commands: CommandSpec[];
  allowed: readonly string[];
  expectedVersion: number;
  onDone: () => Promise<unknown> | void;
  onReload: () => void;
  className?: string;
}) {
  const { t } = useI18n();
  const { can } = useProjectContext();
  const toast = useToast();
  const [open, setOpen] = useState<CommandSpec | null>(null);
  const [extra, setExtra] = useState('');
  const visible = commands.filter((c) => allowed.includes(c.key) && !c.hidden && can(c.permission));
  if (visible.length === 0) return null;

  const extraMissing = !!open?.extra?.required && extra.trim() === '';
  return (
    <div className={className}>
      <div className="flex flex-wrap gap-2" data-testid="command-bar">
        {visible.map((c) => (
          <button
            key={c.key}
            type="button"
            className={c.danger ? btn.secondary : c.primary ? btn.primary : btn.secondary}
            data-command={c.key}
            onClick={() => {
              setExtra(c.extra?.defaultValue ?? '');
              setOpen(c);
            }}
          >
            {c.label}
          </button>
        ))}
      </div>
      {open ? (
        <ConfirmCommandDialog
          open
          onClose={() => setOpen(null)}
          title={open.label}
          confirmLabel={open.label}
          consequences={[...open.effects, t('common.command.audited')]}
          noteMode={open.noteMode}
          noteLabel={open.noteLabel}
          danger={open.danger}
          expectedVersion={expectedVersion}
          confirmDisabled={extraMissing}
          onReload={() => {
            onReload();
            setOpen(null);
          }}
          onConfirm={async ({ note }) => {
            await open.run({ note, expectedVersion, extra: extra.trim() });
            await onDone();
            toast.show('success', t('planning.common.commandDone', { action: open.label }));
            setOpen(null);
          }}
        >
          {open.extra?.kind === 'custom' ? (
            open.extra.render(extra, setExtra)
          ) : open.extra ? (
            <TextField
              label={open.extra.label}
              type={open.extra.kind}
              required={open.extra.required}
              min={open.extra.min}
              max={open.extra.max}
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              dir="ltr"
            />
          ) : null}
        </ConfirmCommandDialog>
      ) : null}
    </div>
  );
}
