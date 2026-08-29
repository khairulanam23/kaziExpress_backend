/**
 * Recomputes the cost of batches created before cost tracking existed, or
 * mis-costed by the production defect described below.
 *
 * Manufactured batches are the ones that matter: their ASSEMBLY movement
 * recorded the finished product's *list price* as its cost, so they would have
 * reported roughly zero margin on every sale. This walks each production run,
 * recomputes material from the ledger and labour from attendance, and stamps
 * the real figure onto the batch.
 *
 * It also repairs the ledger it reads from. `reportProduction` used to value
 * consumption at `batch.product?.unitPrice` from a query that never selected
 * `product`, so every CONSUMPTION movement was written at zero. Recomputing
 * batch cost from those movements returned zero unchanged — the backfill
 * appeared to run cleanly while fixing nothing. Step 0 restores the cost of
 * the stock those movements actually drew from, so the recompute has something
 * true to read.
 *
 * Safe to re-run — every figure is recomputed from source, never accumulated.
 *
 *   npm run backfill:batch-costs                                  # report only
 *   npm run backfill:batch-costs -- --write                       # repair ledger and batch costs
 *   npm run backfill:batch-costs -- --write --restate-dispositions # also restate unsettled sales
 */
import prisma from '../src/utils/prisma/prisma-client';
import { batchCosting } from '../src/modules/inventory/batch-costing.service';

const num = (v: any): number => (v === null || v === undefined ? 0 : Number(v));
const money = (v: number) => v.toFixed(2).padStart(12);

