'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import { Paperclip, Send } from 'lucide-react';
import type { Case, CaseEvent, Message, Provider } from '@mir/contracts';
import { casesApi } from '../../../lib/api/mock';
import { PROVIDER_ROLES } from '../../../lib/corridor/registry';
import { useCurrentProvider } from '../../../lib/provider/current-provider';
import { useDateFormat, useT } from '../../../lib/i18n/provider';
import { useSession } from '../../../lib/session/session';
import { RoleGate } from '../../../components/RoleGate';
import { CaseStatusBadge } from '../../../components/case/CaseStatusBadge';
import { CaseTimeline } from '../../../components/case/CaseTimeline';
import { nextActionLabel, sideLabel } from '../../../components/case/labels';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Main,
  PageHeader,
  Spinner,
  buttonVariants,
} from '../../../components/ui';

/**
 * One case, end to end — brief §5.3 (status and history), §5.4 (files), and
 * §5.6 (case-scoped messaging).
 *
 * These live on one screen rather than three because the clinic's question is
 * always about a case, never about a subsystem: "where is MIR-2026-0417, what
 * did they say, and are the films there?"
 */
export default function CaseDetailPage({
  params,
}: {
  params: Promise<{ ref: string }>;
}): React.JSX.Element {
  const { ref } = use(params);
  return (
    <RoleGate allow={PROVIDER_ROLES}>
      <CaseDetail caseRef={ref} />
    </RoleGate>
  );
}

function CaseDetail({ caseRef }: { caseRef: string }): React.JSX.Element {
  const t = useT();
  const formatDate = useDateFormat();
  const { user } = useSession();
  const { side } = useCurrentProvider();

  const [item, setItem] = useState<Case | null | 'missing'>(null);
  const [events, setEvents] = useState<CaseEvent[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [parties, setParties] = useState<{ from: Provider | null; to: Provider | null }>({
    from: null,
    to: null,
  });
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const found = await casesApi.getCase(caseRef);
    if (found === null) {
      setItem('missing');
      return;
    }
    setItem(found);
    const [timeline, thread, from, to] = await Promise.all([
      casesApi.listCaseEvents(caseRef),
      casesApi.listMessages(caseRef),
      casesApi.getProvider(found.submittedByProviderId),
      found.matchedProviderId === undefined
        ? Promise.resolve(null)
        : casesApi.getProvider(found.matchedProviderId),
    ]);
    setEvents(timeline);
    setMessages(thread);
    setParties({ from, to });
  }, [caseRef]);

  useEffect(() => {
    void load().catch(() => setError(t.genericError));
  }, [load, t]);

  const send = async (): Promise<void> => {
    if (draft.trim() === '') return;
    setSending(true);
    try {
      await casesApi.sendMessage(caseRef, draft.trim(), user?.displayName ?? '—');
      setDraft('');
      setMessages(await casesApi.listMessages(caseRef));
    } catch {
      setError(t.genericError);
    } finally {
      setSending(false);
    }
  };

  if (item === null) {
    return (
      <Main>
        <Spinner label={t.loading} />
      </Main>
    );
  }

  if (item === 'missing') {
    return (
      <Main>
        <Alert tone="danger" testId="case-not-found">
          {t.caseNotFound}
        </Alert>
        <Link href="/cases" className={buttonVariants({ variant: 'outline' })}>
          {t.casesTitle}
        </Link>
      </Main>
    );
  }

  return (
    <Main>
      <PageHeader
        title={t.caseDetailHeading}
        description={item.ref}
        actions={<CaseStatusBadge status={item.status} />}
      />

      {error !== null && <Alert tone="danger">{error}</Alert>}

      {side !== null && (
        <Alert tone="info" testId="next-action">
          {nextActionLabel(t, item.status, side)}
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <h2 className="mb-3 text-lg font-semibold">{t.caseIntakeTitle}</h2>
            <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {Object.entries(item.intake).map(([key, value]) => (
                <div key={key}>
                  <dt className="text-xs text-muted-foreground">{key}</dt>
                  <dd className="text-sm">{String(value)}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card>
            <h2 className="mb-3 text-lg font-semibold">{t.caseFilesTitle}</h2>
            {item.studyIds.length === 0 ? (
              <EmptyState testId="files-empty">{t.caseFilesEmpty}</EmptyState>
            ) : (
              <ul className="space-y-2">
                {item.studyIds.map((studyId) => (
                  <li key={studyId} className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex items-center gap-2">
                      <Paperclip className="size-4 text-muted-foreground" />
                      <bdi className="font-mono text-xs">{studyId}</bdi>
                    </span>
                    {/* Deep link into the existing viewer: the case owns the
                        study, it does not replace the imaging pipeline. */}
                    <Link
                      href={`/viewer/${studyId}`}
                      className="font-semibold text-primary hover:underline"
                    >
                      {t.viewDetails}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4">
              <Link href="/upload" className={buttonVariants({ variant: 'outline' })}>
                {t.caseFilesUpload}
              </Link>
            </div>
          </Card>

          <Card>
            <h2 className="mb-3 text-lg font-semibold">{t.caseMessagesTitle}</h2>
            {messages.length === 0 ? (
              <EmptyState testId="messages-empty">{t.caseMessagesEmpty}</EmptyState>
            ) : (
              <ul className="space-y-3" data-testid="message-thread">
                {messages.map((message) => (
                  <li key={message.id} className="rounded-md border p-3">
                    <p className="text-xs text-muted-foreground">
                      {message.authorDisplayName} · {sideLabel(t, message.authorSide)} ·{' '}
                      {formatDate(message.sentAt)}
                    </p>
                    <p className="mt-1 text-sm">{message.body}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {message.readAt !== undefined
                        ? t.caseMessageRead
                        : message.deliveredAt !== undefined
                          ? t.caseMessageDelivered
                          : t.caseMessageSent}
                    </p>
                  </li>
                ))}
              </ul>
            )}

            <form
              className="mt-4 flex flex-col gap-2 sm:flex-row"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={t.caseMessagePlaceholder}
                aria-label={t.caseMessagePlaceholder}
                data-testid="message-input"
                className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Button type="submit" disabled={sending || draft.trim() === ''}>
                <Send className="size-4 rtl:-scale-x-100" />
                {t.caseMessageSend}
              </Button>
            </form>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <h2 className="mb-3 text-lg font-semibold">{t.caseParties}</h2>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">{t.caseSubmittedBy}</dt>
                <dd>{parties.from?.legalName ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t.caseMatchedWith}</dt>
                <dd>{parties.to?.legalName ?? t.caseUnmatched}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t.colUpdated}</dt>
                <dd>{formatDate(item.updatedAt)}</dd>
              </div>
            </dl>
          </Card>

          <Card>
            <h2 className="mb-3 text-lg font-semibold">{t.caseTimelineTitle}</h2>
            <CaseTimeline events={events} />
          </Card>
        </div>
      </div>
    </Main>
  );
}
