# Mobily Transformation Hub: user guide

This guide is for the people who run transformations in the platform: sponsors, transformation leads, owners, analysts and reviewers. It describes the screens of this release as they are built. The Arabic version, `../ar/user-guide.md`, has the same sections and anchors.

- The brand colour and the wordmark in the header are **provisional**. They are not a verified Mobily brand.
- The methodology is the Business Transformation Playbook v1.0, a practical synthesis inspired by PMI, Brightline and BRM practice with its own extensions. It is not an official PMI standard, and this product is not a certified product.
- Any sample data you see in a demonstration installation is **synthetic** and is labelled that way.

## Signing in and the screen layout {#sign-in}

1. Open the platform's address. The sign-in page (`/login`) shows **Sign in with corporate account**. You are redirected to your organization's identity provider and come back signed in.
2. If sign-in fails, the page says why. For example, "Your account is not set up in this product yet. Contact an access administrator." or "Your session ended. Please sign in again." An account moved from another installation that is not linked yet shows "Your account was moved from another installation and is not linked to your corporate sign-in yet. Contact your IT administrator."
3. Sign-in has been tested only with a synthetic identity provider. Connecting the corporate identity provider is an external dependency.

**Layout.**

- The header holds the wordmark, the **Search records** box, the language switch, your name and organization, and **Sign out**.
- The side navigation lists the areas you may open. An area you have no right to is not shown. If you open a page anyway, it says "You do not have access".

**Language.**

- The language switch in the header, labelled with the name of the other language, changes the whole interface between Arabic, right to left, and English, left to right. Your choice is saved to your profile.
- If saving fails, a note says that the change applies in this browser only for now.
- Dates use the Asia/Riyadh time zone and amounts use SAR by default. Both are configurable by an administrator.

## My work {#my-work}

**My Work** (`/my-work`) is your starting page: assigned actions, drafts, reviews, approvals, missing updates and upcoming deadlines.

| Page | Path | What you do there |
| --- | --- | --- |
| Tasks and inbox | `/my-work` | Open your tasks and in-app notifications |
| Approvals | `/my-work/approvals` | Decide the approvals routed to you |
| Drafts | `/my-work/drafts` | Return to work you saved but did not submit |
| Delegations | `/my-work/delegations` | Hand your approvals to a colleague for a period |
| Notification preferences | `/my-work/notification-preferences` | Choose which optional channels notify you |

- A draft is labelled **Draft – not submitted**. Saving a draft (**Save draft**) never submits it and never approves anything.
- If someone else changed a record while you edited it, the page shows "Someone else changed this record". Reload, review their change, and apply yours again. Your change is not saved over theirs silently.

## A transformation journey: six phases and gates G1–G6 {#journey}

Open **Transformations** (`/transformations`) and pick a transformation (`/transformations/:id`). A new transformation starts at `/transformations/new`.

**The six phases.** Each phase has its own workspace page:

| Phase | Path |
| --- | --- |
| Diagnose | `/transformations/:id/diagnose` |
| Define | `/transformations/:id/define` |
| Design | `/transformations/:id/design` |
| Mobilize | `/transformations/:id/portfolio`, `/transformations/:id/roadmap` |
| Transform | `/transformations/:id/workstreams`, `/transformations/:id/raid` |
| Realize | `/transformations/:id/benefits`, `/transformations/:id/bau` |

The phase overview (`/transformations/:id/phases`) shows where the transformation stands.

**Stage gates G1–G6.** The gates follow the playbook's stage gates (B0023):

- G1 Case for Change
- G2 Direction
- G3 Target State
- G4 Mobilization
- G5 Scale
- G6 Sustain

They are listed at `/transformations/:id/gates`, and each gate has its own page (`/transformations/:id/gates/:gateCode`).

- A gate decision is a **business approval inside the product**. It is taken by the approver configured for that gate, with a mandatory rationale. The rationale is recorded with the approver's name, the submission number and the time.
- Gate states are Not submitted, Submitted, Under review, Changes requested, Approved, Rejected and Deferred. Each is shown with a text label.
- A gate decision approves only the business step it names. It is not an IT, Finance or engineering approval of the platform. Gate G6 says nothing about the platform's own delivery or release.

## Evidence {#evidence}

- Each transformation has an evidence page (`/transformations/:id/evidence`) and an evidence register (`/transformations/:id/evidence-register`). The register across transformations is at `/evidence-reports/evidence-register`.
- You attach a file or link it to the record, deliverable or gate it supports. The upload policy set by an administrator decides the allowed file types and sizes. A refused file is explained on the page.
- A sensitive item is hidden from people without an explicit grant. Totals still include it, labelled "Includes restricted records".
- Reports and snapshots (`/evidence-reports/reports`) and exports (`/evidence-reports/exports`) build packs from saved data. A snapshot is a record of that moment and does not change afterwards.

## KPIs and benefits {#kpis-benefits}

- **KPIs.** The KPIs of a transformation are at `/transformations/:id/kpis`. A KPI's actuals are at `/transformations/:id/kpis/:kpiId/actuals`. The cross-transformation KPI view is at `/strategy-kpis/kpis`.
- **Unknown and Stale.** A KPI without data shows **Unknown**. A KPI whose data is older than its expected update shows **Stale**. Neither is ever shown as zero or as on track. Status always has a text label (On track, At risk, Off track, Unknown, Stale), not only a colour.
- **Benefits.** The benefits register of a transformation is at `/transformations/:id/benefits`, and the register across transformations at `/benefits-finance/benefits`. Benefit formulas (`/transformations/:id/benefit-formulas`) compute values with decimal arithmetic. Amounts are in SAR by default.
- **Finance validation.** Finance validation (`/transformations/:id/finance-validations`) records the decision of the Finance role inside the product. A validation whose record changed afterwards is shown as "Validation stale (changed since)".

## Search {#search}

- Type in **Search records** in the header and press **Search**. Results open at `/search`.
- You only see results you may open. A record you have no right to is not listed.
- Lessons have their own search at `/lessons`.

## Notifications {#notifications}

- Every notification arrives in your in-app inbox under **Tasks and inbox** (`/my-work`). The inbox always receives every notification.
- Optional channels, such as email or enterprise messaging, are set up by an administrator. Each is off until it is configured. Choose yours in **Notification preferences** (`/my-work/notification-preferences`).
- A digest you receive opens at `/me/notification-digests/:digestId`.
- Read notifications may be archived by the retention settings of your installation. An archived notification can no longer be marked unread. See the administrator guide, section "Retention".

## When something is not available {#states}

| What you see | What it means |
| --- | --- |
| "You do not have access" | Your roles do not allow this page or action. Ask an access administrator. |
| "Something went wrong" | The request failed. Try again; if it persists, tell your administrator. |
| "This information may be out of date" | The data shown is not current. The last update time is shown when it is known. |
| "Unknown" | No value is available. It is not zero. |
| A page saying a screen is not available yet | The screen is not part of this release. |
