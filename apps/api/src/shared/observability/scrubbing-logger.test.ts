import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Controller, Get, Logger, Module, type INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { PublicEndpoint } from '../authz/access-metadata';
import { GlobalExceptionFilter } from '../errors/global-exception.filter';
import { ScrubbingLogger } from './scrubbing.logger';

/**
 * BUILD_SPEC PHASE 13 — the gate, as the spec words it:
 *
 *   "Trigger an error containing a patient name and a token → confirm neither
 *    appears in Sentry or the log store."
 *
 * `log-scrubber.test.ts` proves the scrubbing FUNCTION works. It cannot prove
 * the application uses it, and for a long time the application did not: the
 * scrubber had no non-test callers and Nest ran on its default console logger.
 * The suite was green while `GlobalExceptionFilter` printed exception messages
 * verbatim to stdout.
 *
 * So these tests assert reachability, not correctness of the algorithm:
 * an error is raised BEHIND A REAL HTTP REQUEST, travels through the real
 * exception filter, and what would have been written is captured at the sink.
 *
 * The last test asserts that main.ts installs the logger. A source assertion
 * is a blunt instrument, but this defect was precisely "the right code exists
 * and nothing calls it", and that is the shape of check that catches it.
 */

// Synthetic throughout (ADR-7). The JWT is three base64url segments of
// nonsense; the phone is a valid E.164 shape in the Libyan range.
const TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJkcmlsbCIsInJvbGUiOiJkb2N0b3IifQ.c2lnbmF0dXJlLXNoYXBlZC1ub25zZW5zZQ';
const PHONE = '+218912345678';
const EMAIL = 'drill.patient@example.test';

@Controller()
class ThrowingController {
  @PublicEndpoint()
  @Get('boom')
  boom(): never {
    // The realistic shape: an identifier interpolated into an error message by
    // code that never considered where the message ends up.
    throw new Error(`failed to load study for ${PHONE} (auth ${TOKEN}, ${EMAIL})`);
  }
}

async function buildApp(logger?: ScrubbingLogger): Promise<INestApplication> {
  @Module({
    controllers: [ThrowingController],
    providers: [{ provide: APP_FILTER, useClass: GlobalExceptionFilter }],
  })
  class TestModule {}

  const moduleRef = await Test.createTestingModule({ imports: [TestModule] }).compile();
  const app = moduleRef.createNestApplication({ bufferLogs: true });
  if (logger !== undefined) app.useLogger(logger);
  await app.init();
  return app;
}

let app: INestApplication | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
  // `useLogger` mutates Nest's static logger. Put it back so this file cannot
  // change how any other suite logs.
  Logger.overrideLogger(false);
});

describe('P13 the scrubber is actually in the log path', () => {
  it('strips a token, phone and email from an unhandled error raised over HTTP', async () => {
    const lines: string[] = [];
    app = await buildApp(new ScrubbingLogger((line) => lines.push(line)));

    await request(app.getHttpServer() as never)
      .get('/boom')
      .expect(500);

    const written = lines.join('\n');

    // It must have logged SOMETHING — a test that passes because nothing was
    // logged at all would be worthless.
    expect(written).toContain('unhandled error');

    expect(written).not.toContain(TOKEN);
    expect(written).not.toContain(PHONE);
    expect(written).not.toContain(EMAIL);
    expect(written).toContain('[redacted]');
  }, 60_000);

  it('NEGATIVE CONTROL: without the logger installed, the token reaches the sink', async () => {
    // Proof that the assertion above can fail. Nest's default logger is what
    // the application shipped with, and this is what it did with the same
    // request.
    //
    // BOTH streams are captured: Nest's ConsoleLogger sends error and fatal to
    // stderr and everything else to stdout, so watching stdout alone sees
    // nothing and the control would pass for the wrong reason — which is how
    // this test failed the first time it ran.
    const chunks: string[] = [];
    const capture =
      (real: typeof process.stdout.write) =>
      ((chunk: string | Uint8Array, ...rest: unknown[]): boolean => {
        chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
        return (real as (...a: unknown[]) => boolean)(chunk, ...rest);
      }) as typeof process.stdout.write;

    const realOut = process.stdout.write.bind(process.stdout);
    const realErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = capture(realOut);
    process.stderr.write = capture(realErr);

    try {
      app = await buildApp(); // no useLogger — the pre-fix behaviour
      await request(app.getHttpServer() as never)
        .get('/boom')
        .expect(500);
    } finally {
      process.stdout.write = realOut;
      process.stderr.write = realErr;
    }

    expect(chunks.join('')).toContain(PHONE);
    expect(chunks.join('')).toContain(TOKEN);
  }, 60_000);

  it('emits one JSON object per line, with a level and a timestamp', async () => {
    const lines: string[] = [];
    new ScrubbingLogger((line) => lines.push(line)).warn('disk nearly full', 'Storage');

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] ?? '') as Record<string, unknown>;
    expect(parsed['level']).toBe('warn');
    expect(parsed['message']).toBe('disk nearly full');
    expect(parsed['context']).toBe('Storage');
    expect(typeof parsed['timestamp']).toBe('string');
  });

  it('keeps a structured payload as fields so key-based redaction still applies', () => {
    // If the message were stringified, `patientName` would stop being a key
    // and key-based redaction could not see it.
    const lines: string[] = [];
    new ScrubbingLogger((line) => lines.push(line)).log(
      { patientName: 'Fatima Al-Mansouri', studyCount: 3 },
      'Imaging',
    );

    const parsed = JSON.parse(lines[0] ?? '') as Record<string, unknown>;
    const payload = parsed['payload'] as Record<string, unknown>;
    expect(payload['patientName']).toBe('[redacted]');
    expect(payload['studyCount']).toBe(3);
  });

  it('learns a name from a field and removes it from the message beside it', () => {
    const lines: string[] = [];
    new ScrubbingLogger((line) => lines.push(line)).error(
      { message: 'render failed for Fatima Al-Mansouri', patientName: 'Fatima Al-Mansouri' },
      'Viewer',
    );

    expect(lines.join('')).not.toContain('Fatima Al-Mansouri');
  });

  it('LIMITATION, recorded not fixed: a bare name in free text is NOT stripped', () => {
    // A name has no detectable shape, and with no field in the same payload
    // there is nothing to learn it from. The mitigation is not to interpolate
    // patient data into messages. This is here so the gap is visible as a
    // passing test rather than mistaken for coverage.
    const lines: string[] = [];
    new ScrubbingLogger((line) => lines.push(line)).error(
      'render failed for Fatima Al-Mansouri',
      'Viewer',
    );

    expect(lines.join('')).toContain('Fatima Al-Mansouri');
  });

  it('main.ts installs the logger, and buffers startup logs until it does', () => {
    const main = readFileSync(resolve(__dirname, '..', '..', 'main.ts'), 'utf8');

    expect(main, 'main.ts must install ScrubbingLogger via useLogger').toMatch(
      /useLogger\(\s*new ScrubbingLogger\(\)\s*\)/,
    );
    // Without bufferLogs, every line Nest writes while constructing modules
    // has already gone out through the default logger before useLogger runs.
    expect(main, 'main.ts must set bufferLogs so startup lines are replayed').toMatch(
      /bufferLogs:\s*true/,
    );
  });
});
