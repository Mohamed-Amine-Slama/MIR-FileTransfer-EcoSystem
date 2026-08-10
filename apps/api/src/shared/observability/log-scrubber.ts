/**
 * Log scrubbing — BUILD_SPEC PHASE 13.
 *
 * "Structured JSON logs. Log scrubbing that strips patient identifiers, file
 *  contents, and tokens — VERIFIED, NOT ASSUMED."
 *
 * Gate: "trigger an error containing a patient name and a token → confirm
 * neither appears in Sentry or the log store."
 *
 * WHY LOGS ARE THE LEAK NOBODY PLANS:
 * the database is protected by row-level security, object storage by IAM and
 * Object Lock — but logs are shipped to a third-party aggregator, read by
 * on-call engineers who have no clinical role, retained for months, and
 * exported into tickets. A patient name that reaches the log store has left
 * every control this system has.
 *
 * THREE STRATEGIES, because no two of them are sufficient:
 *
 *   1. KEY-BASED: redact by field name. Catches structured data, including
 *      values that look like nothing in particular — a name is just a string.
 *   2. PATTERN-BASED: redact by value shape. Catches free text, where an
 *      interpolated phone number or JWT has no field name at all.
 *   3. VALUE-BASED: any string found under a sensitive KEY is then removed
 *      from every free-text string in the same payload.
 *
 * Strategy 3 exists because of the exact scenario the gate names. Given
 *
 *     { patientName: 'محمد علي', err: Error('failed to load for محمد علي') }
 *
 * key-based redaction fixes the field and leaves the error message intact — a
 * name has no pattern to match, so strategy 2 cannot help. Learning the name
 * from the field and then removing that literal from the message is what
 * actually closes it.
 */

/** Field names whose VALUE must never be logged, at any depth. */
const SENSITIVE_KEYS = new Set([
  // identity
  'patientname', 'patient_name', 'fullname', 'full_name', 'name',
  'dateofbirth', 'date_of_birth', 'dob', 'birthdate',
  'nationalid', 'national_id', 'nationalidnumber',
  'phone', 'phonee164', 'phone_e164', 'phonenumber', 'mobile',
  'email', 'emailaddress',
  'address', 'street', 'postcode',
  // credentials
  'password', 'passwd', 'secret', 'token', 'accesstoken', 'access_token',
  'refreshtoken', 'refresh_token', 'idtoken', 'id_token', 'apikey', 'api_key',
  'authorization', 'auth', 'cookie', 'setcookie', 'sessionid', 'session_id',
  'clientsecret', 'client_secret', 'webhooksecret', 'signature',
  'privatekey', 'private_key',
  // clinical
  'diagnosis', 'findings', 'clinicalnotes', 'clinical_notes', 'indication',
  'symptoms', 'referralnotes', 'referral_notes',
  // file contents
  'pixeldata', 'pixel_data', 'body', 'rawbody', 'buffer', 'filecontents',
  'file_contents', 'dicom',
  // payment
  'cardnumber', 'card_number', 'pan', 'cvv', 'cvc',
]);

export const REDACTED = '[redacted]';

/**
 * Value shapes that must be redacted wherever they appear, including inside
 * free-text messages.
 */
const SENSITIVE_PATTERNS: { name: string; re: RegExp }[] = [
  // JWT: three base64url segments. Tokens routinely end up in error strings.
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  // Bearer header value.
  { name: 'bearer', re: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/gi },
  // E.164 phone numbers — the primary patient identifier in this system.
  { name: 'phone', re: /\+[1-9]\d{7,14}\b/g },
  { name: 'email', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  // Provider keys.
  { name: 'stripe_key', re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{8,}\b/g },
  { name: 'stripe_webhook', re: /\bwhsec_[A-Za-z0-9]{8,}\b/g },
  { name: 'aws_key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  // Postgres URL with credentials.
  { name: 'pg_url', re: /postgres(?:ql)?:\/\/[^\s:]+:[^\s@]+@[^\s]+/g },
];

/**
 * How deep to walk before giving up.
 *
 * A cyclic or pathologically nested object must not hang the logger — a
 * logger that crashes takes the process's only diagnostic channel with it.
 */
const MAX_DEPTH = 8;

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase().replace(/[\s_-]/g, ''));
}

