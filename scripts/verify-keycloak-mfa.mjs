#!/usr/bin/env node
/**
 * BUILD_SPEC P4.3 gate — conditional MFA, verified BEHAVIOURALLY.
 *
 * The gate:
 *   a. a doctor account with no TOTP enrolled cannot complete login; it is
 *      forced into enrolment;
 *   b. a patient account is not prompted for TOTP.
 *
 * (c) in the spec — a doctor's token carrying amr=otp — is not asserted here,
 * because reaching it requires completing a TOTP enrolment, and the API side
 * of that claim is already covered by token-verifier tests. What this adds is
 * the half those tests cannot reach: whether Keycloak actually challenges.
 *
 * Reading the flow's configuration proves none of that. The failure this
 * guards against is a flow that LOOKS right and does not fire — which is
 * exactly what `configure-mfa.sh` produced before 2026-08-29: it created
 * conditional-user-role executions without ever setting their role config, so
 * the condition matched nobody and the OTP form never ran.
 *
 * Conditional MFA lives in the BROWSER flow, so this drives a real browser
 * through Keycloak's login page. A direct-grant (ROPC) request would bypass
 * the browser flow entirely and prove nothing about it.
 *
 * Run: node scripts/verify-keycloak-mfa.mjs
 * Needs: a Keycloak with the mir realm imported and configure-mfa.sh applied.
 */

import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Playwright is a devDependency of @mir/web, not of the root. Resolving it
// from there keeps a single copy and a single browser download, rather than
// adding a second one to the root just for this script. @playwright/test
// re-exports the same browser launchers as the bare playwright package.
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireFromWeb = createRequire(join(REPO, 'apps', 'web', 'package.json'));
const { chromium } = requireFromWeb('@playwright/test');

const KC = process.env['KC_SERVER'] ?? 'http://localhost:8081';
const REALM = process.env['KC_REALM'] ?? 'mir';
const ADMIN_USER = process.env['KC_ADMIN_USER'] ?? 'admin';
const ADMIN_PASSWORD = process.env['KC_ADMIN_PASSWORD'] ?? 'admin';

// Realm passwordPolicy requires >= 12 characters.
const PASSWORD = 'probe-password-1234';

// Where Keycloak sends the browser once login COMPLETES. Reaching it is the
// signal that a code was issued — which for a clinical account with no second
// factor is the failure this gate exists to catch.
//
// It must be a RESOLVABLE host: Chromium resolves DNS before Playwright's
// route interception runs, so an unresolvable placeholder dies at the network
// layer and the probe learns nothing. The realm ships
// https://app.example.invalid/* , so this registers a loopback URI on the
// client for the duration of the run and restores the original list after.
// The port must be one Chromium will navigate to — it blocks a list of
// "unsafe" low ports (9, 25, 87, ...) with ERR_UNSAFE_PORT before any route
// interception runs. Nothing needs to listen there; the request is fulfilled
// by the route handler below.
const REDIRECT = process.env['KC_REDIRECT_URI'] ?? 'http://127.0.0.1:49180/probe-callback';

let failures = 0;
function note(ok, message, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${message}`);
  if (!ok) {
    failures += 1;
    if (detail !== undefined) console.log(`        ${detail}`);
  }
}

async function adminToken() {
  const res = await fetch(`${KC}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: 'admin-cli',
      username: ADMIN_USER,
      password: ADMIN_PASSWORD,
      grant_type: 'password',
    }),
  });
  if (!res.ok) throw new Error(`admin token: ${res.status}`);
  return (await res.json()).access_token;
}

