import prisma from '../prisma/prisma-client';
import { notificationServices } from '../../modules/notifications/notification.service';
import type { DailyJob } from './daily-scheduler';

/**
 * Document expiry reminders.
 *
 * `EmployeeDocument.expiryDate` has always been recorded and never watched, so
 * NIDs, licences and contracts lapsed silently. This walks the documents that
 * are close to expiring (or already have) and tells both the owner and the
 * admins.
 *
 * Reminders are raised at fixed milestones rather than every day, so a document
 * expiring in 30 days produces four notifications over a month, not thirty.
 * `eventKey` makes each milestone idempotent, so re-running the job — after a
 * restart, say — never duplicates one.
 */

/** Days before expiry at which a reminder is raised. */
export const REMINDER_DAYS = [30, 14, 7, 1] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days from today until `date` — negative once it has passed. */
export function daysUntil(date: Date, now: Date = new Date()): number {
  const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const startOfTarget = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.round((startOfTarget - startOfToday) / DAY_MS);
}

/**
 * The milestone a document falls into, or null when it is not due for a
 * reminder today. Anything already expired reports `0`.
 */
export function reminderMilestone(daysLeft: number): number | null {
  if (daysLeft <= 0) return 0;
  return REMINDER_DAYS.find((d) => d === daysLeft) ?? null;
}

function describe(daysLeft: number): string {
  if (daysLeft < 0) return `expired ${Math.abs(daysLeft)} day${Math.abs(daysLeft) === 1 ? '' : 's'} ago`;
  if (daysLeft === 0) return 'expires today';
  return `expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;
}

export async function runDocumentExpiryCheck(now: Date = new Date()): Promise<number> {
  const horizon = new Date(now.getTime() + Math.max(...REMINDER_DAYS) * DAY_MS);

  const documents = await prisma.employeeDocument.findMany({
    where: { expiryDate: { not: null, lte: horizon } },
    select: {
      id: true,
      name: true,
      documentType: true,
      expiryDate: true,
      userId: true,
      user: { select: { name: true, email: true, isActive: true } },
    },
  });

  let raised = 0;

  for (const doc of documents) {
    if (!doc.expiryDate || !doc.user?.isActive) continue;

    const daysLeft = daysUntil(doc.expiryDate, now);
    const milestone = reminderMilestone(daysLeft);
    if (milestone === null) continue;

    const state = describe(daysLeft);
    // Expired documents re-alert once a day; upcoming ones once per milestone.
    const key =
      milestone === 0
        ? `document-expired:${doc.id}:${now.toISOString().slice(0, 10)}`
        : `document-expiring:${doc.id}:${milestone}`;

    await notificationServices.create(
      doc.userId,
      daysLeft <= 0 ? 'A document has expired' : 'A document is expiring soon',
      `Your ${doc.documentType} "${doc.name}" ${state}. Please upload a renewed copy.`,
      '/dashboard/profile',
      key,
    );

    await notificationServices.notifyAdmins(
      daysLeft <= 0 ? 'Employee document expired' : 'Employee document expiring soon',
      `${doc.user.name ?? doc.user.email}'s ${doc.documentType} "${doc.name}" ${state}.`,
      `/dashboard/employees/${doc.userId}`,
      key,
    );

    raised += 1;
  }

  if (raised > 0) console.log(`[DocumentExpiry] Raised reminders for ${raised} document(s).`);
  return raised;
}

export const documentExpiryJob: DailyJob = {
  name: 'document-expiry-reminders',
  run: async () => {
    await runDocumentExpiryCheck();
  },
};
