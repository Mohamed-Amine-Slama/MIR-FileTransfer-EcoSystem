import { expect, test } from '@playwright/test';

/**
 * BUILD_SPEC P14.3 — the application half.
 *
 * The Cloudflare WAF, edge rate limiting and bot protection need an account
 * and remain open. These headers do not, and they are asserted here so one
 * silently dropped during a refactor fails CI instead of shipping.
 *
 * The CSP is checked by DIRECTIVE rather than by presence: `default-src *`
 * would satisfy an existence check while protecting nothing.
 */

test('every security header is present on a document response', async ({ page }) => {
  const response = await page.goto('/');
  expect(response).not.toBeNull();
  const headers = response!.headers();

  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['referrer-policy']).toBe('no-referrer');
  expect(headers['strict-transport-security']).toContain('max-age=');
  expect(headers['cross-origin-opener-policy']).toBe('same-origin');
  expect(headers['permissions-policy']).toContain('camera=()');
  expect(headers['permissions-policy']).toContain('geolocation=()');
});

test('the CSP names the directives that matter', async ({ page }) => {
  const response = await page.goto('/');
  const csp = response!.headers()['content-security-policy'] ?? '';

  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("base-uri 'none'");
  expect(csp).toContain("form-action 'self'");

  // 'wasm-unsafe-eval' is required by Cornerstone's WASM decoders and permits
  // only WebAssembly compilation. Full 'unsafe-eval' — which would allow
  // evaluating JavaScript from a string — must never appear.
  expect(csp).toContain("'wasm-unsafe-eval'");
  expect(csp).not.toMatch(/script-src[^;]*'unsafe-eval'[^-]/);

  // No wildcard sources anywhere. `default-src *` would satisfy a presence
  // check while protecting nothing.
  expect(csp).not.toContain('*');
});

test('the app loads with no CSP violations', async ({ page }) => {
  // A policy is only correct if the product still works under it.
  //
  // This checks the entry point. The stronger proof is that the whole e2e
  // suite — viewer.spec.ts included — now runs under this CSP: if it blocked
  // Cornerstone's workers or WASM decoders, those tests fail, which is exactly
  // the signal wanted. Widen the specific directive that blocks; never fall
  // back to 'unsafe-eval'.
  const violations: string[] = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (/Content Security Policy|Refused to (load|execute|connect|create)/i.test(text)) {
      violations.push(text);
    }
  });

  await page.goto('/');
  await page.waitForLoadState('networkidle');

  expect(violations, `CSP blocked something the app needs:\n${violations.join('\n')}`).toEqual([]);
});
