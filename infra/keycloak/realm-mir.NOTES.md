# `realm-mir.json` — notes

Prose that used to live in `_comment` keys inside `realm-mir.json`. Keycloak's
realm importer rejects unknown fields (`Unrecognized field "_comment"`, class
`RealmRepresentation`) and aborts the whole boot, so the reasoning lives here
instead of in the JSON.

Keep this file next to the realm export: the rules below are not derivable from
the JSON, and getting them wrong fails quietly.

## The realm

Keycloak realm for MIR — BUILD_SPEC P4.1, P4.3.

Import with `kcadm.sh create realms -f realm-mir.json`, or via `--import-realm`
on first boot (that is what `docker-compose.yml` does).

**What this file does not contain, on purpose:**

- no client secrets — injected from AWS Secrets Manager at deploy time (BUILD_SPEC §6)
- no users — created through the application, never seeded here
- no admin credentials

**Self-hosted** (ADR / §4): self-hosting Keycloak keeps identity out of the
compliance chain. A hosted IdP would become a processor of authentication data
for patients in two jurisdictions whose rules (L1, L2) are unresolved.

## Identifiers

Login is by phone number, not email. Libyan patients frequently have no email
address, and the phone number is the identifier the claim flow (P5.2) and SMS
OTP both key on.

## Token lifetimes

Short access tokens: a stolen token is useful only for its remaining lifetime,
and this system's tokens grant reach toward patient imaging. Refresh is longer
so a doctor mid-upload is not thrown out, but idle sessions still expire within
a working day.

## Brute-force protection

Server-side brute-force protection, in addition to the application rate limiter
(P4.5). Two layers because they fail differently: Keycloak's survives an
application restart, the application's covers endpoints Keycloak never sees.

## Default roles

No default role grants an application role. A new account has no role until an
admin assigns one, so a self-service registration bug cannot mint a doctor. The
API rejects any token carrying zero — or more than one — application role.

## MFA

P4.3: TOTP is REQUIRED for `libya_doctor`, `tunisia_doctor` and `admin`.
Patients may use SMS OTP instead.

Keycloak cannot express "required for these realm roles" declaratively in a
realm export — conditional MFA needs an authentication flow with a
role-condition executor, configured after import. `configure-mfa.sh` does that.

The API does NOT rely on this being right: `AuthGuard` independently rejects any
clinical-role token that shows no second factor (`amr`/`acr`). If the realm is
misconfigured, doctors are locked out — which is the correct direction to fail.

## Events

Authentication events are retained for 90 days and shipped to the same place as
the application audit log. A breach investigation needs to correlate "who logged
in" with "what they read" (P4.4), and those two records live in different
systems.

## Clients

**`mir-api`** — `bearerOnly`: the API validates tokens and never initiates a
login. This client id is the AUDIENCE the API requires (P4.2). A token minted
for `mir-web` is signed by the same realm but is not for this API, and must be
rejected.

**`mir-web`** — public client with PKCE and no client secret; a secret shipped
to a browser is not a secret. Implicit flow is disabled: it puts tokens in the
URL, where they reach browser history and referrer headers. Direct access grants
are disabled so credentials never transit the application at all.

**`mir-web` → `audience-mir-api` mapper** — adds `mir-api` to `aud` so the API
accepts tokens obtained by the web client.
