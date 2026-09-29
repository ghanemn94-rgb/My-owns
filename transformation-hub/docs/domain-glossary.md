# Domain Glossary (English / Arabic)

# مسرد المصطلحات (إنجليزي / عربي)

> **Status: proposed (P0).** Consistent terminology for the Arabic (RTL) and English (LTR) interfaces, the i18n message
> files and the documentation. Code and technical field names stay in English. Abbreviations that are unclear in the
> source (ATA, MSA, CST, DCCo) are kept as written; any expansion shown is marked **(proposed expansion — to be
> confirmed)** and must not be displayed in the product as if confirmed.
>
> **RAG** in this product means the **red / amber / green status** indicator. Retrieval-augmented generation (the AI
> technique) is always written **RAG (retrieval)** to avoid confusion.

## 1. Transaction and carve-out (الصفقة والفصل)

| English term | Arabic term | Definition |
|---|---|---|
| Carve-out | فصل الأعمال | Separating a business (here, data center activities) from the parent so it can operate as a standalone entity or be contributed to a transaction |
| Transaction perimeter | نطاق الصفقة | The complete set of items in scope of the separation: assets, liabilities, receivables/payables, contracts, employees, data, IP, licences, financing, guarantees and shared services — not only physical assets |
| Included / Excluded / Shared / Pending | مشمول / مستبعد / مشترك / معلّق | Perimeter classification of an item: transfers, stays, is used by both sides, or is not yet decided |
| Perimeter reconciliation | مطابقة النطاق | Check that every Included or Shared item has a transfer plan, agreement and evidence; lists exceptions |
| Transfer mechanism | آلية النقل | How an item moves: transfer, lease, licence, consent, novation, assignment or interim arrangement (specialist-assessed) |
| Legal owner / operator / economic beneficiary | المالك القانوني / المشغّل / المستفيد الاقتصادي | The three roles tracked per perimeter item, which may differ during transition |
| NewCo | الشركة الجديدة | The standalone company established or prepared to receive the perimeter |
| DCCo | DCCo | Abbreviation in the source, possibly the NewCo; "Data Center Company" (proposed expansion — to be confirmed) |
| Legal entity | الكيان القانوني | A registered company; kept separate from a project, and may take part in several projects |
| Incorporation | التأسيس | Legal establishment of NewCo, evidenced by verified documents; tracked as its own status dimension |
| Status dimension | بُعد الحالة | One of four independent status tracks: incorporation, perimeter transfer, operational readiness, JV signing/closing |
| Standalone operation | التشغيل المستقل | NewCo operating under the approved model, possibly still with approved transitional or enduring arrangements |
| Operational independence | الاستقلال التشغيلي | Independence as defined and approved for the program; does not require eliminating every shared service |
| Interim arrangement | ترتيب مؤقت | Approved temporary arrangement (e.g. when a contract cannot transfer on Day 1) with accountability and an end condition |
| Enduring arrangement | ترتيب دائم | Approved long-term shared service that remains part of the definition of independence |
| Joint venture (JV) | المشروع المشترك | The entity or arrangement formed with a partner after or alongside the carve-out |
| Shareholders' agreement | اتفاقية المساهمين | Agreement governing ownership and governance of the JV |
| Ownership scenario | سيناريو الملكية | Versioned proposal for ownership, capital contribution and governance; no percentage is assumed |
| TOM | نموذج التشغيل المستهدف | Target Operating Model: how NewCo will operate |
| GTM | الدخول إلى السوق | Go-to-market: products, pricing and market plan |

## 2. Agreements, TSA and consents (الاتفاقيات والخدمات الانتقالية والموافقات)

| English term | Arabic term | Definition |
|---|---|---|
| TSA | اتفاقية الخدمات الانتقالية | Transitional Services Agreement: a provider supplies services to the recipient for a limited period after separation |
| TSA exit | الخروج من الخدمة الانتقالية | Ending a transitional service after the replacement service is accepted with evidence; reaching the end date is not an exit |
| Replacement service | الخدمة البديلة | The service that takes over from a TSA service |
| TSA extension | تمديد الخدمة الانتقالية | Extending a TSA; only by an approved decision, never automatically |
| ATA | ATA | Agreement abbreviation in the source; "Asset Transfer Agreement" (proposed expansion — to be confirmed) |
| MSA | MSA | Agreement abbreviation in the source; "Master Services Agreement" (proposed expansion — to be confirmed) |
| CST | CST | Abbreviation in the source relating to regulatory requirements; "Communications, Space and Technology Commission" (proposed expansion — to be confirmed). Applicability of any requirement is specialist-assessed |
| Agreement register | سجل الاتفاقيات | Register of agreements with parties, versions, negotiation stage, obligations, dates and executed copies |
| Consent | الموافقة | Counterparty agreement required before a contract can transfer |
| Novation | الحوالة (حوالة العقد) | Replacing a party to a contract with a new party, with all parties' agreement |
| Assignment | التنازل عن العقد | Transfer of rights (and, where permitted, obligations) under a contract to another party |
| Contract transfer classification | تصنيف قابلية نقل العقد | Transferable / consent required / novation required / retain / interim arrangement / unknown — based on specialist assessment |
| Applicability assessment | تقييم الانطباق | Specialist determination of whether a licence, approval or control applies; the platform records it and makes no determination |

