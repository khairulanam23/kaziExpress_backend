import type { Prisma } from '@prisma/client';

/**
 * Human-readable disposition reference: DISP-YYYY-MM-XXX.
 *
 * Generated inside the caller's transaction so two concurrent sales cannot pick
 * the same sequence — the unique index on `dispositionNumber` is the backstop.
 */
export async function generateDispositionNumber(tx: Prisma.TransactionClient): Promise<string> {
  const now = new Date();
  const prefix = `DISP-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-`;

  const existing = await tx.disposition.findMany({
    where: { dispositionNumber: { startsWith: prefix } },
    select: { dispositionNumber: true },
  });

  let maxSeq = 0;
  for (const row of existing) {
    const seq = parseInt(row.dispositionNumber.split('-').pop() ?? '', 10);
    if (!Number.isNaN(seq) && seq > maxSeq) maxSeq = seq;
  }

  return `${prefix}${String(maxSeq + 1).padStart(3, '0')}`;
}
