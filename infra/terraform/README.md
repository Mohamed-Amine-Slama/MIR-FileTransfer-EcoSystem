# Infrastructure as code — BUILD_SPEC PHASE 2

> ## ⚠️ NOT APPLIED. EVERY PHASE 2 GATE IS OPEN.
>
> There is no AWS account attached to this repository. Nothing here has been
> `init`ed, `plan`ned, or `apply`ed. Reviewing this code is **not** the same as
> passing the gates below, and the pre-launch checklist keeps them open until
> someone with credentials runs them.

## What is written

| Module | Covers | Gate status |
|---|---|---|
| `modules/kms` | Four customer-managed keys, rotation enabled | P2.3 ⬜ open |
| `modules/network` | VPC, public/private subnets, NAT, deny-by-default SGs | P2.2 ⬜ open |
| `modules/storage` | Three buckets, Object Lock compliance mode, CRR | **P2.4 ⬜ open** |
| `modules/database` | PostgreSQL 16 multi-AZ, 30-day PITR, deletion protection | P2.5 ⬜ open |
| `environments/{dev,staging,prod}` | Remote state, provider pinning, wiring | P2.1 ⬜ open |

## The gates a human must run

**P2.1 — remote state**
```bash
cd environments/dev && terraform init && terraform plan
```
Expected: plan completes with zero errors; state lands in S3, not on disk.

**P2.2 — database unreachable from the internet.** The spec is explicit that
this is "verified by an actual connection attempt, not by reading the config":
```bash
# From OUTSIDE the VPC (a laptop, not a bastion):
nc -vz -w 10 <rds-endpoint> 5432     # MUST time out
```
Also confirm `terraform plan` shows no `0.0.0.0/0` ingress except 443 on the ALB.

**P2.3 — four keys, rotation on**
```bash
for k in objects database secrets backups; do
  aws kms describe-key --key-id alias/mir-dev-$k \
    --query 'KeyMetadata.[KeyId,Description]' --output text
  aws kms get-key-rotation-status --key-id alias/mir-dev-$k \
    --query 'KeyRotationEnabled'    # MUST be true, all four
done
```

**P2.4 — ⚠️ the single most important infrastructure gate.**
"A deletable original is a lost scan is a lawsuit."
```bash
BUCKET=$(terraform output -raw originals_bucket)

# 1. Upload, then attempt to delete. The delete MUST be REJECTED.
aws s3 cp ./test-data/dicom/01-single-file-ct/CT000001.dcm s3://$BUCKET/probe.dcm
aws s3api delete-object --bucket $BUCKET --key probe.dcm   # expect AccessDenied
aws s3api delete-object --bucket $BUCKET --key probe.dcm \
  --version-id <version>                                   # expect AccessDenied

# 2. Anonymous access MUST be refused.
curl -s -o /dev/null -w '%{http_code}\n' \
  "https://$BUCKET.s3.eu-south-1.amazonaws.com/probe.dcm"   # expect 403

# 3. The replica MUST appear in the DR region.
aws s3api head-object --bucket <replica-bucket> --key probe.dcm --region eu-west-3
```
Use a SYNTHETIC fixture for this probe. Under compliance-mode Object Lock the
probe object cannot be removed for the whole retention period — so do not use
anything you would mind keeping for ten years, and do not run it against a
production bucket casually.

**P2.5 — failover and PITR.** Trigger a failover and confirm the app
reconnects; restore to a scratch instance and confirm referential integrity.
Record the OBSERVED RTO in `docs/runbooks/dr.md`.

**P2.6 — deploy pipeline.** `curl https://api-dev.<domain>/health` returns 200
over TLS 1.3, and HTTP redirects to HTTPS.

## Decisions baked in

- **Region (D5):** `eu-south-1` (Milan) primary, `eu-west-3` (Paris) DR.
  Milan is an **opt-in region** and must be enabled on the account. Confirm it
  supports Object Lock compliance mode, CRR, RDS PG16 multi-AZ and KMS
  rotation before applying; otherwise switch — the region is a variable
  precisely so that is a one-line change.
- **Object Lock is COMPLIANCE mode, not governance.** Governance mode can be
  bypassed by any principal holding `s3:BypassGovernanceRetention`, including
  root. Compliance mode cannot be bypassed by anyone, for the retention
  period. It is irreversible, which is the point.
- **Retention periods are BLOCKING L5 and unanswered.** The values in
  `variables.tf` are placeholders. Compliance-mode retention **cannot be
  shortened afterwards** — not by you, not by AWS support. Guess low and
  records are destroyed before the law allows; guess high and they cannot be
  erased on request. Get the legal answer first.
- **The database password is never in Terraform state.** RDS-managed master
  credentials put it in Secrets Manager directly.
