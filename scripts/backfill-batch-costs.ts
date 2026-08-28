/**
 * Recomputes the cost of batches created before cost tracking existed.
 *
 * Manufactured batches are the ones that matter: their ASSEMBLY movement
 * recorded the finished product's *list price* as its cost, so they would have
 * reported roughly zero margin on every sale. This walks each production run,
 * recomputes material from the ledger and labour from attendance, and stamps
 * the real figure onto the batch.
 *
 * Safe to re-run — every figure is recomputed from source, never accumulated.
 *
 *   npm run backfill:batch-costs           # report what would change
 *   npm run backfill:batch-costs -- --write
 */
import prisma from '../src/utils/prisma/prisma-client';
import { batchCosting } from '../src/modules/inventory/batch-costing.service';

const num = (v: any): number => (v === null || v === undefined ? 0 : Number(v));
const money = (v: number) => v.toFixed(2).padStart(12);

async function main() {
  const write = process.argv.includes('--write');
  console.log(write ? '▶ Backfilling batch costs\n' : '▶ Dry run — pass --write to apply\n');

  // 1. Purchased batches missing a cost: read it off the PURCHASE movement.
  const purchased = await prisma.inventoryBatch.findMany({
    where: { sourceTaskId: null, unitCost: null },
    select: {
      id: true, batchNumber: true,
      stockMovements: { where: { type: 'PURCHASE' }, select: { unitCost: true }, orderBy: { createdAt: 'asc' }, take: 1 },
    },
  });

  let purchasedFixed = 0;
  for (const batch of purchased) {
    const cost = batch.stockMovements[0]?.unitCost;
    if (cost === undefined) continue;
    if (write) await prisma.$transaction((tx) => batchCosting.costPurchasedBatch(tx, batch.id, num(cost)));
    purchasedFixed++;
  }
  console.log(`Purchased batches: ${purchasedFixed} costed from their purchase movement${purchased.length - purchasedFixed ? `, ${purchased.length - purchasedFixed} had no purchase movement` : ''}`);

  // 2. Manufactured batches: recompute from the run that produced them.
  const tasks = await prisma.task.findMany({
    where: { outputBatches: { some: {} } },
    select: {
      id: true, title: true, status: true,
      outputBatches: {
        select: { id: true, batchNumber: true, initialQuantity: true, unitCost: true, product: { select: { name: true, unitPrice: true } } },
      },
    },
  });

  console.log(`\nManufactured batches, by production run:\n`);
  console.log(`  ${'batch'.padEnd(20)} ${'product'.padEnd(26)} ${'recorded'.padStart(12)} ${'actual'.padStart(12)}  status`);
  console.log(`  ${'-'.repeat(20)} ${'-'.repeat(26)} ${'-'.repeat(12)} ${'-'.repeat(12)}  ------`);

  let manufacturedFixed = 0;
  for (const task of tasks) {
    await prisma.$transaction(async (tx) => {
      // Re-derive the provisional material cost for each output batch, then
      // finalise labour if the run is over.
      for (const batch of task.outputBatches) {
        await batchCosting.costManufacturedBatch(tx, batch.id, task.id, num(batch.initialQuantity));
      }
      if (task.status === 'COMPLETED') await batchCosting.finalizeTaskCosts(tx, task.id);

      const after = await tx.inventoryBatch.findMany({
        where: { sourceTaskId: task.id },
        select: { id: true, batchNumber: true, unitCost: true, costFinalizedAt: true, product: { select: { name: true } } },
      });

      for (const batch of after) {
        const before = task.outputBatches.find((b) => b.id === batch.id);
        console.log(
          `  ${batch.batchNumber.padEnd(20)} ${batch.product.name.slice(0, 26).padEnd(26)} ${money(num(before?.unitCost ?? before?.product.unitPrice))} ${money(num(batch.unitCost))}  ${batch.costFinalizedAt ? 'final' : 'provisional'}`,
        );
        manufacturedFixed++;
      }

      if (!write) throw new ROLLBACK();
    }).catch((err) => {
      if (!(err instanceof ROLLBACK)) throw err;
    });
  }

  console.log(`\n${write ? '✓ Applied' : 'Would update'} ${manufacturedFixed} manufactured batch(es) across ${tasks.length} run(s).`);
  if (!write) console.log('  Nothing was written. Re-run with --write to apply.');
  await prisma.$disconnect();
}

/** Sentinel used to roll a dry run back after reporting what it would do. */
class ROLLBACK extends Error {}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
