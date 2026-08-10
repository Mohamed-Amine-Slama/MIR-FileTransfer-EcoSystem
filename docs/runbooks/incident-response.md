# Incident response runbook

**BUILD_SPEC P15.3.**

> **Status: written, NOT exercised.** P15.3 requires a tabletop exercise of a
> suspected unauthorized access to one patient's study, with gaps logged and
> fixed. That has not happened. A runbook nobody has walked through is a
> document, not a capability.

---

## 0. Before anything else

**Preserve evidence. Do not "clean up".**

The instinct on discovering unauthorized access is to revoke, delete, and
tidy. Resist it for the first ten minutes. Deleting an attacker's session,
rotating a key, or dropping a database user destroys the record of what they
did — and you will need that record for the breach-notification decision
(**L8**), which has a legal deadline.

Take a snapshot first. Then contain.

---

## Severity levels

| Sev | Definition | Response | Comms |
|---|---|---|---|
| **SEV-1** | Confirmed unauthorized access to patient imaging, or loss of originals | Immediate, all hands | Counsel within 1h; regulator clock starts |
| **SEV-2** | Suspected unauthorized access; audit anomaly unexplained | Within 1 hour | Counsel notified, standing by |
| **SEV-3** | Service unavailable; uploads failing platform-wide | Within 1 hour, business hours+ | Status page |
| **SEV-4** | Degraded (slow viewer, delayed notifications) | Next business day | Internal only |

**When unsure, treat as SEV-2.** The cost of over-classifying is an hour of
someone's time. The cost of under-classifying is missing a notification
deadline.

---

## First hour — suspected unauthorized access to a patient's study

### 1. Establish what is actually known (10 min)

The audit log is the source of truth. It is append-only and archived to an
Object Lock bucket, so it can be trusted even if the database is suspect.

```sql
-- Everything this actor touched, most recent first.
SELECT occurred_at, action, subject_id, patient_id, ip_address, user_agent,
       metadata->>'granted' AS granted
FROM audit_events
WHERE actor_id = :actor
ORDER BY occurred_at DESC
LIMIT 500;

-- Everyone who has ever touched this patient.
SELECT occurred_at, actor_id, actor_role, action, ip_address,
       metadata->>'granted' AS granted
FROM audit_events
WHERE patient_id = :patient
ORDER BY occurred_at;

-- Denied attempts are the reconnaissance signal — look here first.
SELECT actor_id, count(*), min(occurred_at), max(occurred_at)
FROM audit_events
WHERE action = 'StudyAccessed' AND metadata->>'granted' = 'false'
  AND occurred_at > now() - interval '7 days'
GROUP BY actor_id ORDER BY 2 DESC;
```

Record: **who, what, when, from where, how many distinct patients.**

### 2. Contain (15 min)

In this order:

1. **Disable the account** in Keycloak (do not delete — deletion destroys the
   session record).
2. **Revoke sessions**: Keycloak → realm → Sessions → sign out the user.
   Access tokens are 5 minutes, so this takes effect almost immediately.
3. **Do not rotate `SIGNED_URL_SECRET` yet** unless signed URLs are implicated.
   Rotating invalidates every in-flight image request and will look like an
   outage to every doctor mid-consultation.
4. If the application role itself is suspect, revoke its login:
   `ALTER ROLE mir_app NOLOGIN;` — this is a full outage. SEV-1 only.

### 3. Assess scope (20 min)

- How many **distinct patients** appear in that actor's `StudyAccessed` rows?
- Were the accesses **granted** or **denied**? Denied-only means attempted, not
  achieved — materially different for notification purposes.
- Did they retrieve **pixel data** or only **metadata**? `metadata->>'accessKind'`.
- Was consent valid for each? Cross-check `consent_records`.

### 4. Decide on notification (with counsel)

**Assume 72 hours (GDPR Article 33).** The entity is Estonian, so GDPR applies
directly and the supervisory authority is the Estonian **Andmekaitse
Inspektsioon (AKI)**. The clock starts when the controller becomes *aware* of
the breach, not when the investigation concludes.

**L8 remains open only in one direction:** whether Libya or Tunisia imposes
anything *stricter or additional*. Do not wait for that answer before starting
the 72-hour clock.

Health imaging is Article 9 special-category data, so where the breach is
likely to result in high risk, Article 34 also requires notifying the affected
individuals **without undue delay** — not only the regulator.

Inputs counsel needs: number of data subjects, categories of data (medical
imaging = special category), whether access was achieved or attempted,
whether data left the platform, and the time of discovery.

---

## Loss or corruption of originals

**This is the worst case.** Object Lock in compliance mode means originals
cannot be deleted for the retention period, so genuine loss should be
impossible — which makes any apparent loss a sign that a control failed.

1. Do NOT re-upload or "regenerate" anything. Establish first whether the
   object exists in the DR region replica.
2. `aws s3api head-object --bucket <replica> --key <key> --region eu-west-3`
3. If present, the primary has a read or replication problem, not a data loss.
4. If absent from both, escalate to SEV-1 and check whether the object was ever
   written: `imaging_instances` has the storage key and SHA-256.
5. A row with no object means the ingestion pipeline wrote the row without the
   object — which the ordering in `IngestionService` is specifically designed
   to prevent. Treat as a code defect and stop uploads.

---

## Communication templates

### To an affected patient (SEV-1, after counsel approves)

> We are contacting you about your medical imaging held by [platform].
>
> On [date] we identified that [description of access]. The information
> involved was [categories]. We have [containment actions].
>
> What this means for you: [plain language].
> What we are doing: [remediation].
> Who to contact: [name, phone, email].
>
> You may also contact [regulator] .

**Rules.** Plain Arabic and French. No jargon. Do not minimise. Do not say
"we take your privacy seriously". State what happened and what you are doing.

### To the referring doctor

Factual, same day. They have a relationship with the patient and will be asked
about it.

### Public statement

Only if the incident is public or affects many patients. Never before affected
individuals are notified.

---

## Roles

| Role | Responsibility |
|---|---|
| **Incident lead** | Owns the timeline and the decision to escalate. One person. |
| **Technical lead** | Containment and scope. Does not talk to press or patients. |
| **Legal** | Notification decision, regulator contact. Engaged at SEV-2+. |
| **Communications** | Patient and doctor contact, once legal approves. |

On-call rotation: **not yet established.** P13 requires alerts to reach a human
who is on call; that is an open pre-launch item.

---

## After the incident

Within five working days:

1. **Timeline** — discovery, containment, resolution, with timestamps.
2. **Root cause** — technical and organisational. Not "human error"; ask why
   the system allowed it.
3. **What the controls did** — which caught it, which should have, which were
   noise.
4. **Actions** with owners and dates.
5. **Update this runbook.** Every incident reveals a step that was wrong or
   missing.

Blameless. The person who clicked the phishing link is not the problem; the
system that let one click reach patient imaging is.

---

## Tabletop exercise (P15.3 — REQUIRED, NOT DONE)

Run this scenario with the team, timed:

> A Tunisian doctor reports that a colleague mentioned details of a patient
> the colleague has no appointment with. The colleague's account shows 60
> `StudyAccessed` rows in the last week, 45 of them denied.

Assess: does the team find the audit query? Do they preserve before
containing? Do they reach counsel within the SEV-2 window? Who decides
notification?

Log every gap. Fix them. Then re-run.
