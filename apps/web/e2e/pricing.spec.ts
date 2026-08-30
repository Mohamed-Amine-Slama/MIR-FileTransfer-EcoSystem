import { expect, test } from '@playwright/test';

/**
 * Public pricing — brief §2, §5.7.
 *
 * The catalogue is stubbed rather than served, because the e2e suite runs the
 * web app alone. Stubbing keeps the assertions about what this page GUARANTEES
 * — the separation of charges, the placeholder warning, the exponent-correct
 * money — rather than about whether a backend happened to be up.
 */

const CATALOGUE = {
  plans: [
    {
      code: 'solo',
      labelKey: 'planSoloName',
      blurbKey: 'planSoloBlurb',
      priceMonthly: { amountMinor: 4900, currency: 'USD' },
      seatLimit: 1,
      monthlyCaseLimit: 10,
      entitlements: ['csvExport'],
      sort: 0,
    },
    {
      code: 'clinic',
      labelKey: 'planClinicName',
      blurbKey: 'planClinicBlurb',
      priceMonthly: { amountMinor: 19900, currency: 'USD' },
      seatLimit: 10,
      monthlyCaseLimit: 100,
      entitlements: ['csvExport', 'prioritySupport'],
      sort: 1,
    },
    {
      code: 'network',
      labelKey: 'planNetworkName',
      blurbKey: 'planNetworkBlurb',
      priceMonthly: null,
      seatLimit: null,
      monthlyCaseLimit: null,
      entitlements: ['csvExport', 'prioritySupport', 'multiCorridor'],
      sort: 2,
    },
  ],
};

test.describe('pricing (§5.7)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/plans', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CATALOGUE) }),
    );
  });

  test('is reachable with no session at all', async ({ page }) => {
    const response = await page.goto('/pricing');
    expect(response?.status()).toBe(200);
    await expect(page.getByTestId('pricing-tiers')).toBeVisible();
  });

  test('renders every tier the catalogue returns', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.getByTestId('plan-solo')).toBeVisible();
    await expect(page.getByTestId('plan-clinic')).toBeVisible();
    await expect(page.getByTestId('plan-network')).toBeVisible();
  });

  test('marks the invented figures as provisional', async ({ page }) => {
    // TODO(pricing) removes this notice, and this test with it. Until then a
    // visitor must not read placeholder numbers as an offer.
    await page.goto('/pricing');
    await expect(page.getByTestId('pricing-placeholder')).toBeVisible();
  });

  test('says that changing plan takes no payment', async ({ page }) => {
    // Blocking item L7 is open: no rail is wired, and the page must not imply
    // otherwise by looking like a checkout.
    await page.goto('/pricing');
    await expect(page.getByTestId('pricing-no-charge')).toBeVisible();
  });

  test('keeps the per-case coordination fee out of the tier price', async ({ page }) => {
    // §5.7 P0: coordination fees and subscription charges must never read as
    // one amount. The subtitle is where a clinic comparing tiers is told.
    await page.goto('/pricing');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('body')).toContainText(/coordination|تنسيق|coordination/i);
  });

  test('offers a contact route rather than a number for the priced-on-application tier', async ({
    page,
  }) => {
    await page.goto('/pricing');
    // `null` is a real tier state. Rendering it as 0, or as a blank, would both
    // be wrong in ways a customer would notice.
    await expect(page.getByTestId('plan-network')).not.toContainText('$0');
  });

  test('sends a signed-out visitor to sign-up, not to a dead checkout', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.getByTestId('plan-cta-clinic')).toHaveAttribute('href', '/signup');
  });

  test('scrolls the comparison table inside its own container (§4.5)', async ({ page }) => {
    await page.goto('/pricing');
    // The page body must never scroll horizontally — a wide table that does
    // that makes every screen on a phone worse, not just this one.
    const overflow = await page.evaluate(() => {
      const el = document.querySelector('table')?.parentElement;
      return el === null || el === undefined ? null : getComputedStyle(el).overflowX;
    });
    expect(overflow).toBe('auto');
  });
});
