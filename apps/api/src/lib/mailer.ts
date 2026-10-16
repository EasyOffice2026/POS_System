import nodemailer from 'nodemailer';

export interface Mail {
  to: string[];
  subject: string;
  text: string;
}

export interface Mailer {
  // Answers whether the mail went out. It never throws: an alert that cannot be sent is logged,
  // and the work that caused it goes on.
  send(mail: Mail): Promise<boolean>;
}

interface MailerOptions {
  // smtp://user:password@host:port or smtps://... (the client's own email account); none while
  // developing, when mails are only logged. See docs/deployment.md.
  smtpUrl: string | undefined;
  from: string | undefined;
  log?: Pick<Console, 'warn' | 'error'>;
}

export function createMailer({ smtpUrl, from, log = console }: MailerOptions): Mailer {
  if (!smtpUrl) {
    return {
      send(mail) {
        log.warn(`Mail not sent, SMTP_URL is not set: "${mail.subject}" to ${mail.to.join(', ')}`);
        return Promise.resolve(false);
      },
    };
  }
  const sender = from ?? decodeURIComponent(new URL(smtpUrl).username);
  const transport = nodemailer.createTransport({
    url: smtpUrl,
    connectionTimeout: 5_000,
    greetingTimeout: 5_000,
    socketTimeout: 10_000,
  });
  return {
    async send(mail) {
      try {
        await transport.sendMail({
          from: sender,
          to: mail.to.join(', '),
          subject: mail.subject,
          text: mail.text,
        });
        return true;
      } catch (error) {
        log.error(`Mail failed: "${mail.subject}"`, error);
        return false;
      }
    },
  };
}

// For tests: keeps what would have been sent.
export function createMemoryMailer(): Mailer & { sent: Mail[] } {
  const sent: Mail[] = [];
  return {
    sent,
    send(mail) {
      sent.push(mail);
      return Promise.resolve(true);
    },
  };
}
