'use client';

import Link from 'next/link';
import { Banknote, FolderKanban, ShieldAlert, Upload } from 'lucide-react';
import { useT } from '../../lib/i18n/provider';
import { Alert, buttonVariants } from '../ui';

/**
 * The public landing page — what a visitor sees at `/` before signing in.
 *
 * THE ONE THING THIS PAGE MAY NOT DO is oversell what the product is. §4.1
 * forbids playful microcopy on anything touching case status, files, or money,
 * and there is a harder constraint underneath it: this is a TRANSFER AND
 * SCHEDULING SERVICE, not a diagnostic tool, and a landing page that implied
 * otherwise would be describing a regulated medical device. So the
 * reference-only limit gets a section of its own rather than a line in the
 * footer — it is a product boundary, and prospective customers have to
 * understand it before they sign up, not after.
 *
 * Everything else is allowed the expressive treatment, and gets it: display
 * type, the gradient hero, generous rhythm. All of it resolves from
 * `.marketing`, which only `PublicChrome` sets.
 */
export function Landing(): React.JSX.Element {
  const t = useT();

  const features = [
    { Icon: Upload, title: t.landingFeatureTransferTitle, body: t.landingFeatureTransferBody },
    { Icon: FolderKanban, title: t.landingFeaturePipelineTitle, body: t.landingFeaturePipelineBody },
    { Icon: Banknote, title: t.landingFeatureBillingTitle, body: t.landingFeatureBillingBody },
  ];

  const steps = [
    { title: t.landingStepRegisterTitle, body: t.landingStepRegisterBody },
    { title: t.landingStepSubmitTitle, body: t.landingStepSubmitBody },
    { title: t.landingStepTrackTitle, body: t.landingStepTrackBody },
  ];

  return (
    <main>
      <section className="marketing-hero border-b">
        <div className="mx-auto max-w-4xl px-4 py-20 text-center sm:px-6 sm:py-28">
          <h1 className="marketing-display text-4xl sm:text-6xl">{t.landingHeadline}</h1>
          <p className="mx-auto mt-6 max-w-2xl text-base text-muted-foreground sm:text-lg">
            {t.landingSubhead}
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Link
              href="/signup"
              className={`${buttonVariants({ size: 'lg' })} min-w-48`}
              data-testid="landing-signup"
            >
              {t.landingCtaPrimary}
            </Link>
            <Link
              href="/pricing"
              className={`${buttonVariants({ variant: 'outline', size: 'lg' })} min-w-48`}
              data-testid="landing-pricing"
            >
              {t.landingCtaSecondary}
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="grid gap-6 md:grid-cols-3">
          {features.map(({ Icon, title, body }) => (
            <div key={title} className="rounded-xl border bg-card p-6 shadow-sm">
              <span className="flex size-10 items-center justify-center rounded-lg bg-accent">
                <Icon className="size-5 text-primary" aria-hidden="true" />
              </span>
              <h2 className="mt-4 text-base font-semibold">{title}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-y bg-muted/40">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="marketing-display text-2xl sm:text-3xl">{t.landingHowTitle}</h2>
          <ol className="mt-8 grid gap-6 md:grid-cols-3">
            {steps.map((step, index) => (
              <li key={step.title} className="flex gap-4">
                <span
                  aria-hidden="true"
                  className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground"
                >
                  {index + 1}
                </span>
                <div>
                  <h3 className="text-base font-semibold">{step.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/*
        Not a disclaimer in small print. The distinction between a transfer
        service and a diagnostic one is the product's defining constraint, and
        the in-app viewer carries an undismissable banner saying so — this is
        the same statement, made before anyone signs up rather than after.
      */}
      <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <span className="flex size-10 items-center justify-center rounded-lg bg-warning-surface">
            <ShieldAlert className="size-5 text-warning" aria-hidden="true" />
          </span>
          <h2 className="mt-4 text-base font-semibold">{t.landingNotDiagnosticTitle}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t.landingNotDiagnosticBody}</p>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-4 pb-20 sm:px-6">
        <Alert tone="info">{t.footerDisclaimer}</Alert>
      </section>
    </main>
  );
}
