import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The CSP in `next.config.mjs` carries `script-src 'unsafe-inline'`, because
 * Next's App Router streams RSC payloads through inline script tags and these
 * routes are statically prerendered, so a per-request nonce cannot reach them.
 *
 * That comment justifies the weakening with a claim: this application has no
 * path by which attacker-controlled markup reaches the document. React escapes
 * every interpolation, and nothing here opts out of that.
 *
 * A claim in a comment decays. This is the claim as a test.
 *
 * If a future change genuinely needs one of these, the honest response is to
 * fix the CSP first — adopt the nonce and force dynamic rendering — not to add
 * an exception here.
 */

const WEB_ROOT = resolve(__dirname, '..', '..');
const SEARCH_DIRS = ['app', 'components', 'lib'];

/** Escape-hatches out of React's automatic escaping, and script evaluation. */
const FORBIDDEN: { pattern: RegExp; why: string }[] = [
  { pattern: /dangerouslySetInnerHTML/, why: "React's explicit escape hatch" },
  { pattern: /\.innerHTML\s*=/, why: 'direct DOM injection' },
  { pattern: /\.outerHTML\s*=/, why: 'direct DOM injection' },
  { pattern: /\beval\s*\(/, why: 'evaluates a string as code' },
  { pattern: /new\s+Function\s*\(/, why: 'evaluates a string as code' },
  { pattern: /insertAdjacentHTML/, why: 'direct DOM injection' },
  { pattern: /javascript:/, why: 'script URL' },
];

function sourceFiles(dir: string): string[] {
  const abs = join(WEB_ROOT, dir);
  const walk = (d: string): string[] => {
    let entries: string[];
    try {
      entries = readdirSync(d);
    } catch {
      return [];
    }
    return entries.flatMap((e) => {
      const p = join(d, e);
      if (e === 'node_modules' || e.startsWith('.')) return [];
      if (statSync(p).isDirectory()) return walk(p);
      return /\.(ts|tsx|js|jsx|mjs)$/.test(e) ? [p] : [];
    });
  };
  return walk(abs);
}

describe('P14.3 — the XSS surface the CSP exception depends on', () => {
  const files = SEARCH_DIRS.flatMap(sourceFiles);

  it('finds source files to check', () => {
    // A path change that silently emptied the search would make every
    // assertion below vacuously true.
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(FORBIDDEN)('does not use $pattern ($why)', ({ pattern }) => {
    const offenders = files
      .filter((f) => !f.endsWith('xss-surface.test.ts'))
      .filter((f) => pattern.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(WEB_ROOT.length + 1));

    expect(
      offenders,
      `${String(pattern)} found. The CSP's script-src 'unsafe-inline' is ` +
        `justified by this NOT existing. Fix the CSP before adding one.`,
    ).toEqual([]);
  });
});
