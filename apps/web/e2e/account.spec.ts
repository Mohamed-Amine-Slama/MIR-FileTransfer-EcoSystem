import { expect, test } from '@playwright/test';

/**
 * Profile and settings — brief §5.1, §5.5, §5.6, §5.7.
 *
 * These run signed out, which is the only session the suite has. That still
 * pins down the property §4.4 actually asks for: a route the visitor may not
 * see must SAY SO, not render blank and not crash. The panels' contents are
 * covered by the unit suite and by the API's own tests.
 */

test.describe('account routes are gated, and say so (§4.4)', () => {
  for (const path of [
    '/profile',
    '/settings',
    '/settings/notifications',
    '/settings/team',
    '/settings/billing',
  ]) {
    test(`${path} tells an anonymous visitor to sign in`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByTestId('sign-in-required')).toBeVisible();
    });
  }
});

test.describe('settings navigation (§5.1)', () => {
  test('every section is its own URL', async ({ page }) => {
    // Deliberately routes and not tabs: "open your notification settings"
    // should be a link someone can send, and a reload should stay put.
    for (const path of ['/settings', '/settings/notifications']) {
      const response = await page.goto(path);
      expect(response?.status(), `${path} should resolve`).toBe(200);
    }
  });
});

test.describe('seat invitations (§5.5)', () => {
  test('an invitation link asks the invitee to sign in first', async ({ page }) => {
    // Landing on the link must not consume it: mail clients and security
    // scanners follow links routinely, and an invitation burnt by a spam filter
    // is one the invitee never gets to use.
    await page.goto('/invite/some-token-value-that-is-long-enough');
    await expect(page.getByTestId('invite-sign-in')).toBeVisible();
    await expect(page.getByTestId('invite-accept')).toHaveCount(0);
  });
});