function api(token) {
  return async (method, path, body) => {
    const res = await fetch(`${KC}/admin/realms/${REALM}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
    }
    const text = await res.text();
    return text === '' ? null : JSON.parse(text);
  };
}

async function createUser(call, username, roleName) {
  await call('POST', '/users', {
    username,
    email: `${username}@example.test`,
    emailVerified: true,
    enabled: true,
    credentials: [{ type: 'password', value: PASSWORD, temporary: false }],
  });
  const [user] = await call('GET', `/users?username=${username}&exact=true`);
  const role = await call('GET', `/roles/${roleName}`);
  await call('POST', `/users/${user.id}/role-mappings/realm`, [
    { id: role.id, name: role.name },
  ]);
  return user.id;
}

/** Drive the browser login and report which page it lands on. */
async function attemptBrowserLogin(browser, username, callback) {
  // A FRESH context per attempt. Keycloak sets an SSO cookie on success, and a
  // reused context would let the second account skip the login form entirely
  // and silently pass.
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  // mir-web enforces PKCE (S256) — see infra/keycloak/realm-mir.NOTES.md.
  // Without these two parameters Keycloak rejects the request with
  // "Missing parameter: code_challenge_method" BEFORE showing a login form,
  // which would look exactly like a login that failed for the right reason.
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');

  const authUrl =
    `${KC}/realms/${REALM}/protocol/openid-connect/auth?` +
    new URLSearchParams({
      client_id: 'mir-web',
      redirect_uri: REDIRECT,
      response_type: 'code',
      scope: 'openid',
      state: 'probe',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });

  // ERR_NAME_NOT_RESOLVED on the redirect target is itself a completed login:
  // Keycloak issued the code and told the browser to go somewhere that does
  // not exist. Swallow it here; `redirected` above records that it happened.
  const resp = await page.goto(authUrl, { waitUntil: 'domcontentloaded' }).catch((e) => {
    if (process.env['MFA_PROBE_DEBUG']) console.log(`        [debug] goto: ${String(e).split('\n')[0]}`);
    return null;
  });
  if (process.env['MFA_PROBE_DEBUG']) {
    console.log(`        [debug] after goto: ${page.url().slice(0, 110)}`);
  }

  // If the login form never appeared, the flow completed without asking for
  // anything — report that rather than timing out on a missing field.
  const form = await page.locator('#username').count().catch(() => 0);
  if (form > 0) {
    await page.fill('#username', username);
    await page.fill('#password', PASSWORD);
    await page.click('#kc-login').catch(() => {});
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(2000);
  }

  const url = page.url();
  const body = await page.content();
  if (process.env['MFA_PROBE_DEBUG']) {
    console.log(`        [debug] final url: ${url.slice(0, 130)}`);
    console.log(`        [debug] callback hits: ${callback.hits}`);
  }
  await context.close();

  return {
    url,
    hits: callback.hits,
    // Keycloak's TOTP setup page carries the secret and a QR code.
    totpSetup: /totp|authenticator|Mobile Authenticator|Set up/i.test(body) &&
      /secret|QR|totpSecret/i.test(body),
    // A one-time-code prompt (already enrolled).
    otpPrompt: /id="otp"|One-time code/i.test(body),
    // Login COMPLETED only if the browser actually ARRIVED at the callback
    // (the local server counted a hit) and Keycloak did not send an error
    // there. Not keyed on `code=`: Keycloak omits it from the query when the
    // client uses response_mode=fragment, and a check that silently depends on
    // response mode is the kind that passes for the wrong reason.
    reachedRedirect: callback.hits > 0 && !/[?&]error=/.test(url),
    authError: /[?&]error=/.test(url) ? new URL(url).searchParams.get('error_description') : null,
  };
}

/**
 * A real listener on the redirect target.
 *
 * Playwright's route interception does NOT fire for a top-level navigation
 * that fails at the network layer (DNS or connect), so a redirect to a host
 * nothing is listening on dies as ERR_CONNECTION_REFUSED and the probe learns
 * nothing. Something must actually answer.
 */
function startCallbackServer(port) {
  const state = { hits: 0, reset() { this.hits = 0; } };
  const server = createServer((_req, res) => {
    state.hits += 1;
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html><body id="login-completed">login completed</body></html>');
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve({ server, state }));
  });
}

console.log('\nP4.3 — conditional MFA, verified behaviourally\n' + '='.repeat(70));

const token = await adminToken();
const call = api(token);

// Guard: the dev-only amr mapper would make every token claim a second factor
// and invalidate check (c) entirely. Refuse to report a pass alongside it.
const webClient = (await call('GET', '/clients?clientId=mir-web'))[0];
if (webClient !== undefined) {
  const mappers = webClient.protocolMappers ?? [];
  const hardcodedAmr = mappers.find(
    (m) => m.protocolMapper === 'oidc-hardcoded-claim-mapper' &&
      (m.config?.['claim.name'] ?? '') === 'amr',
  );
  if (hardcodedAmr !== undefined) {
    console.error(
      '\nREFUSING TO VERIFY: mir-web carries a hardcoded amr claim mapper.\n' +
        'That is the local dev shortcut for ROPC login. It makes every token\n' +
        'claim a second factor, so this gate cannot mean anything while it\n' +
        'exists. Remove it and re-run.\n',
    );
    process.exit(1);
  }
  note(true, 'no hardcoded amr mapper on mir-web (the dev shortcut is absent)');
}

// The flow must be bound. Not the gate, but a bound-flow check makes a
// behavioural failure below diagnosable.
const realm = await call('GET', '');
note(
  realm.browserFlow === 'mir-browser-conditional-mfa',
  `realm browser flow is bound to the conditional-MFA flow`,
  `browserFlow = ${realm.browserFlow}`,
);

// Register the probe redirect URI, remembering the original list.
const clientUuid = webClient?.id;
const originalRedirects = webClient?.redirectUris ?? [];
if (clientUuid !== undefined) {
  await call('PUT', `/clients/${clientUuid}`, {
    redirectUris: [...originalRedirects, REDIRECT],
  });
}

const stamp = Date.now();
const doctorName = `probe-doctor-${stamp}`;
const patientName = `probe-patient-${stamp}`;
let doctorId;
let patientId;
const callbackPort = Number(new URL(REDIRECT).port);
const { server: callbackServer, state: callback } = await startCallbackServer(callbackPort);
const browser = await chromium.launch();

try {
  doctorId = await createUser(call, doctorName, 'libya_doctor');
  patientId = await createUser(call, patientName, 'patient');

  // --- (a) a clinical account cannot complete login without a second factor
  callback.reset();
  const doctor = await attemptBrowserLogin(browser, doctorName, callback);
  note(
    doctor.authError === null,
    'doctor auth request was accepted (not rejected before login)',
    `error_description = ${doctor.authError}`,
  );
  note(
    !doctor.reachedRedirect,
    '(a) doctor with no TOTP CANNOT complete login',
    `landed on ${doctor.url}`,
  );
  note(
    doctor.totpSetup || doctor.otpPrompt,
    '(a) doctor is forced into OTP enrolment',
    `totpSetup=${doctor.totpSetup} otpPrompt=${doctor.otpPrompt} url=${doctor.url}`,
  );

  // --- (b) a patient is not forced into TOTP
  callback.reset();
  const patient = await attemptBrowserLogin(browser, patientName, callback);
  note(
    patient.authError === null,
    'patient auth request was accepted (not rejected before login)',
    `error_description = ${patient.authError}`,
  );
  note(
    !patient.totpSetup && !patient.otpPrompt,
    '(b) patient is NOT prompted for TOTP',
    `totpSetup=${patient.totpSetup} otpPrompt=${patient.otpPrompt} url=${patient.url}`,
  );
  note(
    patient.reachedRedirect,
    '(b) patient login completes',
    `landed on ${patient.url}`,
  );
} finally {
  await browser.close();
  await new Promise((r) => callbackServer.close(r));
  // Always remove the probes. Leaving accounts behind in an identity realm is
  // exactly the kind of residue that becomes a finding later.
  if (doctorId !== undefined) await call('DELETE', `/users/${doctorId}`);
  if (patientId !== undefined) await call('DELETE', `/users/${patientId}`);
  // Restore the client's redirect list exactly. A probe that widens what a
  // public client will redirect to, and leaves it widened, is an open redirect.
  if (clientUuid !== undefined) {
    await call('PUT', `/clients/${clientUuid}`, { redirectUris: originalRedirects });
  }
}

console.log('='.repeat(70));
if (failures > 0) {
  console.error(
    `\n${failures} check(s) failed. Conditional MFA is NOT enforcing.\n` +
      `A doctor able to complete login without a second factor is the failure\n` +
      `this gate exists to prevent — do not weaken the assertions.\n`,
  );
  process.exit(1);
}
console.log('\nConditional MFA is enforcing. (P4.3, against a LOCAL Keycloak)\n');
