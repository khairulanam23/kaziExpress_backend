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

  // Find all batches created in the current month matching prefix
  const matchingBatches = await (prisma as any).inventoryBatch.findMany({
    where: {
      batchNumber: {
        startsWith: prefix,
      },
    },
    select: {
      batchNumber: true,
    },
  });

  let maxSeq = 0;
  for (const b of matchingBatches) {
    if (b.batchNumber) {
      const parts = b.batchNumber.split('-');
      const seq = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(seq) && seq > maxSeq) {
        maxSeq = seq;
      }
    }
  }

  const formattedSeq = String(maxSeq + 1).padStart(3, '0');
  return `${prefix}${formattedSeq}`;
}
