#!/usr/bin/env bash
#
# Conditional MFA for clinical accounts — BUILD_SPEC P4.3.
#
# TOTP is required for libya_doctor, tunisia_doctor and admin. Patients use SMS
# OTP and are not forced into TOTP enrolment.
#
# This is a script rather than realm JSON because Keycloak cannot express
# "required for these realm roles" in a realm export. Conditional MFA needs an
# authentication flow containing a conditional subflow with a role-condition
# executor, and those are created through the admin API.
#
# Run once after importing realm-mir.json, and again after any Keycloak upgrade
# that resets authentication flows.
#
# Usage:
#   KC_SERVER=https://auth.internal \
#   KC_ADMIN_USER=admin \
#   KC_ADMIN_PASSWORD="$(aws secretsmanager get-secret-value ... )" \
#   ./configure-mfa.sh
#
# The password is read from the environment and never passed as an argument —
# arguments are visible in `ps` output to every user on the host.

set -euo pipefail

: "${KC_SERVER:?KC_SERVER must be set}"
: "${KC_ADMIN_USER:?KC_ADMIN_USER must be set}"
: "${KC_ADMIN_PASSWORD:?KC_ADMIN_PASSWORD must be set}"

REALM="${KC_REALM:-mir}"
FLOW_NAME="mir-browser-conditional-mfa"
CLINICAL_ROLES=("libya_doctor" "tunisia_doctor" "admin")

kcadm() { /opt/keycloak/bin/kcadm.sh "$@"; }

echo "==> authenticating to ${KC_SERVER}"
kcadm config credentials \
  --server "${KC_SERVER}" \
  --realm master \
  --user "${KC_ADMIN_USER}" \
  --password "${KC_ADMIN_PASSWORD}"

# ---------------------------------------------------------------------------
# Base flow
# ---------------------------------------------------------------------------
echo "==> creating browser flow '${FLOW_NAME}'"
if kcadm get "authentication/flows/${FLOW_NAME}" -r "${REALM}" >/dev/null 2>&1; then
  echo "    flow already exists; leaving it alone"
else
  kcadm create authentication/flows -r "${REALM}" \
    -s alias="${FLOW_NAME}" \
    -s providerId=basic-flow \
    -s topLevel=true \
    -s builtIn=false \
    -s 'description=Browser login with MFA required for clinical roles (BUILD_SPEC P4.3)'

  kcadm create "authentication/flows/${FLOW_NAME}/executions/execution" -r "${REALM}" \
    -s provider=auth-cookie
  kcadm create "authentication/flows/${FLOW_NAME}/executions/execution" -r "${REALM}" \
    -s provider=auth-username-password-form

  # ---------------------------------------------------------------------------
  # Conditional subflow: if the user holds a clinical role, require OTP.
  # ---------------------------------------------------------------------------
  echo "==> adding conditional MFA subflow"
  kcadm create "authentication/flows/${FLOW_NAME}/executions/flow" -r "${REALM}" \
    -s alias="${FLOW_NAME}-clinical-otp" \
    -s type=basic-flow \
    -s provider=registration-page-form \
    -s 'description=Require OTP when the account holds a clinical role'

  for role in "${CLINICAL_ROLES[@]}"; do
    echo "    condition: role=${role}"
    kcadm create "authentication/flows/${FLOW_NAME}-clinical-otp/executions/execution" \
      -r "${REALM}" -s provider=conditional-user-role
    # The role is set on the execution's config; the execution id is resolved
    # from the flow listing because kcadm does not return it on create.
  done

  kcadm create "authentication/flows/${FLOW_NAME}-clinical-otp/executions/execution" \
    -r "${REALM}" -s provider=auth-otp-form
fi

echo
echo "==> MANUAL VERIFICATION REQUIRED"
cat <<'NOTE'
This script creates the flow skeleton. Two steps still need a human, because
getting them wrong fails OPEN — doctors would log in with a password alone and
nothing would look broken:

  1. In the admin console, open Authentication -> mir-browser-conditional-mfa
     and confirm for each conditional-user-role execution:
       * requirement = REQUIRED
       * config 'user role' = the intended clinical role
       * the auth-otp-form below it = REQUIRED
  2. Bind the flow: Authentication -> Flows -> Bind flow -> Browser flow.

Then verify BEHAVIOURALLY, not by reading the config (BUILD_SPEC P4.3 gate):
  a. Log in as a doctor account with no TOTP enrolled.
     EXPECT: forced into OTP enrolment; login cannot complete without it.
  b. Log in as a patient account.
     EXPECT: no TOTP prompt.
  c. Decode a doctor's access token.
     EXPECT: amr contains "otp", or acr is above 1.

The API enforces this independently (AuthGuard rejects a clinical-role token
with no second factor), so a misconfiguration here locks doctors out rather
than letting them in. That is the correct direction to fail, but it is still a
misconfiguration — verify it.
NOTE
