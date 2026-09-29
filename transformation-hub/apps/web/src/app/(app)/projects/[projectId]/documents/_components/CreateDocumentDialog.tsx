'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { documentsRoutes } from '@hub/contracts';
import { DOCUMENT_KINDS, type Classification } from '@hub/domain';
import { ConfirmCommandDialog } from '@/components/ConfirmCommandDialog';
import { SelectField, TextField } from '@/components/Field';
import { useToast } from '@/components/Toast';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { assignableClassifications, dqk, shortRoom } from '@/lib/documents';
import { useProjectContext } from '@/lib/project-context';
import { projectAccess } from '@/lib/queries';

type Kind = (typeof DOCUMENT_KINDS)[number];

/** Create document metadata; the first version is uploaded on the document page (with progress). */
export function CreateDocumentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, tStatus } = useI18n();
  const { projectId, me } = useProjectContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const clearance = me.user.clearance as Classification;
  const options = assignableClassifications(clearance);
  const rooms = projectAccess(me, projectId)?.roomIds ?? [];
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<Kind>('evidence');
  const [classification, setClassification] = useState<Classification>(options.includes('confidential') ? 'confidential' : options[options.length - 1]!);
  const [roomId, setRoomId] = useState('');
  const [retentionUntil, setRetentionUntil] = useState('');
  const reset = () => {
    setTitle('');
    setKind('evidence');
    setRoomId('');
    setRetentionUntil('');
  };

  return (
    <ConfirmCommandDialog
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title={t('documents.create.title')}
      confirmLabel={t('documents.create.confirm')}
      noteMode="none"
      confirmDisabled={!title.trim()}
      consequences={[
        t('documents.create.effect', { classification: tStatus('classifications', classification) }),
        roomId ? t('documents.create.effectRoom') : t('documents.create.effectProject'),
        t('common.command.audited'),
      ]}
      onConfirm={async () => {
        const res = await api(documentsRoutes.createDocument, {
          params: { projectId },
          body: { title: title.trim(), kind, classification, ...(roomId ? { roomId } : {}), ...(retentionUntil ? { retentionUntil } : {}) },
        });
        await queryClient.invalidateQueries({ queryKey: dqk.all(projectId) });
        toast.show('success', t('documents.create.done'));
        reset();
        onClose();
        router.push(`/projects/${projectId}/documents/${res.id}`);
      }}
    >
      <div className="space-y-4">
        <TextField label={t('documents.create.docTitle')} required value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} data-testid="create-title" />
        <SelectField label={t('documents.create.kind')} required value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
          {DOCUMENT_KINDS.map((k) => (
            <option key={k} value={k}>
              {tStatus('documentKinds', k)}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={t('documents.create.classification')}
          required
          value={classification}
          onChange={(e) => setClassification(e.target.value as Classification)}
          hint={t('documents.create.classificationHint', { clearance: tStatus('classifications', clearance) })}
        >
          {options.map((c) => (
            <option key={c} value={c}>
              {tStatus('classifications', c)}
            </option>
          ))}
        </SelectField>
        {rooms.length > 0 ? (
          <SelectField label={t('documents.create.room')} value={roomId} onChange={(e) => setRoomId(e.target.value)} hint={t('documents.create.roomHint')}>
            <option value="">{t('documents.create.noRoom')}</option>
            {rooms.map((r) => (
              <option key={r} value={r}>
                {t('documents.create.roomOption', { room: shortRoom(r) })}
              </option>
            ))}
          </SelectField>
        ) : null}
        <TextField label={t('documents.create.retention')} type="date" dir="ltr" value={retentionUntil} onChange={(e) => setRetentionUntil(e.target.value)} hint={t('documents.create.retentionHint')} />
      </div>
    </ConfirmCommandDialog>
  );
}
