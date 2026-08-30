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
# or container recreate that resets authentication flows.
#
# Usage:
#   KC_SERVER=http://localhost:8081 \
#   KC_ADMIN_USER=admin \
#   KC_ADMIN_PASSWORD="$(aws secretsmanager get-secret-value ... )" \
#   ./configure-mfa.sh
#
# The password is read from the environment and never passed as an argument —
# arguments are visible in `ps` output to every user on the host.
#
# ---------------------------------------------------------------------------
# WHY THIS WAS REWRITTEN (2026-08-29)
#
# The previous version produced a flow that enforced NOTHING:
#   * it created conditional-user-role executions but never set their role
#     config — its own comment said the execution id had to be resolved from
#     the flow listing, and then it never did it;
#   * the conditional subflow was created with provider=registration-page-form,
#     which is not a subflow provider;
#   * it never bound the flow to the realm's browser flow.
#
# None of that was noticed because the API enforces MFA independently
# (AuthGuard rejects a clinical-role token with no second factor), so the
# misconfiguration failed CLOSED — doctors locked out rather than let in.
#
# This version drives the admin REST API directly, sets every role condition,
# and binds the flow. It is idempotent.
# ---------------------------------------------------------------------------

set -euo pipefail

: "${KC_SERVER:?KC_SERVER must be set}"
: "${KC_ADMIN_USER:?KC_ADMIN_USER must be set}"
: "${KC_ADMIN_PASSWORD:?KC_ADMIN_PASSWORD must be set}"

REALM="${KC_REALM:-mir}"
FLOW_NAME="mir-browser-conditional-mfa"
CLINICAL_ROLES=("libya_doctor" "tunisia_doctor" "admin")

# ---------------------------------------------------------------------------
# Admin token
# ---------------------------------------------------------------------------
echo "==> authenticating to ${KC_SERVER}"
TOKEN=$(curl -sS --fail \
  -d "client_id=admin-cli" \
  -d "username=${KC_ADMIN_USER}" \
  --data-urlencode "password=${KC_ADMIN_PASSWORD}" \
  -d "grant_type=password" \
  "${KC_SERVER}/realms/master/protocol/openid-connect/token" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])')

api() {
  local method="$1" path="$2"
  shift 2
  curl -sS -X "${method}" \
    -H "authorization: Bearer ${TOKEN}" \
    -H "content-type: application/json" \
    "${KC_SERVER}/admin/realms/${REALM}${path}" "$@"
}

# ---------------------------------------------------------------------------
# Top-level flow
# ---------------------------------------------------------------------------
if api GET "/authentication/flows" | grep -q "\"${FLOW_NAME}\""; then
  echo "==> flow '${FLOW_NAME}' already exists; leaving it alone"
