import assert from 'assert';
import prisma from '../src/utils/prisma/prisma-client';
import { daysUntil, reminderMilestone, runDocumentExpiryCheck, REMINDER_DAYS } from '../src/utils/scheduler/document-expiry.job';
import { emailDeliveryHealth, recordEmailFailure, recordEmailSuccess, resetEmailHealth } from '../src/utils/email/email-health';

/**
 * P0 roadmap items: quiet session bookkeeping, visible email failures and
 * document expiry reminders.
 */
async function runPhase14Tests() {
  console.log('🧪 Starting Backend Phase 14 Test Suite (Roadmap P0)...\n');

  let passed = 0;
  const testPass = (name: string) => {
    console.log(`  ✅ PASSED: ${name}`);
    passed++;
  };

  const stamp = Date.now();
  let userId = '';
  let docIds: string[] = [];

  try {
    // ── Item 3: document expiry ──────────────────────────────────────────────
    assert.strictEqual(daysUntil(new Date('2026-03-11T00:00:00Z'), new Date('2026-03-01T09:30:00Z')), 10, '10 days out');
    assert.strictEqual(daysUntil(new Date('2026-03-01T23:00:00Z'), new Date('2026-03-01T01:00:00Z')), 0, 'same day is 0 regardless of time');
    assert.strictEqual(daysUntil(new Date('2026-02-25T00:00:00Z'), new Date('2026-03-01T00:00:00Z')), -4, 'past dates go negative');
    testPass('daysUntil counts whole calendar days, not 24h blocks');

    assert.strictEqual(reminderMilestone(30), 30, '30-day milestone');
    assert.strictEqual(reminderMilestone(7), 7, '7-day milestone');
    assert.strictEqual(reminderMilestone(29), null, 'no reminder between milestones');
    assert.strictEqual(reminderMilestone(0), 0, 'expiring today alerts');
    assert.strictEqual(reminderMilestone(-9), 0, 'already expired alerts');
    testPass(`Reminders fire only at the ${REMINDER_DAYS.join('/')}-day milestones (and once expired)`);

    const user = await prisma.user.create({
      data: { email: `expiry.${stamp}@test.local`, password: 'x', name: 'Expiry Probe', role: 'EMPLOYEE', isActive: true },
    });
    userId = user.id;

    const day = 24 * 60 * 60 * 1000;
    const now = new Date();
    const make = (name: string, offsetDays: number) =>
      prisma.employeeDocument.create({
        data: {
          userId,
          name,
          documentType: 'NID',
          fileStorageId: `probe-${stamp}-${name}`,
          expiryDate: new Date(now.getTime() + offsetDays * day),
        },
        select: { id: true },
      });

    const due = await make('due-in-7', 7);
    const notDue = await make('due-in-21', 21);
    const expired = await make('already-expired', -3);
    docIds = [due.id, notDue.id, expired.id];

    const raised = await runDocumentExpiryCheck(now);
    assert(raised >= 2, `at least the 7-day and expired documents alert (raised ${raised})`);

    const notes = await prisma.notification.findMany({ where: { userId }, select: { eventKey: true, title: true } });
    const keys = notes.map((n) => n.eventKey ?? '');
    assert(keys.some((k) => k.startsWith(`document-expiring:${due.id}:7`)), 'the 7-day document notified its owner');
    assert(keys.some((k) => k.startsWith(`document-expired:${expired.id}:`)), 'the expired document notified its owner');
    assert(!keys.some((k) => k.includes(notDue.id)), 'the 21-day document stayed quiet — not a milestone');
    testPass('Expiry check notifies owners at milestones and skips documents between them');

    const before = await prisma.notification.count({ where: { userId } });
    await runDocumentExpiryCheck(now);
    const after = await prisma.notification.count({ where: { userId } });
    assert.strictEqual(before, after, 'a second run added no notifications');
    testPass('Re-running the job is idempotent — a restart cannot duplicate reminders');

    // ── Item 2: email failure visibility ─────────────────────────────────────
    resetEmailHealth();
    assert.strictEqual(emailDeliveryHealth().healthy, true, 'starts healthy');
    recordEmailFailure('a@test.local', 'Subject', new Error('ECONNREFUSED'));
    recordEmailFailure('b@test.local', 'Subject', new Error('ECONNREFUSED'));
    assert.strictEqual(emailDeliveryHealth().healthy, true, 'a couple of failures is not yet an outage');
    recordEmailFailure('c@test.local', 'Subject', new Error('ECONNREFUSED'));
    assert.strictEqual(emailDeliveryHealth().healthy, false, 'three in a row is');
    assert.strictEqual(emailDeliveryHealth().consecutiveFailures, 3, 'failure run is counted');
    assert(emailDeliveryHealth().lastError?.includes('ECONNREFUSED'), 'the cause is retained');
    recordEmailSuccess();
    assert.strictEqual(emailDeliveryHealth().healthy, true, 'one success clears the run');
    assert.strictEqual(emailDeliveryHealth().consecutiveFailures, 0, 'counter resets on recovery');
    resetEmailHealth();
    testPass('Email delivery failures are counted and escalate after 3 in a row');

    // ── Item 1: session bookkeeping stays quiet ──────────────────────────────
    const clientSource = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'utils', 'prisma', 'prisma-client.ts'), 'utf-8');
    assert(clientSource.includes('BOOKKEEPING_FIELDS'), 'bookkeeping fields are declared');
    assert(/refreshTokenHash[\s\S]{0,40}lastLogin/.test(clientSource), 'refreshTokenHash and lastLogin are the quiet fields');
    assert(clientSource.includes('!isBookkeepingOnly('), 'the announcer consults them before emitting');
    testPass('Login/logout token writes no longer announce a user change');

    const { default: freshPrisma } = await import('../src/utils/prisma/prisma-client');
    const emitted: string[] = [];
    // Announcements go out through `emitToPermissions` (permission-scoped
    // rooms), so that is the seam to intercept — not `getIO`.
    const socket = require('../src/utils/socket/socket');
    const realEmit = socket.emitToPermissions;
    socket.emitToPermissions = (_audience: string[], event: string, payload: any) => {
      if (event === 'db:changed') emitted.push(payload.model);
    };

    await freshPrisma.user.update({ where: { id: userId }, data: { refreshTokenHash: 'probe-hash', lastLogin: new Date() } });
    assert(!emitted.includes('user'), `token-only write announced no user change (saw ${emitted.join(',') || 'nothing'})`);

    await freshPrisma.user.update({ where: { id: userId }, data: { name: 'Expiry Probe Renamed' } });
    assert(emitted.includes('user'), 'a real profile change still announces');
    socket.emitToPermissions = realEmit;
    testPass('Verified live: token writes emit nothing, real edits still emit');

    console.log(`\n📊 Phase 14 Test Results: ${passed} Passed, 0 Failed`);
  } catch (err: any) {
    console.error('\n💥 Phase 14 test suite crashed:', err);
    process.exitCode = 1;
  } finally {
    await prisma.notification.deleteMany({ where: { eventKey: { startsWith: 'email-delivery-failing-' } } }).catch(() => {});
    if (userId) {
      await prisma.notification.deleteMany({ where: { userId } }).catch(() => {});
      await prisma.employeeDocument.deleteMany({ where: { userId } }).catch(() => {});
      await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    }
    await prisma.$disconnect().catch(() => {});
  }
}

runPhase14Tests();
