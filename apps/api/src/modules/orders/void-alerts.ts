import { type LocalizedText, localizedTextSchema, parseBrandSettings } from '@pos/shared';
import type { Mailer } from '../../lib/mailer';
import type { PrismaClient } from '../../lib/prisma';

// What was voided, for the people the brand wants told (docs/client-decisions.md, "Voids").
export interface VoidEvent {
  kind: 'line' | 'order';
  brandId: string;
  branchId: string;
  orderNumber: number;
  // The dish, for a line; null for a whole order.
  what: LocalizedText | null;
  quantity: number | null;
  amount: string;
  reason: string;
  byId: string;
  approvedById: string | null;
  at: Date;
}

export function createVoidAlerts({ prisma, mailer }: { prisma: PrismaClient; mailer: Mailer }) {
  return {
    // One mail per void, to the addresses in the brand's settings. A failure is logged and never
    // stops the void.
    async send(event: VoidEvent): Promise<void> {
      try {
        const brand = await prisma.brand.findUnique({
          where: { id: event.brandId },
          select: { name: true, settings: true },
        });
        const to = parseBrandSettings(brand?.settings).alerts.voidEmails;
        if (to.length === 0) return;

        const branch = await prisma.branch.findUnique({
          where: { id: event.branchId },
          select: { name: true, timezone: true },
        });
        const ids = [event.byId, ...(event.approvedById ? [event.approvedById] : [])];
        const people = await prisma.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true },
        });
        const nameOf = (id: string | null) =>
          people.find((person) => person.id === id)?.name ?? 'unknown';
        const en = (text: unknown) => localizedTextSchema.safeParse(text).data?.en ?? '';
        const branchName = en(branch?.name);
        const when = new Intl.DateTimeFormat('en-GB', {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: branch?.timezone ?? 'Asia/Kuwait',
        }).format(event.at);
        const what =
          event.kind === 'order'
            ? `the whole order`
            : `${event.quantity ?? 1} × ${event.what?.en ?? 'a dish'}`;

        const subject = `Void at ${branchName}: order ${event.orderNumber}, ${event.amount} KWD`;
        const text = [
          `A void was made at ${branchName} (${en(brand?.name)}).`,
          '',
          `Order: ${event.orderNumber}`,
          `Voided: ${what}`,
          `Amount: ${event.amount} KWD`,
          `Reason: ${event.reason}`,
          `By: ${nameOf(event.byId)}`,
          `Approved by: ${event.approvedById ? nameOf(event.approvedById) : 'no approval needed'}`,
          `When: ${when}`,
          '',
          'The dashboard shows the voids of the day by reason.',
        ].join('\n');
        await mailer.send({ to, subject, text });
      } catch (error) {
        console.error('Void alert failed:', error);
      }
    },
  };
}

export type VoidAlerts = ReturnType<typeof createVoidAlerts>;
