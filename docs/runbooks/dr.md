# Disaster recovery runbook

**BUILD_SPEC P2.5, P15.1, P15.2.**

> **Status: written, NOT exercised. RTO and RPO are UNMEASURED.**
>
> Every number below is a *target*, not an observed value. P2.5 requires the
> observed RTO to be recorded here after a real restore; P15.1 requires the
> drill quarterly. Until someone runs it, this document states intentions.
>
> "An untested backup fails at exactly the wrong moment."

---

## Targets vs. measured

| Scenario | Target RTO | Target RPO | **Measured** |
|---|---|---|---|
| Database failover (AZ loss) | < 2 min | 0 | ⬜ not measured |
| PITR restore | < 2 h | < 5 min | ⬜ not measured |
| Region loss — imaging readable | < 4 h | < 15 min | ⬜ not measured |
| Full region rebuild | < 24 h | < 15 min | ⬜ not measured |

**Do not quote these to a customer or a regulator until the Measured column is
filled in.**

---

## What can and cannot be lost

| Asset | Protection | Recoverable? |
|---|---|---|
| DICOM originals | Object Lock compliance mode, versioned, CRR | **Cannot be deleted.** Genuine loss should be impossible. |
| Database | Multi-AZ, 30-day PITR, cross-region snapshot copies | Yes, to a point in time |
| Derived thumbnails | None needed | Regenerate from originals |
| Orthanc index | None needed | Rebuild by re-STOWing originals |
| Audit log | Append-only + Object Lock archive | Archive survives full DB compromise |

**The asymmetry that drives every decision here:** Orthanc and thumbnails are
*indexes* and can be rebuilt from the originals. The originals cannot be
rebuilt from anything. Protect them differently, and never let a recovery
procedure write to them.

---

## 1. Database failover (P2.5)

Multi-AZ handles this automatically; RDS promotes the standby and the endpoint
DNS follows.

**Verify the application reconnects.** The connection pool must not hold dead
connections. `DatabaseService` uses a 5s connect timeout and 30s idle timeout,
so stale connections drain — but this has not been tested against a real
failover.

```bash
# Trigger (staging only):
aws rds reboot-db-instance --db-instance-identifier mir-staging --force-failover

# Watch, and time it:
while true; do curl -s -o /dev/null -w "%{http_code} $(date +%T)\n" \
  https://api-staging.<domain>/health; sleep 2; done
```

**Record the observed outage window here.**

---

## 2. Point-in-time restore (P2.5, P15.1)

Restores go to a **new instance**, never over the live one.

```bash
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier mir-prod \
  --target-db-instance-identifier mir-restore-$(date +%Y%m%d%H%M) \
  --restore-time 2026-08-09T12:00:00Z \
  --db-subnet-group-name mir-prod \
  --vpc-security-group-ids <db-sg> \
  --no-publicly-accessible
```

Then verify **referential integrity and that studies belong to the right
patients** — P15.1 asks for exactly this, and a restore that comes up but has
mismatched links is worse than no restore:

```sql
-- Orphans: none of these should return rows.
SELECT count(*) FROM imaging_studies s
  LEFT JOIN patients_patients p ON p.id = s.patient_id WHERE p.id IS NULL;
SELECT count(*) FROM imaging_instances i
  LEFT JOIN imaging_studies s ON s.id = i.study_id WHERE s.id IS NULL;
SELECT count(*) FROM consent_records c
  LEFT JOIN patients_patients p ON p.id = c.patient_id WHERE p.id IS NULL;

-- Every ready study has instances, and counts agree.
SELECT s.id, s.file_count, count(i.id) AS actual
FROM imaging_studies s LEFT JOIN imaging_instances i ON i.study_id = s.id
WHERE s.status = 'ready'
GROUP BY s.id, s.file_count
HAVING s.file_count <> count(i.id);

-- Spot-check: storage keys must contain the OWNING patient's id.
SELECT i.storage_key, s.patient_id
FROM imaging_instances i JOIN imaging_studies s ON s.id = i.study_id
LIMIT 20;
-- Each key must read patients/<that same patient_id>/...
```