else
  echo "==> creating browser flow '${FLOW_NAME}'"
  api POST "/authentication/flows" -d "{
    \"alias\": \"${FLOW_NAME}\",
    \"providerId\": \"basic-flow\",
    \"topLevel\": true,
    \"builtIn\": false,
    \"description\": \"Browser login with MFA required for clinical roles (BUILD_SPEC P4.3)\"
  }" >/dev/null

  # Cookie first: an existing SSO session should not re-prompt.
  echo "    execution: auth-cookie (ALTERNATIVE)"
  api POST "/authentication/flows/${FLOW_NAME}/executions/execution" \
    -d '{"provider": "auth-cookie"}' >/dev/null

  # The forms subflow: username+password, then the conditional OTP subflow.
  echo "    subflow: ${FLOW_NAME}-forms (ALTERNATIVE)"
  api POST "/authentication/flows/${FLOW_NAME}/executions/flow" -d "{
    \"alias\": \"${FLOW_NAME}-forms\",
    \"type\": \"basic-flow\",
    \"description\": \"Username, password, then conditional OTP\"
  }" >/dev/null

  echo "    execution: auth-username-password-form (REQUIRED)"
  api POST "/authentication/flows/${FLOW_NAME}-forms/executions/execution" \
    -d '{"provider": "auth-username-password-form"}' >/dev/null

  # One conditional subflow PER ROLE. Keycloak's role condition takes a single
  # role, and conditions within one subflow are ANDed — a single subflow
  # listing three roles would require a user to hold all three, which no
  # account does, so OTP would never be required. That is precisely the
  # "looks configured, enforces nothing" failure.
  for role in "${CLINICAL_ROLES[@]}"; do
    subflow="${FLOW_NAME}-otp-${role}"
    echo "    conditional subflow for role=${role}"

    api POST "/authentication/flows/${FLOW_NAME}-forms/executions/flow" -d "{
      \"alias\": \"${subflow}\",
      \"type\": \"basic-flow\",
      \"description\": \"Require OTP when the account holds ${role}\"
    }" >/dev/null

    api POST "/authentication/flows/${subflow}/executions/execution" \
      -d '{"provider": "conditional-user-role"}' >/dev/null

    api POST "/authentication/flows/${subflow}/executions/execution" \
      -d '{"provider": "auth-otp-form"}' >/dev/null

    # THE STEP THE OLD SCRIPT SKIPPED.
    #
    # Resolve the execution ids, set the condition's role, and set every
    # requirement. Without the role config the condition matches nobody and
    # the OTP form below it never fires.
    executions=$(api GET "/authentication/flows/${subflow}/executions")

    cond_id=$(echo "${executions}" | python3 -c '
import sys, json
for e in json.load(sys.stdin):
    if e.get("providerId") == "conditional-user-role":
        print(e["id"]); break')

    otp_id=$(echo "${executions}" | python3 -c '
import sys, json
for e in json.load(sys.stdin):
    if e.get("providerId") == "auth-otp-form":
        print(e["id"]); break')

    api POST "/authentication/executions/${cond_id}/config" -d "{
      \"alias\": \"${subflow}-cond\",
      \"config\": {\"condUserRole\": \"${role}\", \"negate\": \"false\"}
    }" >/dev/null

    api PUT "/authentication/flows/${subflow}/executions" \
      -d "{\"id\": \"${cond_id}\", \"requirement\": \"REQUIRED\"}" >/dev/null
    api PUT "/authentication/flows/${subflow}/executions" \
      -d "{\"id\": \"${otp_id}\", \"requirement\": \"REQUIRED\"}" >/dev/null
  done

  # Requirements on the outer executions. Keycloak defaults new executions to
  # DISABLED, so this is not optional decoration.
  echo "==> setting requirements"
  outer=$(api GET "/authentication/flows/${FLOW_NAME}/executions")

  set_requirement() {
    local match="$1" requirement="$2"
    local id
    id=$(echo "${outer}" | python3 -c "
import sys, json
for e in json.load(sys.stdin):
    if e.get('providerId') == '${match}' or e.get('displayName') == '${match}':
        print(e['id']); break")
    [ -n "${id}" ] && api PUT "/authentication/flows/${FLOW_NAME}/executions" \
      -d "{\"id\": \"${id}\", \"requirement\": \"${requirement}\"}" >/dev/null
  }

  set_requirement "auth-cookie" "ALTERNATIVE"
  set_requirement "${FLOW_NAME}-forms" "ALTERNATIVE"

  forms=$(api GET "/authentication/flows/${FLOW_NAME}-forms/executions")
  pw_id=$(echo "${forms}" | python3 -c '
import sys, json
for e in json.load(sys.stdin):
    if e.get("providerId") == "auth-username-password-form":
        print(e["id"]); break')
  api PUT "/authentication/flows/${FLOW_NAME}-forms/executions" \
    -d "{\"id\": \"${pw_id}\", \"requirement\": \"REQUIRED\"}" >/dev/null

  for role in "${CLINICAL_ROLES[@]}"; do
    sub_id=$(echo "${forms}" | python3 -c "
import sys, json
for e in json.load(sys.stdin):
    if e.get('displayName') == '${FLOW_NAME}-otp-${role}':
        print(e['id']); break")
    [ -n "${sub_id}" ] && api PUT "/authentication/flows/${FLOW_NAME}-forms/executions" \
      -d "{\"id\": \"${sub_id}\", \"requirement\": \"CONDITIONAL\"}" >/dev/null
  done
fi

# ---------------------------------------------------------------------------
# Bind it. Creating the flow changes nothing until the realm uses it — this is
# the step whose absence made the old script a no-op.
# ---------------------------------------------------------------------------
echo "==> binding '${FLOW_NAME}' as the realm browser flow"
api PUT "" -d "{\"browserFlow\": \"${FLOW_NAME}\"}" >/dev/null

bound=$(api GET "" | python3 -c 'import sys,json; print(json.load(sys.stdin)["browserFlow"])')
if [ "${bound}" != "${FLOW_NAME}" ]; then
  echo "FAILED: browser flow is '${bound}', expected '${FLOW_NAME}'" >&2
  exit 1
fi

echo
echo "==> flow created and bound."
echo
echo "Configuration is NOT evidence. Verify the BEHAVIOUR (the P4.3 gate):"
echo "    node scripts/verify-keycloak-mfa.mjs"
echo
echo "That drives a real browser through the login page, because the failure"
echo "this guards against is a flow that looks right and does not fire."
