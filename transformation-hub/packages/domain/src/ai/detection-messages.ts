import { formatMessage, type ServerMessage } from '../messages';

/**
 * Rules-only AI detections as codes + parameters (QA-P5-04; pattern of docs/architecture/module-guide.md §2).
 *
 * The detections API returns `detail` (English, rendered from {@link AI_DETECTION_MESSAGES_EN}) plus `detailI18n` (these
 * codes with their parameters), which the web translates with `ai.messages.<code>` (en + ar) and the status catalogue
 * (`statuses.<vocabulary>`, {@link AI_DETECTION_ENUM_PARAMS}).
 *
 * An Arabic AI RUN is different: the model receives its context — and writes its answer — in the run's language, so the
 * server renders the Arabic context sentence itself ({@link renderAiMessages} with {@link AI_DETECTION_MESSAGES_AR} and the
 * Arabic status labels {@link AI_STATUS_AR}). Both tables are the web catalogue's own texts: apps/web/scripts/check-i18n.mjs
 * fails when `ai.messages.<code>` (ar) differs from {@link AI_DETECTION_MESSAGES_AR} or `statuses.<vocabulary>` (ar) from
 * {@link AI_STATUS_AR}, so the model context of an Arabic run says what the Arabic screen says.
 */
export const AI_DETECTION_MESSAGES_EN = {
  'ai.detection.task_overdue': 'Task {code} is overdue (due {due}, status {status}).',
  'ai.detection.no_owner': 'It has no accountable owner.',
  'ai.detection.gate_link': 'Linked gate: {gateKey}.',
  'ai.detection.milestone_overdue': 'Milestone {code} passed its date ({due}) without being achieved.',
  'ai.detection.milestone_pending_evidence': 'Milestone {code} is reported achieved but its evidence is not yet verified.',
  'ai.detection.delay_impact_incomplete': 'The delay impact of {code} cannot be computed: the schedule is incomplete.',
  'ai.detection.delay_impact_invalid': 'The delay impact of {code} cannot be computed: the schedule is not valid.',
  'ai.detection.delay_impact': 'A {delay}-working-day delay of {code} moves {successors} successor(s); the project finish slips {slip} working day(s) (schedule-based forecast, no probability).',
  'ai.detection.delay_impact_no_slip': 'A {delay}-working-day delay of {code} moves {successors} successor(s); the project finish slip is not available (schedule-based forecast, no probability).',
  'ai.detection.task_owner_missing': 'Task {code} has no accountable owner (status {status}).',
  'ai.detection.milestone_owner_missing': 'Milestone {code} has no owner.',
  'ai.detection.stale_update': 'No submitted or accepted status update for {code} since {date} (older than {days} days).',
  'ai.detection.stale_update_never': 'No submitted or accepted status update is recorded for {code}.',
  'ai.detection.decision_late': 'Decision {code} ({status}) is past its latest safe date {date}.',
  'ai.detection.decision_waiting': 'Decision {code} has been in status "{status}" for {days} day(s).',
  'ai.detection.action_overdue': 'Committee action {code} is overdue (due {due}).',
  'ai.detection.approval_waiting': 'An approval request has been pending since {date}.',
  'ai.detection.cp_missing_evidence': 'Blocking condition {code} ({status}) has no active evidence. Closing cannot be confirmed while it is unmet.',
  'ai.detection.cp_missing_evidence_non_waivable': 'Blocking condition {code} ({status}) has no active evidence; it is recorded as non-waivable. Closing cannot be confirmed while it is unmet.',
  'ai.detection.cp_gate_link': 'Open condition {code} ({status}) blocks gate {gateKey}.',
  'ai.detection.tsa_expiring': 'TSA service {code} ends {date} without an accepted replacement (status {status}). Exit is not declared; extension or continuity options need approval. No gate link is recorded for TSAs — check the readiness gate.',
  'ai.detection.readiness_open': 'Readiness check {code} ({area}) is {status}.',
  'ai.detection.readiness_blocker': 'Readiness check {code} ({area}) is {status} and is a go-live blocker.',
} as const satisfies Record<string, string>;

export type AiDetectionMessageCode = keyof typeof AI_DETECTION_MESSAGES_EN;

