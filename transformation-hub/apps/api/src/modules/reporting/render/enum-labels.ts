/**
 * Enum labels used in report exports: a copy of the web catalogue (`apps/web/src/i18n/messages/{en,ar}/statuses.json`) for
 * the enums that appear in reports, so files and screens use the same words. Generated; kept in sync by
 * `apps/api/test/reporting/report-labels.spec.ts` (regenerate from the web catalogue when it changes).
 */
export const ENUM_LABELS: Record<'en' | 'ar', Record<string, Record<string, string>>> = {
  "en": {
    "actionItemStatuses": {
      "open": "Open",
      "in_progress": "In progress",
      "done_pending_verification": "Done — pending verification",
      "verified_closed": "Verified and closed",
      "cancelled": "Cancelled"
    },
    "agendaItemKinds": {
      "decision": "Decision",
      "information": "Information",
      "discussion": "Discussion",
      "escalation": "Escalation"
    },
    "attendanceStatuses": {
      "present": "Present",
      "remote": "Remote",
      "absent": "Absent",
      "apologies": "Apologies",
      "delegated": "Delegated"
    },
    "benefitStatuses": {
      "proposed": "Proposed",
      "approved": "Approved",
      "tracking": "Tracking",
      "realized_unverified": "Realized — unverified",
      "realized_verified": "Realized — verified",
      "cancelled": "Cancelled"
    },
    "closingKinds": {
      "signing": "Signing",
      "closing": "Closing"
    },
    "closingStatuses": {
      "planned": "Planned",
      "in_preparation": "In preparation",
      "ready_for_confirmation": "Ready for confirmation",
      "confirmed": "Confirmed",
      "aborted": "Aborted"
    },
    "conditionKinds": {
      "condition_precedent": "Condition precedent (CP)",
      "condition_subsequent": "Condition subsequent (CS)"
    },
    "conditionStatuses": {
      "open": "Open",
      "evidence_submitted": "Evidence submitted",
      "verified": "Verified",
      "waived": "Waived",
      "failed": "Failed",
      "lapsed": "Lapsed"
    },
    "criterionStatuses": {
      "unmet": "Unmet",
      "evidence_submitted": "Evidence submitted",
      "met": "Met",
      "waived": "Waived",
      "not_applicable": "Not applicable",
      "conflicting": "Conflicting"
    },
    "cutoverStatuses": {
      "planning": "Planning",
      "rehearsal": "Rehearsal",
      "ready_for_decision": "Ready for decision",
      "approved_go": "Approved — go",
      "no_go": "No-go",
      "executed": "Executed",
      "accepted": "Accepted",
      "rolled_back": "Rolled back"
    },
    "decisionAuthorityOutcomes": {
      "within_mandate": "Within mandate",
      "pending_external_authority": "Pending external authority",
      "not_assessed": "Not assessed"
    },
    "decisionStatuses": {
      "draft": "Draft",
      "submitted": "Submitted",
      "under_review": "Under review",
      "recommended": "Recommended",
      "approved": "Approved",
      "rejected": "Rejected",
      "deferred": "Deferred",
      "superseded": "Superseded",
      "implementation_pending": "Implementation pending",
      "implemented_verified": "Implemented — verified"
    },
    "dimensionStates": {
      "not_assessed": "Not assessed",
      "unconfirmed": "Unconfirmed",
      "not_started": "Not started",
      "in_progress": "In progress",
      "incorporation_in_progress": "Incorporation in progress",
      "incorporated": "Incorporated",
      "incorporated_unverified": "Incorporated — evidence not yet verified",
      "incorporated_evidence_pending": "Incorporated — evidence pending verification",
      "incorporated_verified": "Incorporated — evidence verified",
      "not_applicable": "Not applicable",
      "perimeter_not_defined": "Perimeter not defined",
      "perimeter_draft": "Perimeter in definition",
      "perimeter_approved": "Perimeter approved",
      "transfer_in_progress": "Transfer in progress",
      "partially_transferred": "Partially transferred — other in-scope items pending",
      "transferred_evidence_pending": "Transferred — evidence pending verification",
      "transferred_verified": "Transferred — evidence verified",
      "blocked": "Blocked",
      "readiness_in_progress": "Readiness in progress",
      "day1_ready": "Day-1 ready",
      "day1_go_approved": "Day-1 go decision approved",
      "operating_with_transitional_services": "Operating with transitional services",
      "standalone_accepted": "Standalone operation accepted",
      "transitional_services_exited": "Transitional services exited",
      "preparing": "Signing/closing in preparation",
      "partner_preparation": "Partner preparation",
      "diligence_and_negotiation": "Due diligence and negotiation",
      "signing_ready": "Ready for signing",
      "signed": "Signed",
      "closing_conditions_in_progress": "Closing conditions in progress",
      "partially_closed": "Partially closed (multiple closings)",
      "closed": "Closed",
      "terminated": "Terminated or withdrawn"
    },
    "escalationStatuses": {
      "open": "Open",
      "decision_requested": "Decision requested",
      "resolved": "Resolved",
      "withdrawn": "Withdrawn"
    },
    "evidenceLinkStatuses": {
      "active": "Active",
      "superseded": "Superseded",
      "conflicting": "Conflicting",
      "rejected": "Rejected"
    },
    "gateAssessmentStatuses": {
      "not_started": "Not started",
      "in_assessment": "In assessment",
      "ready_for_decision": "Ready for decision",
      "approved": "Approved",
      "approved_with_exceptions": "Approved with exceptions",
      "rejected": "Rejected",
      "reopened": "Reopened",
      "superseded": "Superseded"
    },
    "goNoGo": {
      "pending": "Pending",
      "go": "Go",
      "no_go": "No-go"
    },
    "kpiDirections": {
      "higher_is_better": "Higher is better",
      "lower_is_better": "Lower is better"
    },
    "meetingStatuses": {
      "proposed": "Proposed",
      "planned": "Planned",
      "agenda_published": "Agenda published",
      "in_session": "In session",
      "held": "Held",
      "minutes_draft": "Minutes in draft",
      "minutes_approved": "Minutes approved",
      "cancelled": "Cancelled"
    },
    "milestoneStatuses": {
      "planned": "Planned",
      "at_risk": "At risk",
      "achieved_pending_evidence": "Achieved — evidence pending",
      "achieved_verified": "Achieved — verified",
      "missed": "Missed",
      "cancelled": "Cancelled"
    },
    "projectStatuses": {
      "setup": "Set-up",
      "active": "Active",
      "on_hold": "On hold",
      "closing": "Closing down",
      "closed": "Closed",
      "cancelled": "Cancelled"
    },
    "ragStatuses": {
      "green": "Green",
      "amber": "Amber",
      "red": "Red",
      "unknown": "Unknown",
      "stale": "Stale",
      "not_updated": "Not updated"
    },
    "raidStatuses": {
      "open": "Open",
      "monitoring": "Monitoring",
      "escalated": "Escalated",
      "mitigated": "Mitigated",
      "closed": "Closed",
      "cancelled": "Cancelled"
    },
    "readinessAreas": {
      "power": "Power",
      "cooling": "Cooling",
      "connectivity": "Connectivity",
      "physical_access": "Physical access",
      "operations": "Operations",
      "maintenance": "Maintenance",
      "spares": "Spares",
      "noc": "NOC",
      "incident_management": "Incident management",
      "billing": "Billing",
      "support": "Support",
      "employees": "Employees",
      "security": "Security",
      "backup_recovery": "Backup & recovery",
      "other": "Other"
    },
    "readinessStatuses": {
      "not_started": "Not started",
      "in_progress": "In progress",
      "passed": "Passed",
      "failed": "Failed",
      "waived": "Waived",
      "not_applicable": "Not applicable"
    },
    "roleKeys": {
      "platform_admin": "Platform administrator",
      "portfolio_admin": "Portfolio administrator",
      "sponsor": "Sponsor",
      "committee_chair": "Committee chair",
      "secretary_cpmo": "Secretary / CPMO",
      "project_manager": "Project manager",
      "workstream_lead": "Workstream lead",
      "contributor": "Contributor",
      "functional_approver": "Functional approver",
      "finance_restricted": "Finance (restricted)",
      "legal_restricted": "Legal (restricted)",
      "clean_team": "Clean team member",
      "auditor": "Auditor",
      "external_partner_limited": "External partner (limited)"
    },
    "statusDimensionKeys": {
      "incorporation": "Incorporation",
      "perimeter_transfer": "Perimeter transfer (legal & economic)",
      "operational_readiness": "Operational readiness & independence",
      "jv_transaction": "JV signing & closing"
    },
    "taskStatuses": {
      "draft": "Draft",
      "not_started": "Not started",
      "in_progress": "In progress",
      "blocked": "Blocked",
      "submitted_for_acceptance": "Submitted for acceptance",
      "accepted": "Accepted",
      "done": "Done",
      "cancelled": "Cancelled"
    },
    "tsaStatuses": {
      "proposed": "Proposed",
      "negotiating": "Negotiating",
      "approved": "Approved",
      "active": "Active",
      "exit_in_progress": "Exit in progress",
      "exit_accepted": "Exit accepted",
      "extended": "Extended",
      "breached": "Breached",
      "expired_unresolved": "Expired — unresolved"
    },
    "verificationStatuses": {
      "confirmed": "Confirmed",
      "historical_unverified": "Historical — unverified",
      "proposed": "Proposed",
      "assumed": "Assumed",
      "conflicting": "Conflicting",
      "unknown": "Unknown"
    },
    "deliverableStatuses": {
      "planned": "Planned",
      "in_progress": "In progress",
      "submitted": "Submitted",
      "accepted": "Accepted",
      "rejected": "Rejected",
      "cancelled": "Cancelled"
    },
    "classifications": {
      "public": "Public",
      "internal": "Internal",
      "confidential": "Confidential",
      "restricted": "Restricted",
      "strictly_confidential": "Strictly confidential"
    },
    "reportKinds": {
      "executive_summary": "Executive summary",
      "committee_pack": "Committee pack",
      "workstream_weekly": "Workstream weekly report",
      "look_ahead": "Look-ahead",
      "day1_readiness": "Day-1 readiness",
      "tsa_exit": "TSA exit",
      "jv_closing": "JV closing",
      "health_data_quality": "Health & data quality",
      "minutes": "Minutes",
      "register_export": "Register export"
    },
    "exportFormats": {
      "pdf": "PDF",
      "xlsx": "Excel (XLSX)",
      "docx": "Word (DOCX)",
      "pptx": "PowerPoint (PPTX)",
      "csv": "CSV",
      "json": "JSON"
    }
  },
  "ar": {
    "actionItemStatuses": {
      "open": "مفتوح",
      "in_progress": "قيد التنفيذ",
      "done_pending_verification": "منجز — بانتظار التحقق",
      "verified_closed": "مغلق — تم التحقق",
      "cancelled": "ملغى"
    },
    "agendaItemKinds": {
      "decision": "قرار",
      "information": "للعلم",
      "discussion": "نقاش",
      "escalation": "تصعيد"
    },
    "attendanceStatuses": {
      "present": "حاضر",
      "remote": "عن بُعد",
      "absent": "غائب",
      "apologies": "اعتذار",
      "delegated": "مُفوَّض"
    },
    "benefitStatuses": {
      "proposed": "مقترح",
      "approved": "معتمد",
      "tracking": "قيد المتابعة",
      "realized_unverified": "متحقَّق — غير مُثبت",
      "realized_verified": "متحقَّق — تم التحقق",
      "cancelled": "ملغى"
    },
    "closingKinds": {
      "signing": "التوقيع",
      "closing": "الإتمام"
    },
    "closingStatuses": {
      "planned": "مخطط",
      "in_preparation": "قيد الإعداد",
      "ready_for_confirmation": "جاهز للتأكيد",
      "confirmed": "مؤكد",
      "aborted": "أُوقف"
    },
    "conditionKinds": {
      "condition_precedent": "شرط مسبق (CP)",
      "condition_subsequent": "شرط لاحق (CS)"
    },
    "conditionStatuses": {
      "open": "مفتوح",
      "evidence_submitted": "قُدّمت الأدلة",
      "verified": "تم التحقق",
      "waived": "تم التنازل",
      "failed": "فشل",
      "lapsed": "انقضى"
    },
    "criterionStatuses": {
      "unmet": "غير مستوفى",
      "evidence_submitted": "قُدّمت الأدلة",
      "met": "مستوفى",
      "waived": "تم التنازل عنه",
      "not_applicable": "لا ينطبق",
      "conflicting": "متعارض"
    },
    "cutoverStatuses": {
      "planning": "التخطيط",
      "rehearsal": "تجربة",
      "ready_for_decision": "جاهز للقرار",
      "approved_go": "معتمد — المضي قدماً",
      "no_go": "عدم المضي",
      "executed": "منفَّذ",
      "accepted": "مقبول",
      "rolled_back": "تم التراجع"
    },
    "decisionAuthorityOutcomes": {
      "within_mandate": "ضمن التفويض",
      "pending_external_authority": "بانتظار جهة اعتماد خارجية",
      "not_assessed": "لم يُقيَّم"
    },
    "decisionStatuses": {
      "draft": "مسودة",
      "submitted": "مُقدَّم",
      "under_review": "قيد المراجعة",
      "recommended": "موصى به",
      "approved": "معتمد",
      "rejected": "مرفوض",
      "deferred": "مؤجل",
      "superseded": "مُستبدَل",
      "implementation_pending": "التنفيذ معلّق",
      "implemented_verified": "منفَّذ — تم التحقق"
    },
    "dimensionStates": {
      "not_assessed": "لم يُقيَّم",
      "unconfirmed": "غير مؤكد",
      "not_started": "لم يبدأ",
      "in_progress": "قيد التنفيذ",
      "incorporation_in_progress": "التأسيس قيد التنفيذ",
      "incorporated": "مؤسَّسة",
      "incorporated_unverified": "مؤسَّسة — لم يتم التحقق من الأدلة بعد",
      "incorporated_evidence_pending": "مؤسسة — الأدلة بانتظار التحقق",
      "incorporated_verified": "مؤسسة — تم التحقق من الأدلة",
      "not_applicable": "لا ينطبق",
      "perimeter_not_defined": "النطاق غير محدد",
      "perimeter_draft": "النطاق قيد التحديد",
      "perimeter_approved": "النطاق معتمد",
      "transfer_in_progress": "النقل قيد التنفيذ",
      "partially_transferred": "منقول جزئياً — عناصر مشمولة أخرى قيد الانتظار",
      "transferred_evidence_pending": "منقول — الأدلة بانتظار التحقق",
      "transferred_verified": "منقول — تم التحقق من الأدلة",
      "blocked": "متعثّر",
      "readiness_in_progress": "الجاهزية قيد الإعداد",
      "day1_ready": "جاهز لليوم الأول",
      "day1_go_approved": "اعتُمد قرار المضي في اليوم الأول",
      "operating_with_transitional_services": "التشغيل مع خدمات انتقالية",
      "standalone_accepted": "قُبل التشغيل المستقل",
      "transitional_services_exited": "تم الخروج من الخدمات الانتقالية",
      "preparing": "التوقيع/الإتمام قيد الإعداد",
      "partner_preparation": "التحضير للشريك",
      "diligence_and_negotiation": "الفحص النافي للجهالة والتفاوض",
      "signing_ready": "جاهز للتوقيع",
      "signed": "تم التوقيع",
      "closing_conditions_in_progress": "استيفاء شروط الإتمام قيد التنفيذ",
      "partially_closed": "إتمام جزئي (إتمامات متعددة)",
      "closed": "تم الإتمام",
      "terminated": "منتهٍ أو منسحب"
    },
    "escalationStatuses": {
      "open": "مفتوح",
      "decision_requested": "طُلب قرار",
      "resolved": "تم الحل",
      "withdrawn": "مسحوب"
    },
    "evidenceLinkStatuses": {
      "active": "نشط",
      "superseded": "مُستبدَل",
      "conflicting": "متعارض",
      "rejected": "مرفوض"
    },
    "gateAssessmentStatuses": {
      "not_started": "لم يبدأ",
      "in_assessment": "قيد التقييم",
      "ready_for_decision": "جاهز للقرار",
      "approved": "معتمد",
      "approved_with_exceptions": "معتمد مع استثناءات",
      "rejected": "مرفوض",
      "reopened": "أُعيد فتحه",
      "superseded": "مُستبدَل"
    },
    "goNoGo": {
      "pending": "معلّق",
      "go": "المضي قدماً",
      "no_go": "عدم المضي"
    },
    "kpiDirections": {
      "higher_is_better": "الأعلى أفضل",
      "lower_is_better": "الأقل أفضل"
    },
    "meetingStatuses": {
      "proposed": "مقترح",
      "planned": "مخطط",
      "agenda_published": "نُشر جدول الأعمال",
      "in_session": "الجلسة منعقدة",
      "held": "عُقد",
      "minutes_draft": "مسودة المحضر",
      "minutes_approved": "المحضر معتمد",
      "cancelled": "ملغى"
    },
    "milestoneStatuses": {
      "planned": "مخطط",
      "at_risk": "معرّض للخطر",
      "achieved_pending_evidence": "مُنجز — بانتظار الأدلة",
      "achieved_verified": "مُنجز — تم التحقق",
      "missed": "فائت",
      "cancelled": "ملغى"
    },
    "projectStatuses": {
      "setup": "الإعداد",
      "active": "نشط",
      "on_hold": "معلّق",
      "closing": "قيد الإغلاق",
      "closed": "مغلق",
      "cancelled": "ملغى"
    },
    "ragStatuses": {
      "green": "أخضر",
      "amber": "كهرماني",
      "red": "أحمر",
      "unknown": "غير معروف",
      "stale": "متقادم",
      "not_updated": "لم يُحدَّث"
    },
    "raidStatuses": {
      "open": "مفتوح",
      "monitoring": "قيد المتابعة",
      "escalated": "مُصعَّد",
      "mitigated": "تم التخفيف",
      "closed": "مغلق",
      "cancelled": "ملغى"
    },
    "readinessAreas": {
      "power": "الطاقة",
      "cooling": "التبريد",
      "connectivity": "الاتصال الشبكي",
      "physical_access": "الوصول المادي",
      "operations": "العمليات",
      "maintenance": "الصيانة",
      "spares": "قطع الغيار",
      "noc": "مركز عمليات الشبكة (NOC)",
      "incident_management": "إدارة الحوادث",
      "billing": "الفوترة",
      "support": "الدعم",
      "employees": "الموظفون",
      "security": "الأمن",
      "backup_recovery": "النسخ الاحتياطي والاستعادة",
      "other": "أخرى"
    },
    "readinessStatuses": {
      "not_started": "لم يبدأ",
      "in_progress": "قيد التنفيذ",
      "passed": "اجتاز",
      "failed": "لم يجتز",
      "waived": "تم التنازل",
      "not_applicable": "لا ينطبق"
    },
    "roleKeys": {
      "platform_admin": "مدير المنصة",
      "portfolio_admin": "مدير المحفظة",
      "sponsor": "راعي المشروع",
      "committee_chair": "رئيس اللجنة",
      "secretary_cpmo": "أمين السر / مكتب إدارة المشاريع المؤسسي",
      "project_manager": "مدير المشروع",
      "workstream_lead": "قائد مسار العمل",
      "contributor": "مساهم",
      "functional_approver": "معتمِد وظيفي",
      "finance_restricted": "المالية (وصول مقيّد)",
      "legal_restricted": "القانونية (وصول مقيّد)",
      "clean_team": "عضو الفريق المعزول",
      "auditor": "مدقق",
      "external_partner_limited": "شريك خارجي (وصول محدود)"
    },
    "statusDimensionKeys": {
      "incorporation": "التأسيس",
      "perimeter_transfer": "نقل النطاق (القانوني والاقتصادي)",
      "operational_readiness": "الجاهزية والاستقلال التشغيلي",
      "jv_transaction": "توقيع وإتمام صفقة المشروع المشترك"
    },
    "taskStatuses": {
      "draft": "مسودة",
      "not_started": "لم يبدأ",
      "in_progress": "قيد التنفيذ",
      "blocked": "متعثّر",
      "submitted_for_acceptance": "مُقدَّم للقبول",
      "accepted": "مقبول",
      "done": "منجز",
      "cancelled": "ملغى"
    },
    "tsaStatuses": {
      "proposed": "مقترح",
      "negotiating": "قيد التفاوض",
      "approved": "معتمد",
      "active": "نشط",
      "exit_in_progress": "الخروج قيد التنفيذ",
      "exit_accepted": "قُبل الخروج",
      "extended": "مُمدَّد",
      "breached": "حدث إخلال",
      "expired_unresolved": "انتهت دون معالجة"
    },
    "verificationStatuses": {
      "confirmed": "مؤكد",
      "historical_unverified": "تاريخي — غير متحقق منه",
      "proposed": "مقترح",
      "assumed": "مُفترَض",
      "conflicting": "متعارض",
      "unknown": "غير معروف"
    },
    "deliverableStatuses": {
      "planned": "مخطط",
      "in_progress": "قيد التنفيذ",
      "submitted": "مُقدَّم",
      "accepted": "مقبول",
      "rejected": "مرفوض",
      "cancelled": "ملغى"
    },
    "classifications": {
      "public": "عام",
      "internal": "داخلي",
      "confidential": "سري",
      "restricted": "مقيّد",
      "strictly_confidential": "سري للغاية"
    },
    "reportKinds": {
      "executive_summary": "الملخص التنفيذي",
      "committee_pack": "حزمة اللجنة",
      "workstream_weekly": "التقرير الأسبوعي لمسار العمل",
      "look_ahead": "النظرة المستقبلية",
      "day1_readiness": "جاهزية اليوم الأول",
      "tsa_exit": "الخروج من الخدمات الانتقالية",
      "jv_closing": "إتمام صفقة المشروع المشترك",
      "health_data_quality": "السلامة وجودة البيانات",
      "minutes": "المحضر",
      "register_export": "تصدير السجل"
    },
    "exportFormats": {
      "pdf": "PDF",
      "xlsx": "Excel (XLSX)",
      "docx": "Word (DOCX)",
      "pptx": "PowerPoint (PPTX)",
      "csv": "CSV",
      "json": "JSON"
    }
  }
};
