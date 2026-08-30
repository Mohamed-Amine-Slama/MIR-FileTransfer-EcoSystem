import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The dark palette in globals.css is declared TWICE — once inside the
 * prefers-color-scheme media query for users who have chosen nothing, and once
 * on `:root[data-theme="dark"]` so an explicit choice beats the operating
 * system. The comment there explains why one declaration cannot cover both
 * without `light-dark()`, which is too new for the clinic machines this runs on.
 *
 * Duplication drifts. This is the duplication as a test: change one block and
 * the other is reported, rather than discovered by a user on a dark OS whose
 * status badge is the only element that stayed light.
 */

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CSS = readFileSync(join(WEB_ROOT, 'app', 'globals.css'), 'utf8');

/**
 * Every declaration for a selector, merged across all of its blocks — which is
 * what the cascade does anyway, and `:root[data-theme='dark']` legitimately
 * appears twice (once for the palette, once for `color-scheme`).
 *
 * Brace-matched rather than regex-to-the-next-`}`: a nested block would
 * otherwise truncate the capture silently and make every assertion below pass
 * against half a palette.
 */
function declarationsFor(selector: string): Map<string, string> {
  const found = new Map<string, string>();
  let cursor = 0;

  for (;;) {
    const start = CSS.indexOf(selector, cursor);
    if (start === -1) break;

    const open = CSS.indexOf('{', start);
    if (open === -1) break;

    let depth = 1;
    let i = open + 1;
    while (i < CSS.length && depth > 0) {
      if (CSS[i] === '{') depth += 1;
      else if (CSS[i] === '}') depth -= 1;
      i += 1;
    }

    for (const line of CSS.slice(open + 1, i - 1).split('\n')) {
      const match = /^\s*(--[a-z0-9-]+)\s*:\s*(.+?);\s*$/.exec(line);
      if (match?.[1] !== undefined && match[2] !== undefined) {
        found.set(match[1], match[2].trim());
      }
    }
    cursor = i;
  }

  return found;
}

const LIGHT = declarationsFor(':root {');
const DARK_SYSTEM = declarationsFor(":root:not([data-theme='light'])");
const DARK_EXPLICIT = declarationsFor(":root[data-theme='dark']");

describe('theme tokens', () => {
  it('finds all three blocks, so a selector change cannot make this vacuous', () => {
    expect(LIGHT.size).toBeGreaterThan(20);
    expect(DARK_SYSTEM.size).toBeGreaterThan(20);
    expect(DARK_EXPLICIT.size).toBeGreaterThan(20);
  });

  it('declares the same custom properties in both dark blocks', () => {
    expect([...DARK_EXPLICIT.keys()].sort()).toEqual([...DARK_SYSTEM.keys()].sort());
  });

  it('gives every property the same value in both dark blocks', () => {
    const drifted = [...DARK_SYSTEM.entries()]
      .filter(([key, value]) => DARK_EXPLICIT.get(key) !== value)
      .map(([key]) => key);
    expect(drifted).toEqual([]);
  });

  it('overrides every colour the light block declares', () => {
    // --radius is intentionally not themed: a shape does not change with the
    // colour scheme. Everything else must, or dark mode inherits a light value
    // and the pairing is no longer the contrast-checked one.
    const unthemed = [...LIGHT.keys()].filter(
      (key) => key !== '--radius' && !DARK_SYSTEM.has(key),
    );
    expect(unthemed).toEqual([]);
  });

  it('introduces no dark-only token that light has no answer for', () => {
    const orphaned = [...DARK_SYSTEM.keys()].filter((key) => !LIGHT.has(key));
    expect(orphaned).toEqual([]);
  });
});

describe('the @theme mapping', () => {
  const theme = declarationsFor('@theme inline');

  it('resolves every colour utility to a token that actually exists', () => {
    const dangling = [...theme.entries()]
      .filter(([key]) => key.startsWith('--color-'))
      .map(([, value]) => /^var\((--[a-z0-9-]+)\)$/.exec(value)?.[1])
      .filter((token): token is string => token !== undefined)
      .filter((token) => !LIGHT.has(token));
    expect(dangling).toEqual([]);
  });
});

describe('the pre-paint theme script', () => {
  const INIT = readFileSync(join(WEB_ROOT, 'public', 'theme-init.js'), 'utf8');

  it('sets the attribute only for the two explicit themes', () => {
    // "system" must set nothing at all: the attribute's absence is what leaves
    // the prefers-color-scheme query in charge.
    expect(INIT).toContain("=== 'light'");
    expect(INIT).toContain("=== 'dark'");
    expect(INIT).not.toContain("'system'");
  });

  it('survives storage that throws rather than returns null', () => {
    // A private window, blocked site data, or a thumbnail capture makes the
    // ACCESS throw. Without the guard this script blanks the page.
    expect(INIT).toContain('try');
    expect(INIT).toContain('catch');
  });

  it('reads the key the provider writes', () => {
    const provider = readFileSync(join(WEB_ROOT, 'lib', 'theme', 'theme.tsx'), 'utf8');
    expect(INIT).toContain("'mir.theme'");
    expect(provider).toContain("'mir.theme'");
  });
});
