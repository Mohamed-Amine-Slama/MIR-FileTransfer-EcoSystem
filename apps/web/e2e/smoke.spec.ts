import { expect, test } from '@playwright/test';

test('placeholder page renders (P1.2)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'MIR' })).toBeVisible();
});

test('document direction is RTL by default (DECISION D4)', async ({ page }) => {
  await page.goto('/');
  // RTL is a day-one constraint, not a later i18n task. If this assertion ever
  // starts failing because someone switched the default to LTR "for now",
  // that is the retrofit D4 exists to prevent.
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
});

test('does not advertise the server technology', async ({ page }) => {
  const res = await page.goto('/');
  expect(res?.headers()['x-powered-by']).toBeUndefined();
  expect(res?.headers()['x-content-type-options']).toBe('nosniff');
});
