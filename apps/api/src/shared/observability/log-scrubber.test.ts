import { describe, expect, it } from 'vitest';
import {
  REDACTED,
  formatLogLine,
  scrubForLog,
  scrubString,
  sentryBeforeSend,
} from './log-scrubber';

/**
 * BUILD_SPEC PHASE 13 gate:
 * "Verified scrubbing by deliberately logging sensitive data and confirming it
 *  is stripped."
 *
 * "Trigger an error containing a patient name and a token → confirm neither
 *  appears in Sentry or the log store."
 *
 * These tests do exactly that: real-shaped secrets go in, and the assertion is
 * that the SERIALISED OUTPUT does not contain them anywhere — not that some
 * function was called.
 */

const PATIENT_NAME = 'محمد علي الطرابلسي';
const TOKEN = [
  'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9',
  'eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ',
  'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
].join('.');
const PHONE = '+218912345678';

describe('PHASE 13 log scrubbing (the gate)', () => {
  it('strips a patient name and a token from a logged error', () => {
    // The exact scenario the spec names.
    const error = new Error(`Failed to load study for ${PATIENT_NAME} using token ${TOKEN}`);

    const line = formatLogLine({
      level: 'error',
      message: 'study load failed',
      patientName: PATIENT_NAME,
      accessToken: TOKEN,
      err: error,
    });

    expect(line).not.toContain(PATIENT_NAME);
    expect(line).not.toContain(TOKEN);
    expect(line).not.toContain('eyJhbGciOi');
    expect(line).toContain(REDACTED);
  });

  it('strips a phone number even when it appears in free text', () => {
    // No field name to key off — this is what the pattern strategy is for.
    const line = formatLogLine({
      level: 'warn',
      message: `OTP delivery failed for ${PHONE}`,
    });
    expect(line).not.toContain(PHONE);
  });

  it('redacts by key even when the value looks innocuous', () => {
    // "Ali" has no distinctive shape; only the key reveals what it is.
    const out = scrubForLog({ fullName: 'Ali', notes: 'ok' }) as Record<string, unknown>;
    expect(out['fullName']).toBe(REDACTED);
    expect(out['notes']).toBe('ok');
  });

  it('scrubs nested structures at any depth', () => {
    const line = formatLogLine({
      level: 'error',
      message: 'nested',
      context: { request: { headers: { authorization: `Bearer ${TOKEN}` } } },
    });
    expect(line).not.toContain(TOKEN);
  });

  it('scrubs inside arrays', () => {
    const line = formatLogLine({
      level: 'info',
      message: 'batch',
      patients: [{ phone_e164: PHONE }, { phone_e164: '+21620123456' }],
    });
    expect(line).not.toContain(PHONE);
    expect(line).not.toContain('+21620123456');
  });

  it('strips a stack trace that interpolated a secret', () => {
    const err = new Error(`boom ${TOKEN}`);
    const out = scrubForLog(err) as { message: string; stack?: string };
    expect(out.message).not.toContain(TOKEN);
    expect(out.stack ?? '').not.toContain(TOKEN);
  });

  it('never logs file contents', () => {
    // A DICOM buffer in a log line is patient imaging in the log store.
    // Under a NEUTRAL key it is summarised by size...
    const neutral = formatLogLine({
      level: 'debug',
      message: 'ingest',
      payload: Buffer.from([1, 2, 3, 4, 5]),
    });
    expect(neutral).toContain('binary 5 bytes');
    expect(neutral).not.toContain('AQIDBAU'); // base64 of the bytes

    // ...and under a sensitive key it is dropped entirely, which is stricter.
    const sensitive = formatLogLine({
      level: 'debug',
      message: 'ingest',
      buffer: Buffer.from([1, 2, 3, 4, 5]),
    });
    expect(sensitive).toContain(REDACTED);
    expect(sensitive).not.toContain('AQIDBAU');
  });

  it('redacts provider and cloud credentials', () => {
    const stripeKey = ['sk', 'test', '51H8kLmNoPqRsTuVwXyZ0123'].join('_');
    const webhookSec = ['whsec', 'A1b2C3d4E5f6G7h8I9j0'].join('_');
    const awsKey = ['AKIA', '2E0A8F3B244C9986'].join('');
    const pgUrl = ['postgresql://mir_app:realpassword', '@db.internal:5432/mir'].join('');

    const line = formatLogLine({
      level: 'error',
      message: [
        `stripe ${stripeKey}`,
        webhookSec,
        `aws ${awsKey}`,
        pgUrl,
      ].join(' | '),
    });

    expect(line).not.toContain(stripeKey);
    expect(line).not.toContain(webhookSec);
    expect(line).not.toContain(awsKey);
    expect(line).not.toContain('realpassword');
  });

  it('redacts clinical fields — a diagnosis is not telemetry', () => {
    const line = formatLogLine({
      level: 'info',
      message: 'study',
      diagnosis: 'suspected fracture',
      clinicalNotes: 'reduced breath sounds',
    });
    expect(line).not.toContain('suspected fracture');
    expect(line).not.toContain('reduced breath sounds');
  });

  it('applies the same scrubbing to Sentry events', () => {
    // Shaped like a real Sentry event: user context alongside the message.
    // The name is learned from `user.fullName` and then stripped from the
    // message too.
    const event = sentryBeforeSend({
      message: `error for ${PATIENT_NAME}`,
      user: { fullName: PATIENT_NAME },
      extra: { accessToken: TOKEN, phone: PHONE },
    });
    const serialised = JSON.stringify(event);

    expect(serialised).not.toContain(PATIENT_NAME);
    expect(serialised).not.toContain(TOKEN);
    expect(serialised).not.toContain(PHONE);
  });

  it('DOCUMENTED LIMIT: a bare name in prose, with no field to learn it from, survives', () => {
    // This is the honest boundary of automated scrubbing, and it is recorded
    // as a test so nobody later mistakes it for a bug or assumes coverage that
    // does not exist.
    //
    // A personal name has no distinguishing shape — "Ali" is indistinguishable
    // from any other three-letter word — so pattern matching cannot find it,
    // and with no sensitive key in the payload there is nothing to learn from.
    // Dictionary or NER approaches are unreliable in both directions and would
    // mangle ordinary log text.
    //
    // MITIGATION, in order of effectiveness:
    //   1. Never interpolate patient data into log or error messages. Log the
    //      patient ID; it is a UUID and means nothing outside the database.
    //   2. Where an error must mention a patient, pass the record alongside so
    //      the value-learning pass can strip it (see the first test in this
    //      file, which is the realistic path).
    const line = formatLogLine({
      level: 'error',
      message: `unexpected failure for ${PATIENT_NAME}`,
    });

    // Deliberately asserting the CURRENT behaviour, not the desired one.
    expect(line).toContain(PATIENT_NAME);
  });

  it('keeps the fields that make a log useful', () => {
    // Scrubbing that removes everything is safe and worthless. Identifiers
    // that are NOT patient data must survive, or nothing is debuggable.
    const line = formatLogLine({
      level: 'info',
      message: 'study accessed',
      requestId: 'req-abc-123',
      studyId: '018f8e6a-0000-7000-8000-000000000001',
      durationMs: 42,
      statusCode: 200,
    });

    expect(line).toContain('req-abc-123');
    expect(line).toContain('018f8e6a-0000-7000-8000-000000000001');
    expect(line).toContain('42');
    expect(line).toContain('study accessed');
  });

  it('emits valid structured JSON with a timestamp', () => {
    const parsed = JSON.parse(formatLogLine({ level: 'info', message: 'hello' })) as {
      level: string;
      message: string;
      timestamp: string;
    };
    expect(parsed.level).toBe('info');
    expect(parsed.message).toBe('hello');
    expect(Number.isNaN(Date.parse(parsed.timestamp))).toBe(false);
  });

  it('survives circular structures instead of hanging', () => {
    // A logger that crashes takes away the only diagnostic channel, usually
    // at the moment it is most needed.
    const a: Record<string, unknown> = { name: 'x' };
    a['self'] = a;
    expect(() => formatLogLine({ level: 'error', message: 'cycle', a })).not.toThrow();
    expect(formatLogLine({ level: 'error', message: 'cycle', a })).toContain('[circular]');
  });

  it('is case- and separator-insensitive on key names', () => {
    const out = scrubForLog({
      'Patient-Name': 'x',
      PATIENT_NAME: 'y',
      accessToken: 'z',
    }) as Record<string, unknown>;

    expect(out['Patient-Name']).toBe(REDACTED);
    expect(out['PATIENT_NAME']).toBe(REDACTED);
    expect(out['accessToken']).toBe(REDACTED);
  });

  it('scrubString handles multiple secrets in one message', () => {
    const out = scrubString(`token ${TOKEN} phone ${PHONE} again ${PHONE}`);
    expect(out).not.toContain(TOKEN);
    expect(out).not.toContain(PHONE);
  });
});
