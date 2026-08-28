import prisma from '../../utils/prisma/prisma-client';
import ApiError from '../../utils/errors/api-error';

/**
 * Batch genealogy.
 *
 * The links have always been recorded and never surfaced:
 *   • `TaskBatchAllocation` — which input batches a task consumed
 *   • `InventoryBatch.sourceTaskId` — which task produced an output batch
 *
 * Together they form a graph. Walking it upwards answers "what went into this
 * unit"; walking it downwards answers "a supplier batch was defective — what
 * did we build with it, and where is that now".
 */

const num = (v: any): number => (v === null || v === undefined ? 0 : Number(v));

/** Depth guard: production chains are shallow, cycles should be impossible. */
const MAX_DEPTH = 12;

export interface TraceNode {
  batchId: string;
  batchNumber: string;
  product: { id: string; name: string; sku: string | null; unit: string | null };
  initialQuantity: number;
  remainingQuantity: number;
  quantityInThisLink: number | null;
  createdAt: string;
  producedByTask: { id: string; title: string; completedAt: string | null } | null;
  depth: number;
  children: TraceNode[];
  truncated?: boolean;
}

const batchSelect = {
  id: true,
  batchNumber: true,
  initialQuantity: true,
  remainingQuantity: true,
  createdAt: true,
  sourceTaskId: true,
  sourceTask: { select: { id: true, title: true, completedAt: true } },
  product: { select: { id: true, name: true, sku: true, unit: true } },
} as const;

type BatchRow = {
  id: string; batchNumber: string; initialQuantity: any; remainingQuantity: any; createdAt: Date;
  sourceTaskId: string | null;
  sourceTask: { id: string; title: string; completedAt: Date | null } | null;
  product: { id: string; name: string; sku: string | null; unit: string | null };
};

function toNode(batch: BatchRow, depth: number, quantityInThisLink: number | null): TraceNode {
  return {
    batchId: batch.id,
    batchNumber: batch.batchNumber,
    product: batch.product,
    initialQuantity: num(batch.initialQuantity),
    remainingQuantity: num(batch.remainingQuantity),
    quantityInThisLink,
    createdAt: batch.createdAt.toISOString(),
    producedByTask: batch.sourceTask
      ? { id: batch.sourceTask.id, title: batch.sourceTask.title, completedAt: batch.sourceTask.completedAt?.toISOString() ?? null }
      : null,
    depth,
    children: [],
  };
}

/**
 * Upstream: the batches consumed by the task that produced this one, and so on
 * back to material that was purchased rather than made.
 */
async function traceUpstream(batch: BatchRow, depth: number, seen: Set<string>): Promise<TraceNode> {
  const node = toNode(batch, depth, null);
  if (!batch.sourceTaskId || depth >= MAX_DEPTH || seen.has(batch.id)) {
    if (depth >= MAX_DEPTH) node.truncated = true;
    return node;
  }
  seen.add(batch.id);

  const allocations = await prisma.taskBatchAllocation.findMany({
    where: { taskId: batch.sourceTaskId },
    select: { allocatedQuantity: true, batch: { select: batchSelect } },
  });

  for (const allocation of allocations) {
    const child = await traceUpstream(allocation.batch as BatchRow, depth + 1, seen);
    child.quantityInThisLink = num(allocation.allocatedQuantity);
    node.children.push(child);
  }
  return node;
}

/**
 * Downstream: the batches produced by every task that consumed this one — the
 * direction that matters during a recall.
 */
async function traceDownstream(batch: BatchRow, depth: number, seen: Set<string>): Promise<TraceNode> {
  const node = toNode(batch, depth, null);
  if (depth >= MAX_DEPTH || seen.has(batch.id)) {
    if (depth >= MAX_DEPTH) node.truncated = true;
    return node;
  }
  seen.add(batch.id);

  const allocations = await prisma.taskBatchAllocation.findMany({
    where: { batchId: batch.id },
    select: { allocatedQuantity: true, taskId: true },
  });

  for (const allocation of allocations) {
    const outputs = await prisma.inventoryBatch.findMany({
      where: { sourceTaskId: allocation.taskId },
      select: batchSelect,
    });
    for (const output of outputs) {
      const child = await traceDownstream(output as BatchRow, depth + 1, seen);
      child.quantityInThisLink = num(allocation.allocatedQuantity);
      node.children.push(child);
    }
  }
  return node;
}

function flatten(node: TraceNode, out: TraceNode[] = []): TraceNode[] {
  out.push(node);
  for (const child of node.children) flatten(child, out);
  return out;
}

export const traceServices = {
  /**
   * Full genealogy for one batch: what it was made from, and what was made
   * from it.
   */
  getBatchTrace: async (batchId: string) => {
    const batch = (await prisma.inventoryBatch.findUnique({
      where: { id: batchId },
      select: batchSelect,
    })) as BatchRow | null;

    if (!batch) throw ApiError.notFound('Batch not found');

    const [upstream, downstream, movements] = await Promise.all([
      traceUpstream(batch, 0, new Set()),
      traceDownstream(batch, 0, new Set()),
      prisma.stockMovement.findMany({
        where: { batchId },
        select: {
          id: true, type: true, quantity: true, totalCost: true, createdAt: true, reason: true,
          performedBy: { select: { id: true, name: true, email: true } },
          relatedTask: { select: { id: true, title: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    // The origin is every leaf upstream — material bought rather than built.
    const origins = flatten(upstream).filter((n) => n.children.length === 0 && !n.producedByTask);
    // Impact is every distinct descendant batch, excluding the batch itself.
    const affected = flatten(downstream).filter((n) => n.batchId !== batchId);
    const affectedById = new Map(affected.map((n) => [n.batchId, n]));

    return {
      batch: {
        id: batch.id,
        batchNumber: batch.batchNumber,
        product: batch.product,
        initialQuantity: num(batch.initialQuantity),
        remainingQuantity: num(batch.remainingQuantity),
        createdAt: batch.createdAt.toISOString(),
        producedByTask: batch.sourceTask
          ? { id: batch.sourceTask.id, title: batch.sourceTask.title, completedAt: batch.sourceTask.completedAt?.toISOString() ?? null }
          : null,
      },
      /** What this batch was made from. Empty when it was purchased, not built. */
      upstream,
      /** What was made from this batch — the recall direction. */
      downstream,
      summary: {
        isPurchased: !batch.sourceTaskId,
        originBatches: origins.length,
        affectedBatches: affectedById.size,
        affectedProducts: new Set([...affectedById.values()].map((n) => n.product.id)).size,
        stillInStock: [...affectedById.values()].filter((n) => n.remainingQuantity > 0).length,
        maxDepthReached: flatten(downstream).some((n) => n.truncated) || flatten(upstream).some((n) => n.truncated),
      },
      /** Flat recall list: every downstream batch and whether any is still held. */
      recallList: [...affectedById.values()]
        .map((n) => ({
          batchId: n.batchId,
          batchNumber: n.batchNumber,
          product: n.product,
          remainingQuantity: n.remainingQuantity,
          producedByTask: n.producedByTask,
          depth: n.depth,
        }))
        .sort((a, b) => a.depth - b.depth || b.remainingQuantity - a.remainingQuantity),
      movements: movements.map((m) => ({
        id: m.id,
        type: m.type,
        quantity: num(m.quantity),
        totalCost: num(m.totalCost),
        reason: m.reason,
        task: m.relatedTask,
        performedBy: m.performedBy ? { id: m.performedBy.id, name: m.performedBy.name ?? m.performedBy.email } : null,
        at: m.createdAt.toISOString(),
      })),
    };
  },
};