**Also verify RLS survived the restore**: policies and role attributes are
part of the schema, but confirm rather than assume.

```sql
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'mir_app';
-- MUST be: false, false

SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
WHERE relname IN ('imaging_studies','patients_patients','audit_events');
-- MUST be: true, true for all
```

A restored database with RLS disabled is an open database.

**Record the observed RTO and RPO here.**

---

## 3. Region loss (P15.2)

**Gate: originals must be readable from the DR region, and the runbook must be
followed by someone who did not write it.** Neither has happened.

Priority order — restore *reading* before *writing*. A doctor who can view a
study can still hold their consultation; uploads can wait a few hours.

1. **Confirm originals are readable in the replica.**
   ```bash
   aws s3api head-object --bucket mir-prod-dicom-originals-replica \
     --key patients/<id>/studies/<uid>/series/<uid>/<sop>.dcm \
     --region eu-west-3
   ```
2. **Restore the database** from the latest cross-region snapshot copy into
   eu-west-3.
3. **Stand up the application** — same Terraform, `dr_region` as primary.
4. **Rebuild Orthanc's index** by re-STOWing from the replica bucket. Do not
   attempt to restore Orthanc's own database; it is derived state.
5. **Regenerate thumbnails** lazily, on demand. Do not batch-generate 200,000
   thumbnails while the platform is degraded.
6. **Cut DNS** at Cloudflare.

**Do not fail back automatically.** Once writes land in the DR region, the
original primary is stale. Failing back requires a deliberate reverse
replication, not a DNS flip.

---

## 4. Quarterly drill (P15.1)

| Date | Scenario | Operator | RTO | RPO | Gaps |
|---|---|---|---|---|---|
| ⬜ | | | | | |

Rules:
- The operator **must not be the person who wrote this runbook** (P15.2).
- Use production-shaped data volumes, synthetic content (ADR-7).
- Time every step. A step that takes 40 minutes and was assumed to take 5
  changes the RTO.
- Every gap becomes a ticket before the drill is signed off.

---

## 5. Severed-link upload drill (P7.2)

The automated test (`apps/api/src/modules/imaging/upload-severed.test.ts`)
interposes a TCP proxy and destroys both sockets mid-transfer — an RST with no
FIN, which is what a dropped link looks like at the transport layer. It runs in
CI and is deterministic.

That covers the server's resume contract. It does **not** cover the parts of a
real link failure that live below the socket: DNS re-resolution, a captive
portal returning HTTP 200 for everything, a carrier NAT rebinding the source
port, or a TLS session that has to be renegotiated. Before any pilot with real
clinics, run this manually against the compose stack:

```bash
docker compose --profile apps up -d
# start a large upload through the web UI, then, mid-transfer:
docker network disconnect mir_default mir-api
# wait ~30s so the client sees a real timeout, not just a refused connection
docker network connect mir_default mir-api
```

Expected: the queue resumes without user action, the completed file's SHA-256
matches, and the bytes re-sent are materially fewer than the file size.

Record the result here:

| Date | Operator | File size | Resumed? | Checksum | Bytes re-sent | Notes |
|---|---|---|---|---|---|---|
| ⬜ | | | | | | |

---

## What would make this worse

- **Deleting a KMS key.** Every object encrypted with it becomes permanently
  unreadable. The 30-day deletion window is the only protection, and it is not
  reversible after it elapses.
- **Shortening Object Lock retention.** Not possible in compliance mode — which
  is the point, but means a wrong retention value is permanent.
- **Restoring over the live database.** Always restore to a new instance.
- **Re-uploading "missing" originals.** If an object seems missing, find out
  why before writing. Object Lock will reject the write anyway if a version
  exists, and a second version of a scan is a provenance question nobody wants.
