# Frontend Technical Brief
## Cross-Border Medical Referral Platform (Libya–Tunisia Corridor)

**Audience:** Internal development team
**Scope:** Frontend requirements only. Backend architecture, infrastructure, and database design are explicitly out of scope for this document.
**Status:** V0 is built and live. This brief documents and confirms V0's existing functional scope, and sets requirements/priorities for what comes next. Where a requirement describes something already shipped in V0, it is marked accordingly.

---

## 1. Purpose

This brief defines the frontend functional requirements for the platform, organized by module, with priority levels (P0/P1/P2) to guide sequencing. It is meant to align the dev team on what the interface needs to do — not how the backend is built, and not the underlying data model.

Use this document to:
- Confirm what V0 already covers.
- Scope what's still missing before the next milestone.
- Give a shared reference for priority when trading off scope vs. timeline.

---

## 2. Platform Context (for orientation, not a spec)

The platform connects Libyan clinics, laboratories, and doctors with Tunisian healthcare providers, replacing informal/ad-hoc referral arrangements with a structured, trackable process. Users are medical **organizations and professionals**, not patients directly. The platform also functions as a day-to-day case/practice management tool for clinic staff, independent of whether a given case is cross-border.

Three revenue mechanisms exist (coordination fee per completed case, SaaS subscription, and a housing/logistics line) — these are business-model context, not frontend requirements, but they explain why billing and case status both need to be clearly visible to non-technical clinic staff.

---

## 3. Users & Roles

At minimum, the frontend must support distinct experiences for:

- **Provider users** (Libyan clinics/labs/doctors, Tunisian clinics/labs/doctors) — case submission, case tracking, messaging, file exchange, billing view, practice management.
- **Internal admin/ops users** — case pipeline oversight, provider directory management, ledger oversight. Not the same sign-up/verification path as providers.

Provider and admin are **separate sign-up and verification flows**, not role toggles on a shared flow. Do not merge these into one onboarding form gated by a role dropdown — the verification requirements and trust level differ enough that they should be structurally separate flows.

---

## 4. Cross-Cutting Principles (apply to every module below)

These aren't a module — they're constraints that shape how every module gets built.

### 4.1 Design & UX: credibility over cleverness
This is medical infrastructure handling real patient data, used by non-technical clinic staff. The interface should read as calm, professional, and precise — not flashy. Concretely:
- Prefer clear labels and explicit states over icon-only or gesture-based UI.
- Avoid ambiguous or playful microcopy in anything touching case status, files, or money.
- Every screen a provider lands on should make it obvious what state something is in and what to do next, without needing to contact support.

### 4.2 Internationalization (i18n)
- Minimum supported languages: **Arabic and French** for provider-facing UI, **English** for admin/internal use.
- Architecture must support adding languages later (planning for eventual European expansion) — i18n should be a proper framework (e.g., externalized string catalogs, not hardcoded text), not a retrofit.
- Arabic requires **RTL layout support**, not just translated strings. Confirm this is handled at the layout/component level, not per-page patches.
- Mixed-direction content should be expected (e.g., Arabic UI with French medical terminology or Latin-script case references) — verify components handle bidi text gracefully.

### 4.3 Scalability beyond the Libya–Tunisia corridor
"Corridor" (i.e., a source-country ↔ destination-country pairing) must be treated as a **configurable concept** in the frontend, not hardcoded logic. Concretely:
- No UI copy, routing, or business logic should assume Libya/Tunisia specifically as constants.
- Country/corridor-specific fields (e.g., document requirements, licensing bodies) should be data-driven rather than conditionally coded per country.
- This matters most in: case submission forms, provider verification, and any corridor-specific compliance messaging.

### 4.4 Security & data protection (frontend-relevant scope)
Full security architecture is a backend concern, but the frontend has direct obligations:
- No caching of medical files/imaging in a way that persists beyond the session (e.g., browser storage) — files should not linger client-side after the session ends.
- Enforce role-based UI: a user should never see a UI affordance (button, link, visible data field) for an action their role isn't authorized for, even if the backend would also reject it. Defense in depth, not reliance on hiding as the only control.
- Session timeout / re-authentication for sensitive actions (viewing imaging, downloading files) should be visible and predictable to the user, not silent.
- Any audit-relevant action (file access, file modification, case status change) needs to be surfaced back to the user where relevant (e.g., "last accessed by Dr. X on [date]") — this is a UI requirement even though the audit log itself is backend.

### 4.5 Responsive design
Desktop and mobile both need to be fully functional, not mobile-as-afterthought. Clinic staff will plausibly check case status or messages from a phone between patients. Priority for mobile: case status visibility, messaging/notifications, and basic case submission. Heavier tasks (bulk file upload, ledger review) can be desktop-optimized first if a tradeoff is needed.

---

## 5. Functional Requirements by Module

Priority key: **P0** = required for a usable core product · **P1** = needed soon after, not launch-blocking · **P2** = valuable but deferrable.

### 5.1 Authentication & Onboarding
| Requirement | Priority |
|---|---|
| Separate sign-up/verification flow for providers vs. internal admin | P0 |
| Provider verification flow collects credentials/licensing info needed to establish trust (fields data-driven per corridor, per §4.3) | P0 |
| Clear pending/approved/rejected status shown to the provider during verification, with no need to contact the platform team to check status | P0 |
| Password reset / account recovery flow | P0 |
| Multi-language onboarding (Arabic/French at minimum) | P0 |
| Admin-side provider approval queue (ties into Admin Dashboard, §5.8) | P0 |

