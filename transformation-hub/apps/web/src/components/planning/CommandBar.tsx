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
  const { can } = useProjectContext();
  const [open, setOpen] = useState<CommandSpec | null>(null);
  const visible = usableCommands(commands, allowed, can);
  if (visible.length === 0) return null;

  return (
    <div className={className}>
      <div className="flex flex-wrap gap-2" data-testid="command-bar">
        {visible.map((c) => (
          <button key={c.key} type="button" className={c.danger ? btn.secondary : c.primary ? btn.primary : btn.secondary} data-command={c.key} onClick={() => setOpen(c)}>
            {c.label}
          </button>
        ))}
      </div>
      {open ? <CommandConfirmDialog command={open} expectedVersion={expectedVersion} onClose={() => setOpen(null)} onDone={onDone} onReload={onReload} /> : null}
    </div>
  );
}

/** The commands a record offers this caller: allowed by the state machine, not hidden, and granted (UI hint; the API decides). */
export function usableCommands(commands: CommandSpec[], allowed: readonly string[], can: (permission: string | readonly string[]) => boolean): CommandSpec[] {
  return commands.filter((c) => allowed.includes(c.key) && !c.hidden && can(c.permission));
}

/**
 * Confirmation of one domain command (consequences, note, command-specific input), sent with `expectedVersion`. Used by
 * the command bar of a record and by the Kanban board (REQ-PLN-002), so a move there is the same audited command.
 */
export function CommandConfirmDialog({
  command,
  expectedVersion,
  onClose,
  onDone,
  onReload,
  context,
}: {
  command: CommandSpec;
  expectedVersion: number;
  onClose: () => void;
  onDone: () => Promise<unknown> | void;
  onReload: () => void;
  /** Extra consequence lines shown first (e.g. which record and which column a Kanban move targets). */
  context?: ReactNode[];
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [extra, setExtra] = useState(command.extra?.defaultValue ?? '');
  const extraMissing = !!command.extra?.required && extra.trim() === '';
  return (
    <ConfirmCommandDialog
      open
      onClose={onClose}
      title={command.label}
      confirmLabel={command.label}
      consequences={[...(context ?? []), ...command.effects, t('common.command.audited')]}
      noteMode={command.noteMode}
      noteLabel={command.noteLabel}
      danger={command.danger}
      expectedVersion={expectedVersion}
      confirmDisabled={extraMissing}
      onReload={() => {
        onReload();
        onClose();
      }}
      onConfirm={async ({ note }) => {
        await command.run({ note, expectedVersion, extra: extra.trim() });
        await onDone();
        toast.show('success', t('planning.common.commandDone', { action: command.label }));
        onClose();
      }}
    >
      {command.extra?.kind === 'custom' ? (
        command.extra.render(extra, setExtra)
      ) : command.extra ? (
        <TextField
          label={command.extra.label}
          type={command.extra.kind}
          required={command.extra.required}
          min={command.extra.min}
          max={command.extra.max}
          value={extra}
          onChange={(e) => setExtra(e.target.value)}
          dir="ltr"
        />
      ) : null}
    </ConfirmCommandDialog>
  );
}
