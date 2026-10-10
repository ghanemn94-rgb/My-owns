# T-DG4-FE-E: appends the slice F and G problem codes to apps/web/src/i18n/{en,ar}/problems.json (append-only: new
# keys at the end of the file, existing keys untouched). Codes: every ADR-0033 §10 and ADR-0034 §12 code, and
# ADR-0033 A3's `validation.conflict` (the other A3/A3 codes `validation.not_applicable`, `invalid_transition`,
# `validation.required` already exist). English texts are the ADR texts; a text with {placeholders} is rendered
# without them, because problem keys take no parameters (the FE-C/FE-D precedent). Arabic is provisional.
import json
import sys
from collections import OrderedDict

ROOT = sys.argv[1]

ROWS = [
    # ADR-0033 §10
    ("stakeholder_group.stance_invalid", "Current stance must be Support, Neutral or Resist.", "يجب أن يكون الموقف الحالي: داعم أو محايد أو معارض."),
    ("stakeholder_group.impact_invalid", "Impact and influence must be H, M or L.", "يجب أن يكون الأثر والنفوذ: مرتفع أو متوسط أو منخفض (H أو M أو L)."),
    ("stakeholder_group.intervention_invalid", "Intervention must be Comms, Training, Involvement or Incentive.", "يجب أن يكون التدخّل: تواصل أو تدريب أو إشراك أو تحفيز."),
    ("stakeholder_group.name_taken", "A stakeholder group with this name already exists in this transformation.", "توجد مجموعة أصحاب مصلحة بهذا الاسم في هذا التحوّل."),
    ("stakeholder_group.archived", "This stakeholder group is archived and can no longer be changed.", "هذه المجموعة مؤرشفة ولا يمكن تغييرها بعد ذلك."),
    ("stakeholder_group.kpi_invalid", "The adoption KPI must be a KPI of this transformation.", "يجب أن يكون مؤشر الأداء الرئيسي للتبنّي من مؤشرات هذا التحوّل."),
    ("stakeholder_champion.exists", "This person is already a champion of this group.", "هذا الشخص مناصر تغيير لهذه المجموعة بالفعل."),
    ("adoption_intervention.status_transition", "This intervention cannot move to the requested status.", "لا يمكن نقل هذا التدخّل إلى الحالة المطلوبة."),
    ("adoption_intervention.final", "This intervention is done or cancelled and can no longer be changed.", "هذا التدخّل منجز أو ملغى ولا يمكن تغييره بعد ذلك."),
    ("adoption_intervention.outcome_required", "Record the outcome before completing or cancelling the intervention.", "سجّل النتيجة قبل إنجاز التدخّل أو إلغائه."),
    ("adoption_intervention.owner_required", "Assign an owner before completing this intervention.", "عيّن مالكًا قبل إنجاز هذا التدخّل."),
    ("adoption_metric_link.kpi_required", "This indicator is measured by a KPI: name a KPI or create one from the template.", "يُقاس هذا المؤشر بمؤشر أداء: حدّد مؤشر أداء أو أنشئ واحدًا من القالب."),
    ("adoption_metric_link.kpi_not_applicable", "This measure is computed from training or assessment records and takes no KPI.", "يُحسب هذا المقياس من سجلات التدريب أو التقييم ولا يرتبط بمؤشر أداء."),
    ("adoption_metric_link.kpi_mismatch", "The KPI's unit and polarity must match the indicator template.", "يجب أن تطابق وحدة مؤشر الأداء واتجاهه قالب المؤشر."),
    ("adoption_metric_link.exists", "This indicator is already attached to this target.", "هذا المؤشر مرتبط بهذا الهدف بالفعل."),
    ("assessment_form.schema_invalid", "The form is not valid. Check the marked question.", "النموذج غير صالح. تحقّق من السؤال المعلَّم."),
    ("assessment_form.retired", "This form is retired and can no longer be changed.", "هذا النموذج متوقف ولا يمكن تغييره بعد ذلك."),
    ("assessment_form.not_published", "Only a published form takes invitations and responses.", "لا يقبل الدعوات والإجابات إلا النموذج المنشور."),
    ("assessment_form.status_transition", "This form cannot move to the requested status.", "لا يمكن نقل هذا النموذج إلى الحالة المطلوبة."),
    ("assessment_invitation.exists", "This person already has an open invitation to this form.", "لدى هذا الشخص دعوة مفتوحة لهذا النموذج بالفعل."),
    ("assessment_invitation.final", "This invitation is closed and can no longer be changed.", "هذه الدعوة مغلقة ولا يمكن تغييرها بعد ذلك."),
    ("assessment_record.answer_invalid", "This answer is not valid for the question.", "هذه الإجابة غير صالحة لهذا السؤال."),
    ("assessment_record.answer_required", "This question requires an answer.", "هذا السؤال يتطلب إجابة."),
    ("assessment_record.subject_required", "A proficiency observation names the person observed.", "تذكر ملاحظة الكفاءة الشخص الملاحَظ."),
    ("assessment_record.not_invited", "You are not invited to answer this form.", "أنت غير مدعو للإجابة على هذا النموذج."),
    ("assessment_record.not_withdrawable_by_caller", "Only the respondent or a reviewer can withdraw this response.", "لا يمكن سحب هذه الإجابة إلا من المستجيب أو من مراجع."),
    ("assessment_record.status_transition", "This response cannot move to the requested status.", "لا يمكن نقل هذه الإجابة إلى الحالة المطلوبة."),
    ("assessment_record.withdrawn", "This response is withdrawn and can no longer be changed.", "هذه الإجابة مسحوبة ولا يمكن تغييرها بعد ذلك."),
    ("training_record.final", "This training record is closed and can no longer be changed.", "سجل التدريب هذا مغلق ولا يمكن تغييره بعد ذلك."),
    ("training_record.intervention_not_training", "Only a training intervention can be linked to a training record.", "لا يمكن ربط سجل التدريب إلا بتدخّل من نوع التدريب."),
    ("stakeholder_involvement.target_invalid", "Involvement is recorded on a design workshop or a T04 design decision of this transformation.", "يُسجَّل الإشراك على ورشة تصميم أو قرار تصميم (T04) من هذا التحوّل."),
    ("stakeholder_involvement.already_withdrawn", "This involvement record is already withdrawn.", "سجل الإشراك هذا مسحوب بالفعل."),
    ("champion_constraint.not_champion", "Only an active champion of this group can raise a constraint.", "لا يمكن إثارة قيد إلا من مناصر تغيير نشط في هذه المجموعة."),
    ("champion_constraint.decision_invalid", "A constraint links to a T04 design decision of this transformation.", "يرتبط القيد بقرار تصميم (T04) من هذا التحوّل."),
    ("champion_constraint.final", "This constraint is closed and can no longer be changed.", "هذا القيد مغلق ولا يمكن تغييره بعد ذلك."),
    ("champion_constraint.not_resolvable_by_caller", "Only a decision editor can address this constraint, and only its champion can withdraw it.", "لا يعالج هذا القيد إلا محرر القرار، ولا يسحبه إلا مناصر التغيير الذي أثاره."),
    # ADR-0034 §12
    ("initiative.delivery_not_launched", "Only a launched initiative can be marked delivery complete.", "لا يمكن تعليم التسليم كمكتمل إلا لمبادرة مُطلقة."),
    ("initiative.adoption_status_invalid", "Adoption status must be On track, At risk or Adopted.", "يجب أن تكون حالة التبنّي: على المسار أو معرّضة للخطر أو متبنّاة."),
    ("closure.delivery_not_complete", "Initiative delivery is not complete.", "تسليم المبادرة غير مكتمل."),
    ("closure.already_closed", "This record is already closed.", "هذا السجل مغلق بالفعل."),
    ("closure.value_validation_pending", "Validated value is pending: closure needs each benefit validated by Finance or covered by an approved transition decision.", "القيمة المعتمدة قيد الانتظار: يتطلب الإغلاق اعتماد كل منفعة من المالية أو تغطيتها بقرار انتقال معتمد."),
    ("closure.sustainment_owner_missing", "Each validated benefit needs a BAU owner before closure.", "تحتاج كل منفعة معتمدة إلى مالك إلى العمليات الاعتيادية قبل الإغلاق."),
    ("closure.transformation_not_open", "Only an active or on-hold transformation can be closed.", "لا يمكن إغلاق إلا تحوّل نشط أو معلّق."),
    ("closure.g6_not_approved", "Closure requires the G6 (Sustain) business approval.", "يتطلب الإغلاق موافقة الأعمال على البوابة G6 (الاستدامة)."),
    ("closure.bau_not_accepted", "Every performance area of this transformation needs an accepted BAU handover before closure.", "يحتاج كل مجال أداء في هذا التحوّل إلى تسليم مقبول إلى العمليات الاعتيادية قبل الإغلاق."),
    ("performance_area.retired", "This performance area is retired and can no longer be changed.", "مجال الأداء هذا متوقف ولا يمكن تغييره بعد ذلك."),
    ("performance_area.not_reopenable", "Only a performance area in BAU can be reopened.", "لا يمكن إعادة فتح إلا مجال أداء في العمليات الاعتيادية."),
    ("performance_area.reopen_reason_required", "A reason is required to reopen a performance area.", "يلزم ذكر سبب لإعادة فتح مجال الأداء."),
    ("performance_area_link.exists", "This KPI or benefit is already linked to the performance area.", "مؤشر الأداء أو المنفعة هذه مرتبطة بمجال الأداء بالفعل."),
    ("bau_handover.incomplete", "The BAU handover is incomplete. The missing items are listed below.", "التسليم إلى العمليات الاعتيادية غير مكتمل. البنود الناقصة مدرجة أدناه."),
    ("bau_handover.not_receiving_owner", "Only the receiving owner can accept or return this handover.", "لا يمكن قبول هذا التسليم أو إعادته إلا من المالك المستلِم."),
    ("bau_handover.status_transition", "This handover cannot move to the requested status.", "لا يمكن نقل هذا التسليم إلى الحالة المطلوبة."),
    ("bau_handover.frozen", "A submitted handover can only be accepted or returned.", "لا يمكن إلا قبول التسليم المقدَّم أو إعادته."),
    ("bau_handover.accepted_final", "An accepted handover is final and cannot be changed.", "التسليم المقبول نهائي ولا يمكن تغييره."),
    ("bau_handover.area_not_open", "A handover is prepared for an establishing or reopened performance area.", "يُعدّ التسليم لمجال أداء قيد التأسيس أو أُعيد فتحه."),
    ("bau_handover.exists", "This performance area already has a handover in progress for this cycle.", "لدى مجال الأداء هذا تسليم قيد الإعداد لهذه الدورة بالفعل."),
    ("bau_handover.return_reason_required", "A reason is required to return a handover.", "يلزم ذكر سبب لإعادة التسليم."),
    ("control.retired", "This control is retired and can no longer be changed.", "هذا الضابط متوقف ولا يمكن تغييره بعد ذلك."),
    ("control_check.final", "This control check is closed and can no longer be changed.", "فحص الضابط هذا مغلق ولا يمكن تغييره بعد ذلك."),
    ("control_check.result_note_required", "A failed control check needs a result note.", "يحتاج فحص الضابط الفاشل إلى ملاحظة نتيجة."),
    ("sustainment_review.not_assignee", "Only the assigned reviewer can complete this review.", "لا يمكن إكمال هذه المراجعة إلا من المراجع المكلَّف."),
    ("sustainment_review.final", "This review is closed and can no longer be changed.", "هذه المراجعة مغلقة ولا يمكن تغييرها بعد ذلك."),
    ("improvement_item.final", "This improvement item is closed and can no longer be changed.", "بند التحسين هذا مغلق ولا يمكن تغييره بعد ذلك."),
    ("improvement_item.status_transition", "This improvement item cannot move to the requested status.", "لا يمكن نقل بند التحسين هذا إلى الحالة المطلوبة."),
    ("improvement_item.resolution_note_required", "Record a resolution note before closing the item.", "سجّل ملاحظة الحل قبل إغلاق البند."),
    ("lesson.archived", "This lesson is archived and can no longer be changed.", "هذا الدرس مؤرشف ولا يمكن تغييره بعد ذلك."),
    ("lesson.status_transition", "This lesson cannot move to the requested status.", "لا يمكن نقل هذا الدرس إلى الحالة المطلوبة."),
    ("transition_decision.exists", "This benefit already has a transition decision in progress or approved.", "لدى هذه المنفعة قرار انتقال قيد الإعداد أو معتمد بالفعل."),
    ("transition_decision.final", "This transition decision is closed and can no longer be changed.", "قرار الانتقال هذا مغلق ولا يمكن تغييره بعد ذلك."),
    ("transition_decision.frozen", "A submitted transition decision cannot be edited.", "لا يمكن تعديل قرار انتقال مقدَّم."),
    ("transition_decision.benefit_validated", "This benefit already has Finance-validated value; a transition decision is for value still to be realized.", "لدى هذه المنفعة قيمة معتمدة من المالية بالفعل؛ قرار الانتقال مخصص للقيمة التي لم تتحقق بعد."),
    ("transition_decision.monitoring_after_end", "The first monitoring date must be on or before the expected realization end.", "يجب أن يكون تاريخ المتابعة الأول في نهاية التحقق المتوقعة أو قبلها."),
    # ADR-0033 A3
    ("validation.conflict", "Name an existing KPI or ask to create one, not both.", "حدّد مؤشر أداء موجودًا أو اطلب إنشاء واحد، وليس كليهما."),
]


def append(path, idx):
    with open(path, encoding="utf-8") as f:
        data = json.load(f, object_pairs_hook=OrderedDict)
    added = 0
    for row in ROWS:
        key = row[0].replace(".", "__")
        # A re-run overwrites only this script's own keys (none of them existed before T-DG4-FE-E).
        data[key] = row[idx]
        added += 1
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    return added


print("en", append(f"{ROOT}/en/problems.json", 1), "ar", append(f"{ROOT}/ar/problems.json", 2), "codes", len(ROWS))
