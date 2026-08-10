# Runbooks

| Runbook | Covers | Exercised? |
|---|---|---|
| [`incident-response.md`](./incident-response.md) | Suspected unauthorized access, loss of originals, severity levels, notification | ⬜ **no** — P15.3 tabletop not run |
| [`dr.md`](./dr.md) | Failover, PITR restore, region loss, quarterly drill | ⬜ **no** — RTO/RPO unmeasured |

## Why "exercised?" is the only column that matters

Both documents describe procedures that have never been performed. The spec is
blunt about why that is not good enough:

- P15.1 — *"an untested backup fails at exactly the wrong moment."*
- P15.2 — the region-failure runbook must be *"followed by someone who did not
  write it."*
- P15.3 — the tabletop must be run and *"gaps logged and fixed."*

A written procedure is a hypothesis about what the team will be able to do
under pressure. Until someone runs it, the RTO numbers are guesses and the
incident timeline is fiction.

## Rollback of a migration — read this before you do it

There is one operational hazard worth stating outside the two runbooks.

`migrations/0002_rls.down.sql` drops every row-level-security policy and
leaves RLS **disabled**. That is correct for a down migration — it restores the
prior state — but it means:

> **A database rolled back past 0002 has no access control at all.**

If a rollback to 0001 or earlier is ever performed on an environment holding
real data, treat it as an incident: the window during which RLS was off is a
window in which any application bug could read any patient's records. Roll
forward again immediately and check the audit log for the interval.

Prefer fixing forward. The only safe use of these down migrations is on a
scratch database.