## 3. Finance and valuation (المالية والتقييم)

| English term | Arabic term | Definition |
|---|---|---|
| Carve-out financial statements | القوائم المالية للفصل | Financial statements prepared for the separated business; approved only after human financial validation |
| Opening balance sheet | الميزانية الافتتاحية | NewCo's starting balance sheet where required; approved only after human financial validation |
| Human financial validation | التحقق المالي البشري | Documented review and approval by an authorized finance approver; never automated |
| Intercompany balances | الأرصدة البينية | Balances between the retained business and NewCo, reconciled and settled under an agreed mechanism |
| Working capital | رأس المال العامل | Current operating assets and liabilities, with cut-off rules at transfer |
| One-off separation costs | تكاليف الفصل لمرة واحدة | Costs incurred once to separate |
| Recurring standalone costs | التكاليف المتكررة للتشغيل المستقل | Ongoing costs of operating NewCo on its own |
| Stranded costs | التكاليف العالقة | Costs that remain with the parent after separation without the related business |
| Committed vs spent | الملتزم به مقابل المصروف | Commitments (e.g. purchase orders) tracked separately from actual spend |
| Enterprise value | قيمة المنشأة | Value of the business operations before financing; not to be confused with equity value |
| Equity value | قيمة حقوق الملكية | Value attributable to shareholders |
| Business plan | خطة العمل | Versioned plan with base, downside and upside cases and sourced assumptions |
| Valuation reference | مرجع التقييم | A value from a source (book value, commissioned valuation); the platform does not perform professional valuation |
| Benefits register | سجل المنافع | Register of benefits with measurement definition, baseline, target, owner, realization date and verification source |
| Zakat | الزكاة | Religious levy assessed on eligible entities; implications are specialist-assessed |
| Money value | القيمة النقدية | Decimal amount with ISO currency and unit scale; different currencies or units are never aggregated without a conversion basis |

## 4. Partner process, JV signing and closing (عملية الشريك والتوقيع والإتمام)

| English term | Arabic term | Definition |
|---|---|---|
| Partner longlist / shortlist | القائمة الطويلة / المختصرة للشركاء | Candidate partners assessed against approved criteria and weights; no default real names |
| Approved for contact | معتمد للتواصل | Partner stage after outreach approval; required before any contact |
| NDA | اتفاقية عدم الإفصاح | Non-disclosure agreement; does not by itself grant access to materials |
| Materials access | الوصول إلى المواد | Separately approved, scoped and time-limited access to documents for a partner |
| VDR | غرفة البيانات الافتراضية | Virtual data room with index, permissions, classification, versions, access log and disclosure history |
| Clean team | الفريق النظيف | Restricted group allowed to see competitively sensitive information |
| Due diligence (DD) | الفحص النافي للجهالة | Investigation of the business by the partner (or vendor) before the transaction |
| DD finding | نتيجة الفحص | Issue found in diligence, with materiality, risk, remediation and valuation/document/CP implications |
| Materiality | الأهمية النسبية | Significance of a finding for the transaction decision |
| Negotiation issue | قضية تفاوض | Open term with parties' positions, alternatives, required approval and status |
| Signing | التوقيع | Execution of the transaction agreements; tracked separately from closing |
| Closing | الإتمام | Completion of the transaction after conditions are satisfied; requires authorized confirmation |
| Multiple closings | الإتمامات المتعددة | Transaction completed in more than one closing, each with its own CPs, checklist and confirmation |
| Condition precedent (CP) | الشرط المسبق | Condition that must be satisfied or validly waived before a closing |
| Condition subsequent (CS) | الشرط اللاحق | Obligation to be fulfilled after closing |
| Long-stop date | التاريخ النهائي لاستيفاء الشروط | Date by which CPs must be satisfied or waived, after which rights under the agreement may arise |
| Funds flow | تدفقات الأموال | Statement of payments at closing; tracked, never executed by the platform |
| 100-day plan | خطة المئة يوم | Post-close plan covering governance, integration actions, reporting and early risks |

