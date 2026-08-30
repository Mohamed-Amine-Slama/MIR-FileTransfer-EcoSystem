/**
 * Outbound email — brief §5.1.
 *
 * A PORT, matching `BlobStore` and `PaymentRail`: the thing that sends is
 * chosen once at composition and every caller depends on the interface. The
 * reason is the same in all three cases — the production implementation is
 * decided by infrastructure that does not exist yet, and the alternative is a
 * service that quietly does nothing when it is unconfigured.
 *
 * WHAT MAY NEVER GO IN A MESSAGE. These are sent over SMTP to an inbox this
 * platform does not control, so the body must carry nothing that would be a
 * disclosure if the mailbox were read by someone else: no patient name, no case
 * reference, no study, no diagnosis. A verification code and the fact that
 * someone has an account here is the outer limit. That rule is why the
 * interface takes a small closed set of message KINDS rather than a subject and
 * a body — there is no way to pass this an arbitrary string to send.
 */

export interface VerificationCodeMessage {
  kind: 'email_verification';
  to: string;
  /** The plaintext code. It exists in the message and in nothing else. */
  code: string;
  expiresInMinutes: number;
  locale: string;
}

export interface SeatInvitationMessage {
  kind: 'seat_invitation';
  to: string;
  organisationName: string;
  /** Absolute URL carrying the single-use token. */
  acceptUrl: string;
  locale: string;
}

export type MailMessage = VerificationCodeMessage | SeatInvitationMessage;

export interface MailSender {
  /**
   * Deliver, or throw.
   *
   * Callers must decide deliberately whether a send failure fails their
   * request. Registration does NOT — an account that exists but whose code did
   * not arrive is recoverable by resending, whereas rolling the account back
   * loses the Keycloak user with it.
   */
  send(message: MailMessage): Promise<void>;
}

export const MAIL_SENDER = Symbol('MAIL_SENDER');
