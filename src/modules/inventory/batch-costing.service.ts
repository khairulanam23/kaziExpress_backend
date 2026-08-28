import { Prisma, StockMovementType } from '@prisma/client';

/**
 * What a batch of stock actually cost.
 *
 * Purchased batches have always known this — it sat on the PURCHASE movement.
 * Manufactured batches did not: the ASSEMBLY movement recorded the finished
 * product's *list price* as its cost, so a panel that took ৳4,232 of material
 * and labour to build was booked at ৳8,500. Left alone, every margin computed
 * from it would have been wrong in a way that looked entirely plausible.
 *
 * Cost is captured in two stages, because that is when the two halves become
 * knowable:
 *
 *   • **Material** is exact the moment output is reported — it is the sum of
 *     what the run consumed, straight from the movement ledger.
 *   • **Labour** accrues across the whole run and is split across employees and
 *     concurrent tasks, so it can only be apportioned once the task completes.
 *
 * A batch therefore starts *provisional* (material only) and becomes *final*
 * when its task finishes. Selling from a provisional batch is allowed — the
 * disposition records that its cost was provisional, so the figure is never
 * quietly presented as more certain than it is.
 */

const num = (v: any): number => (v === null || v === undefined ? 0 : Number(v));
const DAY_MS = 24 * 60 * 60 * 1000;

/** Material consumed by a task, from the ledger rather than from the BOM estimate. */
async function materialCostOfTask(tx: Prisma.TransactionClient, taskId: string): Promise<number> {
  const consumed = await tx.stockMovement.aggregate({
    where: {
      relatedTaskId: taskId,
      type: { in: [StockMovementType.CONSUMPTION, StockMovementType.DAMAGE] },
    },
    _sum: { totalCost: true },
  });
  return num(consumed._sum.totalCost);
}

/**
 * Labour attributed to a task, on the same basis as the production-cost report:
 * a day's attendance is split evenly across the tasks that employee was
 * assigned to and that were active that day.
 */
async function labourCostOfTask(tx: Prisma.TransactionClient, taskId: string): Promise<number> {
  const task = await tx.task.findUnique({
    where: { id: taskId },
    select: { startedAt: true, completedAt: true, assignments: { select: { employeeId: true } } },
  });
  if (!task?.startedAt || task.assignments.length === 0) return 0;

  const from = task.startedAt;
  const to = task.completedAt ?? new Date();

  // Every task competing for the same days, so a day is never over-allocated.
  const concurrent = await tx.task.findMany({
    where: {
      startedAt: { not: null, lte: to },
      OR: [{ completedAt: null }, { completedAt: { gte: from } }],
    },
    select: { id: true, startedAt: true, completedAt: true, assignments: { select: { employeeId: true } } },
  });

  const byEmployeeDay = new Map<string, Map<string, Set<string>>>();
  for (const other of concurrent) {
    const start = other.startedAt as Date;
    const end = other.completedAt ?? new Date();
    for (const { employeeId } of other.assignments) {
      let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
      while (cursor <= end) {
        const day = cursor.toISOString().slice(0, 10);
        const days = byEmployeeDay.get(employeeId) ?? new Map<string, Set<string>>();
        const tasks = days.get(day) ?? new Set<string>();
        tasks.add(other.id);
        days.set(day, tasks);
        byEmployeeDay.set(employeeId, days);
        cursor = new Date(cursor.getTime() + DAY_MS);
      }
    }
  }

  const employeeIds = task.assignments.map((a) => a.employeeId);
  const [attendance, profiles] = await Promise.all([
    tx.attendance.findMany({
      where: { employeeId: { in: employeeIds }, date: { gte: from, lte: to } },
      select: { employeeId: true, date: true, workedHours: true },
    }),
    tx.employeeProfile.findMany({
      where: { userId: { in: employeeIds } },
      select: { userId: true, hourlyRate: true },
    }),
  ]);
  const rateOf = new Map(profiles.map((p) => [p.userId, num(p.hourlyRate)]));

  let total = 0;
  for (const record of attendance) {
    const hours = num(record.workedHours);
    if (hours <= 0) continue;
    const day = record.date.toISOString().slice(0, 10);
    const sameDay = byEmployeeDay.get(record.employeeId)?.get(day);
    if (!sameDay?.has(taskId)) continue;
    total += (hours / sameDay.size) * (rateOf.get(record.employeeId) ?? 0);
  }
  return total;
}

