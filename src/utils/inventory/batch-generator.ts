import prisma from '../prisma/prisma-client';

/**
 * System-generated batch number format: BATCH-YYYY-MM-XXX
 * e.g., BATCH-2026-08-001
 */
export async function generateBatchNumber(): Promise<string> {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const prefix = `BATCH-${year}-${month}-`;

  // Find the latest batch created in the current month with matching prefix
  const latestBatch = await (prisma as any).inventoryBatch.findFirst({
    where: {
      batchNumber: {
        startsWith: prefix,
      },
    },
    orderBy: {
      batchNumber: 'desc',
    },
    select: {
      batchNumber: true,
    },
  });

  let nextSequence = 1;
  if (latestBatch && latestBatch.batchNumber) {
    const parts = latestBatch.batchNumber.split('-');
    const lastSeq = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(lastSeq)) {
      nextSequence = lastSeq + 1;
    }
  }

  const formattedSeq = String(nextSequence).padStart(3, '0');
  return `${prefix}${formattedSeq}`;
}
