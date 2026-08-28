/**
 * Email delivery health.
 *
 * `SendEmail` never throws — it logs and returns false — which keeps API
 * responses fast but means a broken SMTP configuration is invisible outside the
 * server log. Low-stock alerts, credential emails and expiry reminders would
 * all stop arriving with nothing to show for it.
 *
 * So outcomes are tracked here, and once delivery has failed repeatedly the
 * admins are told in the one channel that still works when email does not: an
 * in-app notification.
 */

/** Consecutive failures tolerated before the admins are told. */
const FAILURE_THRESHOLD = 3;

/** At most one alert per hour, however many messages fail in it. */
const ALERT_WINDOW_MS = 60 * 60 * 1000;

let consecutiveFailures = 0;
let lastAlertAt = 0;
let lastError: string | null = null;

export function emailDeliveryHealth() {
  return {
    consecutiveFailures,
    healthy: consecutiveFailures < FAILURE_THRESHOLD,
    lastError,
  };
}

/** Test seam — resets the module's memory between runs. */
export function resetEmailHealth() {
  consecutiveFailures = 0;
  lastAlertAt = 0;
  lastError = null;
}

export function recordEmailSuccess() {
  if (consecutiveFailures >= FAILURE_THRESHOLD) {
    console.log(`[Email] Delivery recovered after ${consecutiveFailures} consecutive failures.`);
  }
  consecutiveFailures = 0;
  lastError = null;
}

export function recordEmailFailure(recipient: string, subject: string, error: unknown) {
  consecutiveFailures += 1;
  lastError = error instanceof Error ? error.message : String(error);
  console.error(
    `[Email] Delivery failed (${consecutiveFailures} in a row) to ${recipient} — "${subject}": ${lastError}`,
  );

  if (consecutiveFailures < FAILURE_THRESHOLD) return;

  const now = Date.now();
  if (now - lastAlertAt < ALERT_WINDOW_MS) return;
  lastAlertAt = now;

  // Deliberately fire-and-forget: raising the alarm must never delay or fail
  // the operation that was trying to send mail.
  void alertAdmins(consecutiveFailures, lastError);
}

async function alertAdmins(failures: number, detail: string | null) {
  try {
    // Imported lazily so this module stays free of the Prisma/notification
    // import cycle (prisma-client itself sends low-stock email).
    const { notificationServices } = await import('../../modules/notifications/notification.service');
    const hourBucket = Math.floor(Date.now() / ALERT_WINDOW_MS);
    await notificationServices.notifyAdmins(
      'Email delivery is failing',
      `${failures} outgoing emails in a row could not be delivered${detail ? ` (${detail})` : ''}. ` +
        'Low stock alerts, account emails and document expiry reminders are not reaching anyone until this is fixed.',
      '/dashboard/settings',
      `email-delivery-failing-${hourBucket}`,
    );
  } catch (err) {
    console.error('[Email] Could not raise the delivery-failure alert:', err);
  }
}