/** Arabic templates of the same codes — used only for the model context of Arabic runs (see the module comment). */
export const AI_DETECTION_MESSAGES_AR: Readonly<Record<AiDetectionMessageCode, string>> = {
  'ai.detection.task_overdue': 'المهمة {code} متأخرة (الاستحقاق {due}، الحالة {status}).',
  'ai.detection.no_owner': 'ليس لها مالك مسؤول.',
  'ai.detection.gate_link': 'البوابة المرتبطة: {gateKey}.',
  'ai.detection.milestone_overdue': 'تجاوز المعلم {code} تاريخه ({due}) دون تحقيقه.',
  'ai.detection.milestone_pending_evidence': 'أُبلغ عن تحقيق المعلم {code} لكن أدلته لم يُتحقق منها بعد.',
  'ai.detection.delay_impact_incomplete': 'تعذّر حساب أثر تأخر {code}: الجدول غير مكتمل.',
  'ai.detection.delay_impact_invalid': 'تعذّر حساب أثر تأخر {code}: الجدول غير صالح.',
  'ai.detection.delay_impact': 'تأخر {code} بمقدار {delay} يوم عمل يؤثر على {successors} نشاطًا لاحقًا؛ انزياح نهاية المشروع {slip} يوم عمل (توقع مبني على الجدول، دون احتمالات).',
  'ai.detection.delay_impact_no_slip': 'تأخر {code} بمقدار {delay} يوم عمل يؤثر على {successors} نشاطًا لاحقًا؛ انزياح نهاية المشروع غير متاح (توقع مبني على الجدول، دون احتمالات).',
  'ai.detection.task_owner_missing': 'المهمة {code} بلا مالك مسؤول (الحالة {status}).',
  'ai.detection.milestone_owner_missing': 'المعلم {code} بلا مالك.',
  'ai.detection.stale_update': 'لا يوجد تحديث حالة مقدَّم أو مقبول لمسار {code} منذ {date} (أقدم من {days} يومًا).',
  'ai.detection.stale_update_never': 'لم يُسجَّل أي تحديث حالة مقدَّم أو مقبول لمسار {code}.',
  'ai.detection.decision_late': 'القرار {code} ({status}) تجاوز آخر تاريخ آمن {date}.',
  'ai.detection.decision_waiting': 'القرار {code} في حالة «{status}» منذ {days} يومًا.',
  'ai.detection.action_overdue': 'إجراء اللجنة {code} متأخر (الاستحقاق {due}).',
  'ai.detection.approval_waiting': 'طلب اعتماد معلّق منذ {date}.',
  'ai.detection.cp_missing_evidence': 'الشرط المانع {code} ({status}) بلا أدلة سارية. لا يمكن تأكيد الإغلاق طالما لم يُستوفَ.',
  'ai.detection.cp_missing_evidence_non_waivable': 'الشرط المانع {code} ({status}) بلا أدلة سارية؛ ومسجَّل كغير قابل للإعفاء. لا يمكن تأكيد الإغلاق طالما لم يُستوفَ.',
  'ai.detection.cp_gate_link': 'الشرط المفتوح {code} ({status}) يعيق البوابة {gateKey}.',
  'ai.detection.tsa_expiring': 'تنتهي خدمة الاتفاقية الانتقالية {code} في {date} دون بديل مقبول (الحالة {status}). لم يُعلن الخروج؛ خيارات التمديد أو الاستمرارية تتطلب اعتمادًا. لا يُسجَّل ارتباط بالبوابة للاتفاقيات الانتقالية — راجع بوابة الجاهزية.',
  'ai.detection.readiness_open': 'فحص الجاهزية {code} ({area}) حالته {status}.',
  'ai.detection.readiness_blocker': 'فحص الجاهزية {code} ({area}) حالته {status} وهو مانع للتشغيل.',
};

/** Parameters that carry an enum value, per code: translated with `statuses.<vocabulary>` (web) / {@link AI_STATUS_AR}. */
export const AI_DETECTION_ENUM_PARAMS: Readonly<Partial<Record<AiDetectionMessageCode, Readonly<Record<string, AiStatusVocabulary>>>>> = {
  'ai.detection.task_overdue': { status: 'taskStatuses' },
  'ai.detection.task_owner_missing': { status: 'taskStatuses' },
  'ai.detection.decision_late': { status: 'decisionStatuses' },
  'ai.detection.decision_waiting': { status: 'decisionStatuses' },
  'ai.detection.cp_missing_evidence': { status: 'conditionStatuses' },
  'ai.detection.cp_missing_evidence_non_waivable': { status: 'conditionStatuses' },
  'ai.detection.cp_gate_link': { status: 'conditionStatuses' },
  'ai.detection.tsa_expiring': { status: 'tsaStatuses' },
  'ai.detection.readiness_open': { status: 'readinessStatuses', area: 'readinessAreas' },
  'ai.detection.readiness_blocker': { status: 'readinessStatuses', area: 'readinessAreas' },
};

