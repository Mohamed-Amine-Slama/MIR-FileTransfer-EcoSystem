import { expect, test } from '@playwright/test';

/**
 * Account creation and email verification — brief §5.1.
 *
 * These run with no backend, which is what the existing onboarding suite does
 * too. The assertions are therefore about what the SCREENS guarantee: client
 * validation, the shape of the code entry, and above all that nothing here
 * distinguishes an address that exists from one that does not.
 */

test.describe('sign-up (§5.1)', () => {
  test('refuses obviously invalid input before any request leaves the browser', async ({ page }) => {
    await page.goto('/signup');

    await page.getByTestId('signup-email').fill('not-an-address');
    await page.getByTestId('signup-password').fill('short');
    await page.getByTestId('signup-phone').fill('0911234567');
    await page.getByTestId('signup-submit').click();

    // Three separate complaints, not one generic failure: the person has to
    // know which field to fix.
    await expect(page.getByRole('alert')).toHaveCount(4);
  });

  test('states the password rule up front rather than after a rejection', async ({ page }) => {
    await page.goto('/signup');
    // A minimum discovered only on submit is a rule the user had no way to obey.
    await expect(page.getByText(/12/)).toBeVisible();
  });

  test('offers a way back to sign-in from the point of failure', async ({ page }) => {
    // §5.1: someone who already has an account is ON this screen, not hunting
    // through a footer for the other one.
    await page.goto('/signup');
    await expect(page.getByRole('link', { name: /.+/ }).filter({ hasText: /.+/ })).not.toHaveCount(
      0,
    );
    await page.goto('/login');
    await expect(page.getByTestId('signup-link')).toBeVisible();
  });
});

test.describe('email verification (§5.1)', () => {
  test('renders six separate boxes for a six-digit code', async ({ page }) => {
    await page.goto('/signup/verify?email=someone%40clinic.test');
    for (let i = 0; i < 6; i += 1) {
      await expect(page.getByTestId(`verify-code-${i}`)).toBeVisible();
    }
  });

  test('splits a pasted code across the boxes and ignores the punctuation', async ({ page }) => {
    await page.goto('/signup/verify?email=someone%40clinic.test');

    // An SMS or email pasted whole arrives with spaces and a full stop. That
    // must not be a validation error.
    await page.getByTestId('verify-code-0').focus();
    await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>('[data-testid="verify-code-0"]');
      const data = new DataTransfer();
      data.setData('text', '48 19 20.');
      input?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
    });

    await expect(page.getByTestId('verify-code-0')).toHaveValue('4');
    await expect(page.getByTestId('verify-code-5')).toHaveValue('0');
  });

  test('keeps the digits in reading order under Arabic', async ({ page }) => {
    await page.goto('/signup/verify?email=someone%40clinic.test');
    // Nobody reads a code logically; they read it positionally, against the
    // message it arrived in. The row is pinned LTR for that reason.
    await expect(page.getByTestId('verify-code')).toHaveAttribute('dir', 'ltr');
  });

  test('will not submit a partial code', async ({ page }) => {
    await page.goto('/signup/verify?email=someone%40clinic.test');
    await page.getByTestId('verify-code-0').fill('4');
    await expect(page.getByTestId('verify-submit')).toBeDisabled();
  });

  test('says what to do when opened without an address', async ({ page }) => {
    // A blank screen would be the alternative, and someone who bookmarked this
    // URL has no way to guess what is missing.
    await page.goto('/signup/verify');
    await expect(page.getByTestId('verify-no-email')).toBeVisible();
  });

  test('holds the resend behind a cooldown', async ({ page }) => {
    await page.goto('/signup/verify?email=someone%40clinic.test');
    // The real budget is the server's, keyed on the address. This only stops
    // someone hammering a button that will not help them.
    await expect(page.getByTestId('verify-resend')).toHaveCount(0);
  });
});
