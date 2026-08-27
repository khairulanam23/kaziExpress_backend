import 'dotenv/config';
import { AsyncLocalStorage } from 'node:async_hooks';
import { PrismaClient } from '@prisma/client';
import { getIO } from '../socket/socket';

const basePrisma = new PrismaClient();

/**
 * Change announcements are emitted from a Prisma query extension, which runs as
 * each *statement* finishes — not as the surrounding transaction commits. Left
 * alone that races: a client told "product changed" mid-transaction refetches
 * and reads the pre-commit row, then caches it, because no second event follows
 * the commit.
 *
 * So writes made inside `$transaction` park their announcements in this
 * async-local buffer and `$transaction` flushes them once the commit resolves.
 * A rolled-back transaction discards its buffer, and never announces changes
 * that did not happen. Writes outside a transaction still emit immediately.
 */
interface ChangeBuffer {
  events: Map<string, string>;
}
const transactionScope = new AsyncLocalStorage<ChangeBuffer>();

function announce(model: string, operation: string) {
  try {
    const io = getIO();
    io.emit(`${model}:changed`, { operation });
    io.emit('db:changed', { model, operation });
  } catch (_e) {
    // Ignore if Socket.io is not initialized yet
  }
}

function flush(buffer: ChangeBuffer) {
  for (const [model, operation] of buffer.events) announce(model, operation);
  buffer.events.clear();
}

// Low-stock alert queue: debounce to avoid spamming emails
let lowStockCheckTimeout: NodeJS.Timeout | null = null;
const alertedProductIds = new Set<string>();

async function checkAndAlertLowStock(client: PrismaClient) {
  try {
    const activeProducts = await client.product.findMany({
      where: {
        isDiscontinued: false,
        lowStockThreshold: { not: null },
      },
      select: { id: true, name: true, sku: true, currentStock: true, lowStockThreshold: true },
    });

    const newlyAlerted: typeof activeProducts = [];

    for (const p of activeProducts) {
      const isLowStock = Number(p.currentStock) < Number(p.lowStockThreshold);
      if (isLowStock) {
        if (!alertedProductIds.has(p.id)) {
          newlyAlerted.push(p);
          alertedProductIds.add(p.id);
        }
      } else {
        // Reset the alert state once the stock is replenished
        alertedProductIds.delete(p.id);
      }
    }

    if (newlyAlerted.length === 0) return;

    // Get all admin emails
    const admins = await client.user.findMany({
      where: { role: 'ADMIN', isActive: true },
      select: { email: true },
    });

    if (admins.length === 0) return;

    const { default: SendEmail } = await import('../email/send-email');
    const { templates } = await import('../email/templates');

    const products = newlyAlerted.map((p) => ({
      name: p.name,
      sku: p.sku || '',
      currentStock: Number(p.currentStock),
      lowStockThreshold: Number(p.lowStockThreshold),
    }));

    const html = templates.lowStockAlert({ products });

    for (const admin of admins) {
      SendEmail({
        to: admin.email,
        subject: `⚠️ Low Stock Alert — ${products.length} product(s) need restocking`,
        text: `Low stock alert: ${products.map((p) => p.name).join(', ')}`,
        html,
      }).catch(() => {});
    }
  } catch (err) {
    console.error('[LowStock] Failed to check/alert low stock:', err);
  }
}

const prisma = basePrisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const result = await query(args);

        // Emit real-time socket events for all mutations
        const mutations = ['create', 'createMany', 'update', 'updateMany', 'delete', 'deleteMany', 'upsert'];
        if (mutations.includes(operation)) {
          const modelName = model?.toLowerCase();
          if (modelName) {
            const buffer = transactionScope.getStore();
            // Inside a transaction the announcement waits for the commit.
            if (buffer) buffer.events.set(modelName, operation);
            else announce(modelName, operation);
          }

          // Debounce low-stock email check when stock movements happen
          if (model === 'StockMovement' || model === 'Product') {
            if (lowStockCheckTimeout) clearTimeout(lowStockCheckTimeout);
            lowStockCheckTimeout = setTimeout(() => {
              checkAndAlertLowStock(basePrisma).catch(() => {});
              lowStockCheckTimeout = null;
            }, 5000); // 5s debounce
          }
        }

        return result;
      },
    },
  },
}) as unknown as PrismaClient;

/**
 * Buffer every announcement made inside a transaction and release them only
 * once it has committed, so no client is ever told to read uncommitted rows.
 * Nested calls join the outermost buffer rather than flushing early.
 */
const runTransaction = prisma.$transaction.bind(prisma) as (...args: any[]) => Promise<any>;
(prisma as any).$transaction = (...args: any[]) => {
  if (transactionScope.getStore()) return runTransaction(...args);

  const buffer: ChangeBuffer = { events: new Map() };
  return transactionScope.run(buffer, async () => {
    const result = await runTransaction(...args);
    flush(buffer); // committed — safe to announce
    return result;
  });
};

export default prisma;