/** Parameters that carry a business date (YYYY-MM-DD), per code: formatted for the locale by the web. */
export const AI_DETECTION_DATE_PARAMS: Readonly<Partial<Record<AiDetectionMessageCode, readonly string[]>>> = {
  'ai.detection.task_overdue': ['due'],
  'ai.detection.milestone_overdue': ['due'],
  'ai.detection.stale_update': ['date'],
  'ai.detection.decision_late': ['date'],
  'ai.detection.action_overdue': ['due'],
  'ai.detection.approval_waiting': ['date'],
  'ai.detection.tsa_expiring': ['date'],
};

/**
 * Arabic labels of the status vocabularies that appear in AI context sentences (detections, gate blockers, status
 * dimensions, partner stages, approved financial figures). Copies of `statuses.<vocabulary>` of the Arabic web catalogue,
 * kept identical by check-i18n.mjs.
 */
export const AI_STATUS_AR = {
  taskStatuses: { draft: 'مسودة', not_started: 'لم يبدأ', in_progress: 'قيد التنفيذ', blocked: 'متعثّر', submitted_for_acceptance: 'مُقدَّم للقبول', accepted: 'مقبول', done: 'منجز', cancelled: 'ملغى' },
  milestoneStatuses: { planned: 'مخطط', at_risk: 'معرّض للخطر', achieved_pending_evidence: 'مُنجز — بانتظار الأدلة', achieved_verified: 'مُنجز — تم التحقق', missed: 'فائت', cancelled: 'ملغى' },
  decisionStatuses: { draft: 'مسودة', submitted: 'مُقدَّم', under_review: 'قيد المراجعة', recommended: 'موصى به', approved: 'معتمد', rejected: 'مرفوض', deferred: 'مؤجل', superseded: 'مُستبدَل', implementation_pending: 'التنفيذ معلّق', implemented_verified: 'منفَّذ — تم التحقق' },
  conditionStatuses: { open: 'مفتوح', evidence_submitted: 'قُدّمت الأدلة', verified: 'تم التحقق', waived: 'تم التنازل', failed: 'فشل', lapsed: 'انقضى' },
  tsaStatuses: { proposed: 'مقترح', negotiating: 'قيد التفاوض', approved: 'معتمد', active: 'نشط', exit_in_progress: 'الخروج قيد التنفيذ', exit_accepted: 'قُبل الخروج', extended: 'مُمدَّد', breached: 'حدث إخلال', expired_unresolved: 'انتهت دون معالجة' },
  readinessStatuses: { not_started: 'لم يبدأ', in_progress: 'قيد التنفيذ', passed: 'اجتاز', failed: 'لم يجتز', waived: 'تم التنازل', not_applicable: 'لا ينطبق' },
  readinessAreas: { power: 'الطاقة', cooling: 'التبريد', connectivity: 'الاتصال الشبكي', physical_access: 'الوصول المادي', operations: 'العمليات', maintenance: 'الصيانة', spares: 'قطع الغيار', noc: 'مركز عمليات الشبكة (NOC)', incident_management: 'إدارة الحوادث', billing: 'الفوترة', support: 'الدعم', employees: 'الموظفون', security: 'الأمن', backup_recovery: 'النسخ الاحتياطي والاستعادة', other: 'أخرى' },
  gateAssessmentStatuses: { not_started: 'لم يبدأ', in_assessment: 'قيد التقييم', ready_for_decision: 'جاهز للقرار', approved: 'معتمد', approved_with_exceptions: 'معتمد مع استثناءات', rejected: 'مرفوض', reopened: 'أُعيد فتحه', superseded: 'مُستبدَل' },
  criterionStatuses: { unmet: 'غير مستوفى', evidence_submitted: 'قُدّمت الأدلة', met: 'مستوفى', waived: 'تم التنازل عنه', not_applicable: 'لا ينطبق', conflicting: 'متعارض' },
  dimensionStates: { not_assessed: 'لم يُقيَّم', unconfirmed: 'غير مؤكد', not_started: 'لم يبدأ', in_progress: 'قيد التنفيذ', incorporation_in_progress: 'التأسيس قيد التنفيذ', incorporated: 'مؤسَّسة', incorporated_unverified: 'مؤسَّسة — لم يتم التحقق من الأدلة بعد', incorporated_evidence_pending: 'مؤسسة — الأدلة بانتظار التحقق', incorporated_verified: 'مؤسسة — تم التحقق من الأدلة', not_applicable: 'لا ينطبق', perimeter_not_defined: 'النطاق غير محدد', perimeter_draft: 'النطاق قيد التحديد', perimeter_approved: 'النطاق معتمد', transfer_in_progress: 'النقل قيد التنفيذ', partially_transferred: 'منقول جزئياً — عناصر مشمولة أخرى قيد الانتظار', transferred_evidence_pending: 'منقول — الأدلة بانتظار التحقق', transferred_verified: 'منقول — تم التحقق من الأدلة', blocked: 'متعثّر', readiness_in_progress: 'الجاهزية قيد الإعداد', day1_ready: 'جاهز لليوم الأول', day1_go_approved: 'اعتُمد قرار المضي في اليوم الأول', operating_with_transitional_services: 'التشغيل مع خدمات انتقالية', standalone_accepted: 'قُبل التشغيل المستقل', transitional_services_exited: 'تم الخروج من الخدمات الانتقالية', preparing: 'التوقيع/الإتمام قيد الإعداد', partner_preparation: 'التحضير للشريك', diligence_and_negotiation: 'الفحص النافي للجهالة والتفاوض', signing_ready: 'جاهز للتوقيع', signed: 'تم التوقيع', closing_conditions_in_progress: 'استيفاء شروط الإتمام قيد التنفيذ', partially_closed: 'إتمام جزئي (إتمامات متعددة)', closed: 'تم الإتمام', terminated: 'منتهٍ أو منسحب' },
  statusDimensionKeys: { incorporation: 'التأسيس', perimeter_transfer: 'نقل النطاق (القانوني والاقتصادي)', operational_readiness: 'الجاهزية والاستقلال التشغيلي', jv_transaction: 'توقيع وإتمام صفقة المشروع المشترك' },
  partnerStages: { identified: 'محدَّد', approved_for_contact: 'معتمد للتواصل', nda: 'اتفاقية عدم الإفصاح', materials_access: 'الوصول إلى المواد', dd: 'الفحص النافي للجهالة', proposal: 'تقديم العرض', negotiation: 'التفاوض', signing: 'التوقيع', closing: 'الإتمام', withdrawn: 'انسحب' },
  financialKinds: { baseline: 'خط الأساس', forecast: 'توقعات', actual: 'فعلي' },
  modelCases: { base: 'الحالة الأساسية', downside: 'الحالة المتحفظة', upside: 'الحالة المتفائلة' },
} as const;