## 5. Governance and decisions (الحوكمة والقرارات)

| English term | Arabic term | Definition |
|---|---|---|
| Steering committee | اللجنة التوجيهية | The DC Carve-out & JV Steering Committee; a program body distinct from the NewCo and JV boards |
| Committee charter | ميثاق اللجنة | Document setting purpose, scope, authority, membership and rules of the committee |
| Sponsor | الراعي | Senior role owning the mandate; approves G0 on behalf of the delegating authority |
| Chair | رئيس اللجنة | Role chairing the committee; Role — To be confirmed (never defaulted) |
| Secretary / CPMO | أمين السر / مكتب إدارة المشاريع المؤسسي | Runs the secretariat: screening, packs, minutes, actions |
| Voting member / advisory member | عضو مصوّت / عضو استشاري | Members who vote and count for quorum / members who advise only |
| Delegation of authority | تفويض الصلاحيات | Formal grant of decision power to the committee within limits and validity |
| Authority matrix | مصفوفة الصلاحيات | Machine-readable delegation: decision types, limits, quorum, threshold and tie rule |
| Demo policy | سياسة تجريبية | Synthetic authority policy used only in the sandbox; not Mobily policy |
| Reserved matters | المسائل المحجوزة | Decisions reserved for higher authorities |
| Quorum | النصاب | Minimum eligible voting members required for a valid decision on an item |
| Recusal | التنحي | Withdrawal of a conflicted member from an item: no vote and not counted in quorum |
| Conflict of interest | تعارض المصالح | Situation where a member's interest could affect their judgment on an item |
| Self-approval | الاعتماد الذاتي | Approving one's own request, evidence or action; prohibited |
| Resolution by circulation | القرار بالتمرير | Decision taken by written circulation instead of a meeting |
| Decision paper | ورقة القرار | Paper stating issue, urgency, alternatives, recommendation, impacts, risks, dependencies and latest safe decision date |
| Latest safe decision date | آخر تاريخ آمن لاتخاذ القرار | Last date a decision can be taken without schedule or transaction impact |
| Meeting pack | حزمة الاجتماع | Frozen snapshot of papers issued for a meeting; later changes are new versions |
| Minutes | المحضر | Numbered, versioned record of a meeting; immutable once approved |
| Action | الإجراء | Numbered follow-up item with one owner and a due date, closed only after verification |
| Recommended — pending external authority | توصية — بانتظار الجهة المختصة | Committee outcome for a decision outside its delegation; not a final approval |
| Escalation | التصعيد | Referral to a higher authority with requested action, deadline and options |
| Electronic approval | الاعتماد الإلكتروني | Internal approval record; not a legally certified signature unless an approved solution is integrated |

## 6. Gates, readiness and evidence (البوابات والجاهزية والأدلة)

| English term | Arabic term | Definition |
|---|---|---|
| Gate | البوابة | Business decision point (G0–G7) with criteria, evidence, owner, reviewer, approver and prerequisites |
| Gate criterion | معيار البوابة | Condition assessed for a gate, with mandatory, blocking and waivable flags |
| Mandatory criterion | معيار إلزامي | Must be met, validly waived or determined not applicable for the gate to pass |
| Blocking criterion / blocker | معيار مانع / عائق | Unmet item that forces red status and blocks the gate or go-live |
| Waiver | الإعفاء | Approved exception to a waivable criterion, recording basis, approval and impact |
| Non-waivable | غير قابل للإعفاء | A condition that no exception can override |
| Evidence | الدليل | Document or record supporting a criterion, CP, readiness check or action closure |
| Reopen (controlled reassessment) | إعادة الفتح (إعادة تقييم منضبطة) | Reassessing a criterion after defective or conflicting evidence, preserving prior status and decisions |
| Day 1 | اليوم الأول | First day NewCo operates the perimeter under the new arrangements |
| Readiness checklist | قائمة الجاهزية | Site/workstream checks with mandatory blockers and specialist sign-offs |
| Cutover | الانتقال التشغيلي | Controlled switch of operations, systems or services to the new arrangement |
| Cutover rehearsal | التمرين التجريبي للانتقال | Dry run of the cutover to validate the runbook before go/no-go |
| Runbook | دليل التشغيل | Step-by-step cutover plan with window, owner, communications, tests, contingency and rollback |
| Go/no-go decision | قرار المضي أو عدمه | Authorized decision to proceed with a transition; any open blocker means no-go |
| Rollback | التراجع | Returning to the previous state if a transition fails |
| Hypercare | الدعم المكثف | Period of heightened support after cutover, ending with post-transition acceptance |
| NOC | مركز عمليات الشبكة | Network operations center that monitors services and handles incidents |

