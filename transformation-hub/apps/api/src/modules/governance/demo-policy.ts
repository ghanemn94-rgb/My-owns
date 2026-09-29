import type { AuthorityPolicy } from '@hub/domain';

/**
 * DEMO POLICY (synthetic, NOT Mobily policy) — copied verbatim from docs/governance/authority-matrix.md §4.3.
 * Values exist only to exercise the platform rules in the sandbox; amounts are the fictitious unit DEMO-SAR (the
 * technical currency field is `SAR` because the money model requires an ISO 4217 code). Usable only in projects
 * flagged `is_demo` (enforced when approving a matrix and by `matrixUsable`).
 */
export const DEMO_AUTHORITY_POLICY: AuthorityPolicy & { decisionTypes: (AuthorityPolicy['decisionTypes'][number] & { name: { en: string; ar: string } })[] } = {
  "isDemoPolicy": true,
  "quorum": {
    "minVotingMembersPresent": 3,
    "minFractionPresent": 0.5
  },
  "approvalThreshold": {
    "type": "simple_majority"
  },
  "tieRule": "escalate",
  "decisionTypes": [
    {
      "key": "baseline_approval",
      "name": {
        "en": "Approve baseline and rebaseline",
        "ar": "اعتماد خط الأساس وإعادة خط الأساس"
      },
      "maxAmount": null,
      "currency": "SAR",
      "unitScale": 1,
      "withinCommitteeAuthority": true,
      "escalateTo": "Not applicable — within committee authority (demo)"
    },
    {
      "key": "change_request_budget",
      "name": {
        "en": "Approve a change request with budget impact",
        "ar": "اعتماد طلب تغيير له أثر على الميزانية"
      },
      "maxAmount": "1000000.0000",
      "currency": "SAR",
      "unitScale": 1,
      "withinCommitteeAuthority": true,
      "escalateTo": "Delegating authority — to be confirmed"
    },
    {
      "key": "separation_spend_commitment",
      "name": {
        "en": "Approve a separation spend commitment",
        "ar": "اعتماد التزام إنفاق على الفصل"
      },
      "maxAmount": "5000000.0000",
      "currency": "SAR",
      "unitScale": 1,
      "withinCommitteeAuthority": true,
      "escalateTo": "Delegating authority — to be confirmed"
    },
    {
      "key": "gate_decision_operational",
      "name": {
        "en": "Approve passage of gates G1–G4 and G7",
        "ar": "اعتماد اجتياز البوابات من الأولى إلى الرابعة والسابعة"
      },
      "maxAmount": null,
      "currency": "SAR",
      "unitScale": 1,
      "withinCommitteeAuthority": true,
      "escalateTo": "Not applicable — within committee authority (demo)"
    },
    {
      "key": "day1_go_no_go",
      "name": {
        "en": "Day-1 go/no-go decision",
        "ar": "قرار المضي أو عدمه لليوم الأول"
      },
      "maxAmount": null,
      "currency": "SAR",
      "unitScale": 1,
      "withinCommitteeAuthority": true,
      "escalateTo": "Not applicable — within committee authority (demo)"
    },
    {
      "key": "tsa_approval_or_extension",
      "name": {
        "en": "Approve a TSA or a TSA extension",
        "ar": "اعتماد اتفاقية خدمات انتقالية أو تمديدها"
      },
      "maxAmount": "2000000.0000",
      "currency": "SAR",
      "unitScale": 1,
      "withinCommitteeAuthority": true,
      "escalateTo": "Delegating authority — to be confirmed"
    },
    {
      "key": "partner_outreach_and_access",
      "name": {
        "en": "Approve partner outreach and materials access",
        "ar": "اعتماد التواصل مع الشريك ومنحه الوصول إلى المواد"
      },
      "maxAmount": null,
      "currency": "SAR",
      "unitScale": 1,
      "withinCommitteeAuthority": true,
      "escalateTo": "Not applicable — within committee authority (demo)"
    },
    {
      "key": "criterion_waiver",
      "name": {
        "en": "Approve a waiver of a waivable gate criterion",
        "ar": "اعتماد الإعفاء من معيار بوابة قابل للإعفاء"
      },
      "maxAmount": null,
      "currency": "SAR",
      "unitScale": 1,
      "withinCommitteeAuthority": true,
      "escalateTo": "Not applicable — within committee authority (demo)"
    },
    {
      "key": "preferred_partner_selection",
      "name": {
        "en": "Select the preferred partner",
        "ar": "اختيار الشريك المفضل"
      },
      "maxAmount": null,
      "currency": "SAR",
      "unitScale": 1,
      "withinCommitteeAuthority": false,
      "escalateTo": "Board of Directors — to be confirmed"
    },
    {
      "key": "valuation_and_ownership_terms",
      "name": {
        "en": "Approve valuation and ownership terms",
        "ar": "اعتماد التقييم وشروط الملكية"
      },
      "maxAmount": null,
      "currency": "SAR",
      "unitScale": 1,
      "withinCommitteeAuthority": false,
      "escalateTo": "Board of Directors — to be confirmed"
    },
    {
      "key": "jv_signing_authorization",
      "name": {
        "en": "Authorize JV signing",
        "ar": "تفويض توقيع المشروع المشترك"
      },
      "maxAmount": null,
      "currency": "SAR",
      "unitScale": 1,
      "withinCommitteeAuthority": false,
      "escalateTo": "Board of Directors — to be confirmed"
    },
    {
      "key": "jv_closing_confirmation",
      "name": {
        "en": "Confirm a JV closing",
        "ar": "تأكيد إتمام المشروع المشترك"
      },
      "maxAmount": null,
      "currency": "SAR",
      "unitScale": 1,
      "withinCommitteeAuthority": false,
      "escalateTo": "Board of Directors — to be confirmed"
    },
    {
      "key": "opening_balance_sheet",
      "name": {
        "en": "Approve the opening balance sheet",
        "ar": "اعتماد الميزانية الافتتاحية"
      },
      "maxAmount": null,
      "currency": "SAR",
      "unitScale": 1,
      "withinCommitteeAuthority": false,
      "escalateTo": "NewCo board / authorized finance approver — to be confirmed"
    },
    {
      "key": "charter_amendment",
      "name": {
        "en": "Amend the committee charter or delegation",
        "ar": "تعديل ميثاق اللجنة أو تفويضها"
      },
      "maxAmount": null,
      "currency": "SAR",
      "unitScale": 1,
      "withinCommitteeAuthority": false,
      "escalateTo": "Delegating authority — to be confirmed"
    }
  ],
  "selfApprovalProhibited": true,
  "recusedMembersExcludedFromQuorum": true
};