export type AiStatusVocabulary = keyof typeof AI_STATUS_AR;

/** The label of an enum value in the run's language (English runs keep the value; an unknown value is shown as given). */
export function aiStatusLabel(locale: 'en' | 'ar', vocabulary: AiStatusVocabulary, value: string | null | undefined): string {
  const v = value ?? '';
  if (locale !== 'ar') return v;
  return (AI_STATUS_AR[vocabulary] as Readonly<Record<string, string>>)[v] ?? v;
}

export const aiMessage = (code: AiDetectionMessageCode, params: Record<string, string | number> = {}): ServerMessage => ({ code, params });

/**
 * Renders AI detection messages in a run's language: English templates as they are; Arabic templates with every enum
 * parameter replaced by its Arabic label. A code without a template is a programming error.
 */
export function renderAiMessages(messages: readonly ServerMessage[], locale: 'en' | 'ar'): string {
  const templates: Readonly<Record<string, string>> = locale === 'ar' ? AI_DETECTION_MESSAGES_AR : AI_DETECTION_MESSAGES_EN;
  return messages
    .map((m) => {
      const t = templates[m.code];
      if (t === undefined) throw new Error(`No ${locale} template for AI message code ${m.code}`);
      const enums = AI_DETECTION_ENUM_PARAMS[m.code as AiDetectionMessageCode] ?? {};
      const params = Object.fromEntries(Object.entries(m.params).map(([k, v]) => [k, enums[k] ? aiStatusLabel(locale, enums[k]!, String(v)) : v]));
      return formatMessage(t, params);
    })
    .join(' ');
}
