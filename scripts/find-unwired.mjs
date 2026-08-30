#!/usr/bin/env node
/**
 * Find exported symbols that only tests reference.
 *
 * WHY THIS EXISTS. The most expensive class of defect in this repository has
 * not been broken code — it has been CORRECT code that nothing calls, carrying
 * a green test suite and a ledger entry that reads as if the control were in
 * service. Three were found this way in one sitting:
 *
 *   - `formatLogLine` / `sentryBeforeSend` — the log scrubber. The API ran on
 *     Nest's default logger and printed exception messages verbatim.
 *   - `RateLimiter` — the API applied no rate limiting to any route, while the
 *     ledger said "logic tested; no alert delivery".
 *   - `Tracer` / `OtlpSpanExporter` — the application emitted no spans at all,
 *     while the checklist said spans "ship to a real OTLP collector".
 *
 * Each had thorough unit tests. Unit tests cannot see this: they are the very
 * references that make the symbol look used.
 *
 * THIS IS A REVIEW AID, NOT A GATE, and deliberately not wired into `pnpm
 * verify`. It reports honest false positives — test harnesses, in-memory
 * doubles, and error classes thrown only from their own module are all
 * legitimately test-referenced. Making it a gate would mean an allowlist, and
 * an allowlist is where the next unwired security control would go to hide.
 *
 * Read the output and ask of each row: SHOULD something in the application be
 * calling this? For a security control the answer is almost always yes.
 *
 * Run: node scripts/find-unwired.mjs [rootDir]
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.argv[2] ?? 'apps/api/src';

/** Categories that are expected to be referenced only by tests. */
const EXPECTED_TEST_ONLY = [
  { pattern: /^InMemory|^Memory[A-Z]|^Fake|^Stub|^Mock/, why: 'test double' },
  { pattern: /Error$/, why: 'error class, usually thrown from its own module' },
  { pattern: /testing\//, why: 'test harness', matchOn: 'file' },
];

function classify(name, file) {
  for (const rule of EXPECTED_TEST_ONLY) {
    const subject = rule.matchOn === 'file' ? file : name;
    if (rule.pattern.test(subject)) return rule.why;
  }
  return undefined;
}

const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.ts') && !p.endsWith('.d.ts')) files.push(p);
  }
})(ROOT);

const sources = files.filter((f) => !f.endsWith('.test.ts'));
const tests = files.filter((f) => f.endsWith('.test.ts'));
const sourceText = new Map(sources.map((f) => [f, readFileSync(f, 'utf8')]));
const testText = tests.map((f) => readFileSync(f, 'utf8'));

const EXPORT_RE =
  /^export\s+(?:async\s+)?(?:function|const|class|abstract\s+class)\s+([A-Za-z0-9_]+)/gm;

const suspicious = [];
const expected = [];

for (const [file, text] of sourceText) {
  for (const match of text.matchAll(EXPORT_RE)) {
    const name = match[1];
    const word = new RegExp(`\\b${name}\\b`);

    // References from OTHER production files. Same-file use does not count as
    // being wired in — a helper used only by its own module's dead code is
    // still dead.
    let productionRefs = 0;
    for (const [other, otherText] of sourceText) {
      if (other !== file && word.test(otherText)) productionRefs += 1;
    }
    if (productionRefs > 0) continue;

    const testRefs = testText.filter((t) => word.test(t)).length;
    if (testRefs === 0) continue; // exported and referenced nowhere: dead, but not this tool's subject

    const why = classify(name, file);
    (why === undefined ? suspicious : expected).push({ name, file, testRefs, why });
  }
}

const pad = (s, n) => String(s).padEnd(n);

console.log(`\nExports referenced ONLY by tests — ${ROOT}\n${'='.repeat(78)}`);

if (suspicious.length === 0) {
  console.log('\nNothing unexplained.\n');
} else {
  console.log(`\nWORTH A LOOK (${suspicious.length}) — should the app be calling these?\n`);
  for (const r of suspicious) {
    console.log(`  ${pad(r.name, 30)} ${r.file}  (${r.testRefs} test file(s))`);
  }
}

if (expected.length > 0) {
  console.log(`\nEXPECTED test-only (${expected.length}):\n`);
  for (const r of expected) {
    console.log(`  ${pad(r.name, 30)} ${pad(r.why, 42)} ${r.file}`);
  }
}

console.log(
  `\n${'='.repeat(78)}\n` +
    `This is a review aid. It does not fail the build, and a row here is not\n` +
    `automatically a defect — but a SECURITY CONTROL in the first list is.\n`,
);
