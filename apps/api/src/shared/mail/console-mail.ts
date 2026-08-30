import { Logger } from '@nestjs/common';
import type { MailMessage, MailSender } from './mail-sender';

/**
 * The development adapter: writes what WOULD have been sent to the log.
 *
 * It logs the verification code in full, which is the entire point — there is
 * no mail server locally and a developer needs the six digits to finish the
 * flow. That is also precisely why `StorageModule`'s pattern is copied in
 * `mail.module.ts`: selecting this outside development throws at boot rather
 * than silently swallowing every message a real user was waiting for.
 *
 * The log line is deliberately shaped to survive the scrubber in
 * shared/observability/log-scrubber.ts — it carries no key the scrubber
 * recognises as sensitive, because if the code were redacted here the adapter
 * would be useless for the one job it has.
 */
export class ConsoleMailSender implements MailSender {
  private readonly logger = new Logger('Mail');

  async send(message: MailMessage): Promise<void> {
    await Promise.resolve();

    if (message.kind === 'email_verification') {
      this.logger.warn(
        `[dev mail] verification code for ${message.to}: ${message.code} ` +
          `(valid ${message.expiresInMinutes} minutes)`,
      );
      return;
    }

    this.logger.warn(
      `[dev mail] seat invitation for ${message.to} to join ` +
        `${message.organisationName}: ${message.acceptUrl}`,
    );
  }
}