/** Redact sensitive VALUE SHAPES inside a string. */
export function scrubString(input: string): string {
  let out = input;
  for (const { re } of SENSITIVE_PATTERNS) {
    out = out.replace(re, REDACTED);
  }
  return out;
}

/**
 * Collect every string that sits under a sensitive key, at any depth.
 *
 * These become literals to strip from free text elsewhere in the same payload.
 * Short values are skipped: redacting every occurrence of a two-character
 * string would mangle unrelated text and make logs unreadable, which gets
 * scrubbing switched off.
 */
const MIN_LEARNED_LENGTH = 3;

function collectSensitiveValues(
  value: unknown,
  found: Set<string>,
  depth = 0,
  seen = new WeakSet<object>(),
): void {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) collectSensitiveValues(item, found, depth + 1, seen);
    return;
  }
  if (value instanceof Error || value instanceof Uint8Array || Buffer.isBuffer(value)) return;

  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveKey(key) && typeof v === 'string' && v.length >= MIN_LEARNED_LENGTH) {
      found.add(v);
    }
    collectSensitiveValues(v, found, depth + 1, seen);
  }
}

function stripLiterals(text: string, literals: Set<string>): string {
  let out = text;
  for (const literal of literals) {
    if (literal.length < MIN_LEARNED_LENGTH) continue;
    out = out.split(literal).join(REDACTED);
  }
  return out;
}

/**
 * Scrub an arbitrary value for logging.
 *
 * Objects are walked; strings are pattern-scrubbed and stripped of any
 * sensitive literal learned from the same payload; anything under a sensitive
 * key is replaced wholesale without inspecting it.
 */
export function scrubForLog(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (depth === 0) {
    const learned = new Set<string>();
    collectSensitiveValues(value, learned);
    return scrubWith(value, learned, 0, new WeakSet<object>());
  }
  return scrubWith(value, new Set<string>(), depth, seen);
}

function scrubWith(
  value: unknown,
  literals: Set<string>,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (depth > MAX_DEPTH) return '[max depth]';

  if (typeof value === 'string') return stripLiterals(scrubString(value), literals);
  if (value === null || typeof value !== 'object') return value;

  if (seen.has(value)) return '[circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((v) => scrubWith(v, literals, depth + 1, seen));
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      // Error messages routinely interpolate the very thing that went wrong,
      // which is routinely the sensitive value.
      message: stripLiterals(scrubString(value.message), literals),
      stack:
        value.stack === undefined
          ? undefined
          : stripLiterals(scrubString(value.stack), literals),
    };
  }

  // Binary payloads are file contents. Never log them; log their size.
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
    return `[binary ${value.byteLength} bytes]`;
  }

  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      out[key] = REDACTED;
      continue;
    }
    out[key] = scrubWith(v, literals, depth + 1, seen);
  }
  return out;
}

/**
 * Structured JSON log line (PHASE 13).
 *
 * Everything goes through `scrubForLog` — there is deliberately no way to
 * write a log entry that skips it. An "unscrubbed for debugging" escape hatch
 * is exactly what ends up in production.
 */
export interface LogEntry {
  level: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  message: string;
  requestId?: string;
  [key: string]: unknown;
}

export function formatLogLine(entry: LogEntry): string {
  const scrubbed = scrubForLog(entry) as Record<string, unknown>;
  return JSON.stringify({ ...scrubbed, timestamp: new Date().toISOString() });
}

/**
 * Sentry `beforeSend` hook (PHASE 13 item 3).
 *
 * Sentry's own PII scrubbing is enabled as well; this runs first and locally,
 * so nothing sensitive leaves the process even if the remote configuration is
 * wrong or changes.
 */
export function sentryBeforeSend(event: Record<string, unknown>): Record<string, unknown> {
  return scrubForLog(event) as Record<string, unknown>;
}
