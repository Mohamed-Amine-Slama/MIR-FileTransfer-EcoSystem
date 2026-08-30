import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, ConfigModule } from '../config/config.module';
import type { AppConfig } from '../config/config.schema';
import { ConsoleMailSender } from './console-mail';
import { MAIL_SENDER, type MailSender } from './mail-sender';

/**
 * Mail provider.
 *
 * THE SMTP IMPLEMENTATION IS NOT WRITTEN, and this module refuses to start
 * without one outside development rather than falling back to the console.
 *
 * That is the same shape as `StorageModule`, and it is deliberate. A mail
 * adapter that silently logs in production means every verification code is
 * "sent" successfully and nobody can finish signing up — a failure that looks
 * like a broken form to the user and like a healthy service to us. Refusing to
 * boot is the honest version: it fails at deploy, once, loudly, instead of
 * per-user, quietly, forever.
 *
 * Wiring a real sender means adding the adapter and selecting it here. Nothing
 * that depends on `MAIL_SENDER` changes.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: MAIL_SENDER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): MailSender => {
        if (config.NODE_ENV === 'production' || config.NODE_ENV === 'staging') {
          throw new Error(
            'No production-grade MailSender is configured. An SMTP adapter is ' +
              'not implemented yet (brief §5.1 depends on it: verification codes ' +
              'and seat invitations). Refusing to start rather than writing every ' +
              'outbound message to the log.',
          );
        }
        return new ConsoleMailSender();
      },
    },
  ],
  exports: [MAIL_SENDER],
})
export class MailModule {}