async function main() {
  const write = process.argv.includes('--write');
  // Restating a recorded sale changes reported financials, which is a
  // different kind of act from repairing a corrupted cost. It is opt-in.
  const restateDispositions = process.argv.includes('--restate-dispositions');
  console.log(write ? '▶ Backfilling batch costs\n' : '▶ Dry run — pass --write to apply\n');

  // 0. Repair production movements recorded at zero cost.
  //
  // Only movements that are demonstrably wrong: a zero cost against a batch
  // whose own cost is known. A movement with a real cost is never touched, and
  // one whose batch has no cost either cannot be derived and is left for the
  // report at the end.
  const zeroCostMovements = await prisma.stockMovement.findMany({
    where: {
      type: { in: ['CONSUMPTION', 'TASK_RESERVATION'] },
      totalCost: 0,
      batchId: { not: null },
    },
    select: {
      id: true, type: true, quantity: true, batchId: true, relatedTaskId: true,
      batch: { select: { batchNumber: true, unitCost: true, product: { select: { name: true, unitPrice: true } } } },
    },
  });

  let movementsFixed = 0;
  const undecidable: string[] = [];
  /** taskId → material cost the repaired movements would sum to. */
  const projectedMaterial = new Map<string, number>();
  for (const mv of zeroCostMovements) {
    const batchCost = mv.batch?.unitCost;
    if (batchCost === null || batchCost === undefined) {
      // No cost on the source batch: nothing to derive from, so nothing is
      // invented. Reported instead.
      undecidable.push(`${mv.batch?.batchNumber ?? mv.batchId} (${mv.batch?.product.name ?? 'unknown'})`);
      continue;
    }
    const unitCost = num(batchCost);
    if (unitCost === 0) {
      undecidable.push(`${mv.batch?.batchNumber ?? mv.batchId} (${mv.batch?.product.name ?? 'unknown'}) — batch cost is itself zero`);
      continue;
    }
    const qty = Math.abs(num(mv.quantity));
    if (mv.type === 'CONSUMPTION' && mv.relatedTaskId) {
      projectedMaterial.set(mv.relatedTaskId, (projectedMaterial.get(mv.relatedTaskId) ?? 0) + qty * unitCost);
    }
    if (write) {
      await prisma.stockMovement.update({
        where: { id: mv.id },
        data: { unitCost, totalCost: Number((qty * unitCost).toFixed(2)) },
      });
    }
    movementsFixed++;
  }
  console.log(
    `Production movements recorded at zero cost: ${zeroCostMovements.length} found, ${movementsFixed} ${write ? 'repaired' : 'repairable'} from their source batch` +
      (undecidable.length ? `, ${undecidable.length} undecidable` : ''),
  );
  for (const line of [...new Set(undecidable)]) console.log(`    undecidable: ${line}`);

  if (!write && projectedMaterial.size > 0) {
    // Step 2 below recomputes from the ledger as it stands, so in a dry run it
    // still reports zero. This is what it would produce once step 0 is applied.
    console.log('\n  Projected material cost once those movements are repaired:');
    for (const [taskId, material] of projectedMaterial) {
      const outputs = await prisma.inventoryBatch.findMany({
        where: { sourceTaskId: taskId },
        select: { batchNumber: true, initialQuantity: true, unitCost: true, product: { select: { name: true } } },
      });
      const units = outputs.reduce((sum, b) => sum + num(b.initialQuantity), 0);
      for (const b of outputs) {
        console.log(
          `    ${b.batchNumber.padEnd(20)} ${b.product.name.slice(0, 24).padEnd(24)} material ${money(material)} / ${units} units = ${money(units > 0 ? material / units : 0)} per unit  (currently ${money(num(b.unitCost))})`,
        );
      }
    }
  }
  console.log('');

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

  // 3. Restate dispositions whose cost was never settled.
  //
  // A disposition freezes its cost so that re-pricing a product later cannot
  // rewrite what a past sale earned — that rule is deliberate and is preserved
  // here: anything recorded with `costWasFinal: true` is never touched.
  //
  // `costWasFinal: false` means the opposite: the system recorded at the time
  // that this figure was not yet settled. Those are restated from the batch's
  // corrected cost, which is what "provisional" was always promising.
  const provisional = await prisma.disposition.findMany({
    where: { costWasFinal: false, reversedAt: null },
    select: {
      id: true, dispositionNumber: true, quantity: true, unitCogs: true, totalCogs: true,
      totalRevenue: true, grossProfit: true, batchId: true,
      batch: { select: { unitCost: true, costFinalizedAt: true } },
      product: { select: { name: true } },
    },
  });

  let restated = 0;
  const restatements: string[] = [];
  for (const d of provisional) {
    const batchCost = d.batch?.unitCost;
    if (batchCost === null || batchCost === undefined) continue;
    const newUnitCogs = num(batchCost);
    if (newUnitCogs === num(d.unitCogs)) continue;

    const qty = num(d.quantity);
    const newTotalCogs = Number((newUnitCogs * qty).toFixed(2));
    const newGrossProfit = Number((num(d.totalRevenue) - newTotalCogs).toFixed(2));

    restatements.push(
      `  ${d.dispositionNumber}  ${d.product.name.slice(0, 24).padEnd(24)} cogs ${money(num(d.totalCogs))} → ${money(newTotalCogs)}   profit ${money(num(d.grossProfit))} → ${money(newGrossProfit)}`,
    );

    if (write && restateDispositions) {
      await prisma.$transaction(async (tx) => {
        await tx.disposition.update({
          where: { id: d.id },
          data: {
            unitCogs: newUnitCogs,
            totalCogs: newTotalCogs,
            grossProfit: newGrossProfit,
            costWasFinal: d.batch?.costFinalizedAt !== null,
          },
        });
        // The movement ledger carries the same figure and must agree with it.
        await tx.stockMovement.updateMany({
          where: { batchId: d.batchId, type: { in: ['SALE', 'WRITE_OFF'] }, totalCost: num(d.totalCogs) },
          data: { unitCost: newUnitCogs, totalCost: newTotalCogs },
        });
      });
    }
    restated++;
  }

  console.log(
    `\nDispositions with an unsettled cost: ${provisional.length} found, ${restated} ${write && restateDispositions ? 'restated' : 'would be restated'}`,
  );
  if (restated > 0 && !(write && restateDispositions)) {
    console.log('  Restating a recorded sale changes reported profit — pass --restate-dispositions to apply.');
  }
  restatements.forEach((line) => console.log(line));
  if (provisional.length - restated > 0) {
    console.log(`  ${provisional.length - restated} already agree with their batch, or their batch has no cost to restate from.`);
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