## 7. Planning and measurement (التخطيط والقياس)

| English term | Arabic term | Definition |
|---|---|---|
| Workstream | مسار العمل | One of the 12 editable carve-out work areas with objective, RACI, deliverables and linked gates |
| WBS | هيكل تجزئة العمل | Work breakdown structure of activities, milestones and deliverables |
| Milestone | المَعلَم الرئيسي | Zero-duration event marking a key point (e.g. a gate decision) |
| Deliverable | المُخرَج | Output that requires acceptance with evidence |
| Deliverable weight | وزن المُخرَج | Approved weight used for progress so small tasks do not equal critical milestones |
| Baseline | خط الأساس | Approved, frozen version of scope, schedule and budget |
| Rebaseline | إعادة خط الأساس | Approving a new baseline through change control while preserving the previous one |
| Forecast | التوقع | Current expected dates or values, kept separate from baseline and actual |
| Change request | طلب التغيير | Proposal to change scope, time, cost, readiness or transaction terms, with impacts and approval |
| RAID | سجل المخاطر والافتراضات والقضايا والاعتماديات | Register of risks, assumptions, issues and dependencies |
| RAG status | حالة المؤشر (أحمر / كهرماني / أخضر) | Red / amber / green status computed from configurable thresholds; unknown and stale are never green |
| RAG (retrieval) | التوليد المعزز بالاسترجاع | Retrieval-augmented generation, the AI technique; always written with "(retrieval)" |
| Stale data | بيانات متقادمة | Data not updated within the freshness window; shown as stale, never green |
| Manual RAG override | التعديل اليدوي لحالة المؤشر | Override requiring reason, expiry and reviewer; the calculated value is kept |
| Critical path | المسار الحرج | Longest chain of dependent activities that determines the finish date; computed only for supported relationships |
| Float | الفسحة الزمنية | Time an activity can slip without delaying the finish or a constrained date |
| Finish-to-start dependency | اعتمادية النهاية إلى البداية | Successor starts after the predecessor finishes (plus any lag) |
| Lag | الإزاحة الزمنية | Waiting time between linked activities |
| Working calendar | تقويم العمل | Project calendar (default Asia/Riyadh, proposed Sunday–Thursday, editable holidays) |
| Incomplete schedule | جدول غير مكتمل | Status when durations or dependencies are missing; no critical path is claimed |
| Schedule-based forecast | توقع قائم على الجدول الزمني | Date prediction derived from the plan and calendar with stated assumptions; no invented probabilities |
| RACI | مصفوفة المسؤوليات | Responsible / Accountable / Consulted / Informed assignments |
| KPI | مؤشر الأداء الرئيسي | Measure with definition, formula, unit, period, owner, source, target, thresholds and direction |
| Report snapshot | لقطة التقرير | Published report whose figures do not change with later source updates |

## 8. Sources and data quality (المصادر وجودة البيانات)

| English term | Arabic term | Definition |
|---|---|---|
| Source register | سجل المصادر | Register of sources with checksum, dates, location, extracted value, confidence and verification status |
| Verification status | حالة التحقق | Confirmed / Historical-unverified / Proposed / Assumed / Conflicting / Unknown |
| Confirmed | مؤكد | Verified against an approved source |
| Historical-unverified | تاريخي غير متحقق منه | Value reported in an older source, not treated as current status |
| Proposed | مقترح | Suggested by the template or team, pending approval |
| Assumed | مفترض | Working assumption recorded for reversible work |
| Conflicting | متعارض | Sources disagree; requires resolution |
| Demo data | بيانات تجريبية | Synthetic data flagged `is_demo`, badged "Demo" and excluded from actual reporting |
| Information classification | تصنيف المعلومات | Sensitivity level controlling access, search, AI retrieval and exports |
| Role — To be confirmed | الدور — قيد التأكيد | Placeholder used instead of inventing a person |
| Assessment pending — specialist | التقييم معلّق — لدى المختص | Placeholder where a legal, tax, regulatory or accounting determination is required |