export const batchCosting = {
  /**
   * Stamp a purchased batch with the cost it was bought at. Final immediately —
   * nothing further can change what a purchase cost.
   */
  costPurchasedBatch: async (tx: Prisma.TransactionClient, batchId: string, unitCost: number) => {
    await tx.inventoryBatch.update({
      where: { id: batchId },
      data: {
        materialUnitCost: unitCost,
        labourUnitCost: 0,
        unitCost,
        costFinalizedAt: new Date(),
      },
    });
  },

  /**
   * Stamp a freshly produced batch with its provisional cost: the material this
   * production event consumed, spread over the units it yielded. Labour follows
   * when the task completes.
   *
   * Where a task reports output more than once, material already charged to
   * earlier batches is deducted so the same cost is never counted twice.
   */
  costManufacturedBatch: async (
    tx: Prisma.TransactionClient,
    batchId: string,
    taskId: string,
    quantityProduced: number,
  ): Promise<number> => {
    if (quantityProduced <= 0) return 0;

    const totalMaterial = await materialCostOfTask(tx, taskId);

    const earlier = await tx.inventoryBatch.findMany({
      where: { sourceTaskId: taskId, id: { not: batchId } },
      select: { initialQuantity: true, materialUnitCost: true },
    });
    const alreadyCharged = earlier.reduce(
      (sum, b) => sum + num(b.materialUnitCost) * num(b.initialQuantity),
      0,
    );

    const materialUnitCost = Math.max(0, totalMaterial - alreadyCharged) / quantityProduced;

    await tx.inventoryBatch.update({
      where: { id: batchId },
      data: {
        materialUnitCost,
        labourUnitCost: null,
        unitCost: materialUnitCost,
        costFinalizedAt: null, // provisional until the run finishes
      },
    });

    return materialUnitCost;
  },

  /**
   * Apportion the run's labour across everything it produced and mark those
   * batches final. Called when a task reaches COMPLETED or CANCELLED.
   *
   * Idempotent: re-running recomputes from the ledger rather than accumulating.
   */
  finalizeTaskCosts: async (tx: Prisma.TransactionClient, taskId: string): Promise<void> => {
    const batches = await tx.inventoryBatch.findMany({
      where: { sourceTaskId: taskId },
      select: { id: true, initialQuantity: true, materialUnitCost: true },
    });
    if (batches.length === 0) return;

    const totalUnits = batches.reduce((sum, b) => sum + num(b.initialQuantity), 0);
    if (totalUnits <= 0) return;

    const labour = await labourCostOfTask(tx, taskId);
    const labourUnitCost = labour / totalUnits;
    const finalizedAt = new Date();

    for (const batch of batches) {
      const material = num(batch.materialUnitCost);
      await tx.inventoryBatch.update({
        where: { id: batch.id },
        data: {
          labourUnitCost,
          unitCost: material + labourUnitCost,
          costFinalizedAt: finalizedAt,
        },
      });
    }
  },

  /**
   * The cost to charge when stock leaves this batch.
   *
   * Falls back to the product's list price only for batches created before
   * costing existed, and says so, because a caller freezing this figure into a
   * profit record needs to know how solid it is.
   */
  resolveUnitCost: async (
    tx: Prisma.TransactionClient,
    batchId: string,
  ): Promise<{ unitCost: number; isFinal: boolean; basis: string }> => {
    const batch = await tx.inventoryBatch.findUnique({
      where: { id: batchId },
      select: {
        unitCost: true,
        costFinalizedAt: true,
        sourceTaskId: true,
        product: { select: { unitPrice: true } },
      },
    });
    if (!batch) throw new Error('Batch not found');

    if (batch.unitCost !== null) {
      return {
        unitCost: num(batch.unitCost),
        isFinal: batch.costFinalizedAt !== null,
        basis: batch.costFinalizedAt
          ? 'Actual cost of this batch, material and labour.'
          : 'Material cost only — this production run has not finished, so labour is not yet included.',
      };
    }

    return {
      unitCost: num(batch.product.unitPrice),
      isFinal: false,
      basis: 'This batch predates cost tracking, so the product list price is used as an estimate.',
    };
  },
};

export const __testing = { materialCostOfTask, labourCostOfTask };
