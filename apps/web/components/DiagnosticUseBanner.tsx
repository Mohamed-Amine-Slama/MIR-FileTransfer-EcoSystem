/**
 * Persistent "not for diagnostic use" banner — BUILD_SPEC P9.1, §1.3.
 *
 * THIS IS NOT A DISCLAIMER, IT IS A REGULATORY BOUNDARY.
 *
 * §1.3: "products that let clinicians diagnose from an uncertified viewer fall
 * into medical-device regulation. Staying on the transfer side of that line is
 * a deliberate design constraint, not a disclaimer."
 *
 * The platform is a transfer and scheduling service. The receiving doctor
 * performs the diagnostic read on their own validated equipment. Everything
 * this viewer shows is 8-bit, heuristically window-levelled and downsampled —
 * genuinely unfit for diagnosis, which is exactly why saying so is honest
 * rather than defensive.
 *
 * DELIBERATELY NOT DISMISSIBLE. No close button, no `hidden` prop, no
 * `localStorage` "don't show again". A banner a doctor can dismiss is a banner
 * that is absent during the reading that matters. There is no prop to turn it
 * off, so no future caller can be tempted.
 */
export function DiagnosticUseBanner() {
  return (
    <div
      data-testid="diagnostic-banner"
      role="note"
      aria-live="polite"
      className="sticky top-0 z-10 mb-4 rounded-md border border-current border-s-4 bg-warning-surface px-4 py-2.5 text-sm font-semibold text-warning"
    >
      {/* Arabic and French per DECISION D4. English is not a v1 locale, but the
          English sentence is the exact wording the spec mandates and is kept so
          the requirement is greppable in the source. */}
      <span lang="ar">للعرض المرجعي فقط — ليس للاستخدام التشخيصي</span>
      <span aria-hidden="true"> · </span>
      <span lang="fr">Visualisation de référence uniquement — pas pour usage diagnostique</span>
      <span data-testid="diagnostic-banner-en" lang="en" className="block font-normal opacity-85">
        Reference viewing only — not for diagnostic use
      </span>
    </div>
  );
}
