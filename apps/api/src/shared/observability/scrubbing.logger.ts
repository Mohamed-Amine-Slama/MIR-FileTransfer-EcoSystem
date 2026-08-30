import type { LoggerService, LogLevel } from '@nestjs/common';
import { formatLogLine, type LogEntry } from './log-scrubber';

/**
 * The scrubber, actually in the path — BUILD_SPEC PHASE 13.
 *
 * WHAT WAS WRONG. `log-scrubber.ts` was written, tested with 16 cases, and
 * called by NOTHING. `formatLogLine` and `sentryBeforeSend` had no non-test
 * callers anywhere in the application. Nest was left on its default
 * `ConsoleLogger`, so every line the API actually emitted — including
 * `GlobalExceptionFilter`'s `unhandled error: ...`, which prints an exception
 * message verbatim — went to stdout unscrubbed.
 *
 * It went unnoticed for the reason these things always do: the unit tests were
 * green and they were testing the right function. Nobody checked that the
 * function was reachable from a running process. The evidence was sitting in
 * the CI output the whole time — the test suite's own log lines showed a
 * patient name printed in full.
 *
 * WHY A LOGGER AND NOT A PATCH AT EACH CALL SITE. There are dozens of log
 * calls and there will be more; any of them can be written by someone who has
 * not read PHASE 13. Routing at the sink means a new `Logger.error(...)`
 * inherits scrubbing without its author knowing the scrubber exists. That is
 * the only version of this that survives contact with a growing codebase.
 *
 * WHAT IT DOES AND DOES NOT CATCH. Everything through Nest's `Logger` is
 * covered, including framework startup lines (main.ts sets `bufferLogs`, so
 * they are replayed through here rather than escaping before installation).
 * A direct `console.log` bypasses it — that is what the `no-console` lint rule
 * is for, and the two deliberate exceptions in main.ts run before any request
 * and log configuration failures only.
 *
 * The known limitation is `log-scrubber.ts`'s, not this file's: a patient name
 * appearing ONLY in free text, with no field in the same payload to learn it
 * from, has no detectable shape and is not stripped. Pass the name as a field
 * (`{ patientName }`) and the message is cleaned by literal-learning; write it
 * into the string and nothing can help. Recorded as a passing test in
 * `scrubbing-logger.test.ts` so it is not mistaken for coverage.
 */

/** Nest's own heuristic for telling a stack trace from a context string. */
function looksLikeStack(value: string): boolean {
  return /\n\s*at\s/.test(value);
}

const LEVELS: Record<string, LogEntry['level']> = {
  log: 'info',
  error: 'error',
  warn: 'warn',
  debug: 'debug',
  verbose: 'trace',
  fatal: 'fatal',
};

export class ScrubbingLogger implements LoggerService {
  /**
   * The sink is injectable so a test can capture what would be written
   * WITHOUT reaching into `process.stdout`, which vitest also writes to.
   */
  constructor(private readonly sink: (line: string) => void = defaultSink) {}

  log(message: unknown, ...params: unknown[]): void {
    this.emit('log', message, params);
  }

  error(message: unknown, ...params: unknown[]): void {
    this.emit('error', message, params);
  }

  warn(message: unknown, ...params: unknown[]): void {
    this.emit('warn', message, params);
  }

  debug(message: unknown, ...params: unknown[]): void {
    this.emit('debug', message, params);
  }

  verbose(message: unknown, ...params: unknown[]): void {
    this.emit('verbose', message, params);
  }

  fatal(message: unknown, ...params: unknown[]): void {
    this.emit('fatal', message, params);
  }

  setLogLevels(_levels: LogLevel[]): void {
    // Level filtering is the platform's job (log group retention and query
    // filters). Dropping lines here would lose audit-adjacent context for no
    // benefit — and a level filter is not a security control.
  }

  private emit(method: string, message: unknown, params: unknown[]): void {
    const rest = [...params];

    // Nest appends the context as the final string argument. A stack, when
    // present, arrives first. With only one trailing string the two are
    // ambiguous, so distinguish them by shape rather than by position.
    let context: string | undefined;
    let stack: string | undefined;

    const last = rest[rest.length - 1];
    if (typeof last === 'string' && !looksLikeStack(last)) {
      context = last;
      rest.pop();
    }
    if (typeof rest[0] === 'string' && looksLikeStack(rest[0])) {
      stack = rest.shift() as string;
    }

    // A non-string message goes into a FIELD, never a stringified message.
    // `JSON.stringify({ patientName })` into the message would defeat
    // key-based redaction — the key would no longer be a key.
    const entry: LogEntry = {
      level: LEVELS[method] ?? 'info',
      message: typeof message === 'string' ? message : '(structured)',
      ...(typeof message === 'string' ? {} : { payload: message }),
      ...(context === undefined ? {} : { context }),
      ...(stack === undefined ? {} : { stack }),
      ...(rest.length > 0 ? { details: rest } : {}),
    };

    this.sink(formatLogLine(entry));
  }
}

/**
 * One JSON object per line, on stdout, at every level.
 *
 * Not `console.log` — console applies its own formatting and is routinely
 * intercepted by test runners and instrumentation, either of which can reshape
 * a line that is supposed to be machine-parseable.
 *
 * Not stderr for errors, which is what Nest's ConsoleLogger does: splitting a
 * single stream by level means a collector reading only stdout silently loses
 * exactly the lines that matter. The level is a field; the transport is one
 * stream.
 */
function defaultSink(line: string): void {
  process.stdout.write(`${line}\n`);
}