### 5.2 Case Submission
| Requirement | Priority |
|---|---|
| Structured intake form (not free text) capturing case details needed for matching | P0 — *confirm V0 scope* |
| Attachment of medical files and imaging as part of submission | P0 — *confirm V0 scope* |
| Client-side validation on required fields and file types/sizes before submission | P0 |
| Submission confirmation screen showing a **case reference number** | P0 — *confirm V0 scope* |
| Draft-saving (submit partially, come back later) | P1 |
| Corridor-aware field variation (per §4.3) rather than hardcoded Libya/Tunisia fields | P1 |
| Bulk/multi-case submission for high-volume clinics | P2 |

### 5.3 Matching & Case Pipeline / Status Tracking
| Requirement | Priority |
|---|---|
| Visible pipeline showing case status, accessible to both matched sides without contacting the other party or the platform team | P0 — *confirm V0 scope* |
| Clear, unambiguous status labels (e.g., submitted → under review → matched → in progress → completed) shown consistently across provider and admin views | P0 |
| Status change history/timeline per case | P1 |
| Filtering/search across a provider's own case list (by status, date, reference number) | P1 |
| In-pipeline indication of what action (if any) is expected from the provider next | P1 |

### 5.4 Secure Medical File & Imaging Transfer
| Requirement | Priority |
|---|---|
| Upload/download UI for medical files and imaging (MRI, CT, etc.) tied to a specific case | P0 — *confirm V0 scope* |
| Encryption in transit (TLS) — frontend must not introduce any path that bypasses this (e.g., no direct unauthenticated links to files) | P0 |
| Role-based access control reflected in UI — only authorized parties for a given case see its files | P0 |
| Visible audit trail per file: who accessed/modified it and when, shown to authorized users | P1 |
| Large file / imaging upload progress and resumability (imaging files can be large) | P1 |
| In-browser preview for common medical image formats where feasible, vs. forcing download | P2 |

### 5.5 Practice / Case Management
| Requirement | Priority |
|---|---|
| Day-to-day workspace for clinic staff to manage dates, files, and tasks tied to their cases (usable even for non-cross-border cases, per the SaaS positioning) | P0 — *confirm V0 scope* |
| Calendar/scheduling view for appointments tied to cases | P1 |
| Task/reminder surface for pending actions across a provider's caseload | P1 |
| Team/multi-seat access within a single clinic account (if clinics have multiple staff logging in) | P1 |

### 5.6 Messaging & Notifications
| Requirement | Priority |
|---|---|
| Case-level notifications (status changes, new messages, new files) | P0 |
| Direct messaging between matched providers, scoped to a case | P0 — *confirm V0 scope* |
| In-app notification center (not email-only) | P1 |
| Read/unread and delivery indicators on messages | P1 |
| Notification preferences (channel, frequency) per user | P2 |

### 5.7 Billing, Ledger & Settlement
| Requirement | Priority |
|---|---|
| Auditable ledger view per provider account, showing transaction history | P0 |
| Clear separation in the UI between **coordination fees** (per completed case) and **SaaS subscription charges** — these should never be visually merged into one ambiguous "amount owed" line | P0 |
| Per-case fee breakdown, linked back to the relevant case reference | P1 |
| Downloadable/exportable statements (e.g., PDF or CSV) for provider accounting | P1 |
| Multi-currency display (USD/EUR, per the SaaS pricing model) | P1 |
| Payment status indicators (paid, pending, overdue) | P1 |

### 5.8 Admin / Ops Dashboard
| Requirement | Priority |
|---|---|
| Case pipeline overview across all providers (not just single-case view) | P0 |
| Provider directory management, including the verification/approval queue from §5.1 | P0 |
| Ledger oversight across all provider accounts | P0 |
| Search/filter across cases and providers | P1 |
| Manual case status override / intervention tools for ops staff | P1 |
| Basic operational reporting (volume, conversion, corridor breakdown) | P2 |

---

## 6. Out of Scope for This Brief

Explicitly not covered here — these belong in separate technical documentation:
- Backend service architecture
- Infrastructure / hosting / deployment
- Database schema and data modeling
- Detailed security architecture beyond the frontend-facing obligations in §4.4 (e.g., encryption-at-rest implementation, key management)

---

## 7. Open Items for the Dev Team

Several P0/P1 rows above are marked *"confirm V0 scope"* — these describe functionality the platform is understood to already have live. Before estimating remaining work, the team should audit V0 against this brief and mark each such row as:
- **Confirmed shipped** — matches this spec as-is
- **Partially shipped** — shipped but missing part of the stated requirement (note the gap)
- **Not yet shipped** — treat as net-new work

This audit should happen before sprint planning against this brief, so remaining effort is scoped against reality rather than assumption.

---

## 8. Glossary

- **Corridor** — a configurable source-country ↔ destination-country pairing (e.g., Libya→Tunisia today). Not to be hardcoded.
- **Case** — a single patient referral instance moving through the platform's pipeline, from submission to completion.
- **Provider** — a clinic, laboratory, or doctor using the platform (Libyan or Tunisian side).
- **Coordination fee** — the per-completed-case fee, distinct from SaaS subscription charges.
