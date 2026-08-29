import prisma from '../../utils/prisma/prisma-client';
import ApiError from '../../utils/errors/api-error';
import { generateBatchNumber } from '../../utils/inventory/batch-generator';
import { notificationServices } from '../notifications/notification.service';
import { batchCosting, unitCostOfBatch } from '../inventory/batch-costing.service';

export interface CreateTaskPayload {
  title: string;
  description?: string;
  productId: string;
  productionQuantity: number;
  assignedEmployeeIds?: string[];
  deadline?: string;
  parentTaskId?: string | null;
  batchAllocations?: { batchId: string; quantity: number }[];
  userId: string;
}

export interface ReportProductionPayload {
  taskId: string;
  completedQuantity: number;
  notes?: string;
  userId: string;
  userRole?: string;
}

export interface ReportDamagePayload {
  taskId: string;
  productId: string;
  batchId?: string;
  quantity: number;
  reason: string;
  userId: string;
  userRole?: string;
}

export interface RequestRefillPayload {
  taskId: string;
  productId: string;
  quantity: number;
  reason?: string;
  userId: string;
  userRole?: string;
}

export interface DecideRefillPayload {
  requestId: string;
  status: 'APPROVED' | 'REJECTED';
  rejectionReason?: string;
  allocatedBatchId?: string;
  userId: string;
}

export const taskServices = {
  /**
   * Admin creates a production task for a product with explicit batch allocations.
   * Converts product's BOM into an immutable material requirement snapshot.
   */
  createTask: async (payload: CreateTaskPayload) => {
    const {
      title,
      description,
      productId,
      productionQuantity,
      assignedEmployeeIds = [],
      deadline,
      parentTaskId,
      batchAllocations = [],
      userId,
    } = payload;

    if (productionQuantity <= 0) {
      throw new ApiError(400, 'Production quantity must be greater than 0');
    }

    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: {
        bomAsParent: {
          include: { childProduct: true },
        },
      },
    });

    if (!product || product.isDiscontinued) {
      throw new ApiError(404, 'Target production product not found');
    }

    if (parentTaskId) {
      const parentTask = await prisma.task.findUnique({ where: { id: parentTaskId } });
      if (!parentTask) {
        throw ApiError.notFound('Parent task not found');
      }
    }

    // Build immutable material requirement snapshot from BOM
    const requiredMaterialsSnapshot = product.bomAsParent.map((entry) => ({
      productId: entry.childProductId,
      quantity: Number(entry.quantityRequired) * productionQuantity,
      unitPrice: Number(entry.childProduct.unitPrice),
      unit: entry.childProduct.unit,
    }));

    return await (prisma as any).$transaction(async (tx: any) => {
      const deadlineDate = deadline ? new Date(deadline) : null;

      const task = await tx.task.create({
        data: {
          title,
          description,
          status: 'PENDING',
          productId,
          productionQuantity,
          completedQuantity: 0,
          remainingQuantity: productionQuantity,
          deadline: deadlineDate,
          parentTaskId: parentTaskId || null,
          createdById: userId,
          productsSnapshot: requiredMaterialsSnapshot,
        },
      });

      // Save immutable material requirement snapshot records
      if (requiredMaterialsSnapshot.length > 0) {
        await tx.taskRequiredProduct.createMany({
          data: requiredMaterialsSnapshot.map((m) => ({
            taskId: task.id,
            productId: m.productId,
            quantity: m.quantity,
            unitPrice: m.unitPrice,
            unit: m.unit,
          })),
        });
      }

      // Process explicit batch allocations if provided by admin
      if (batchAllocations.length > 0) {
        for (const alloc of batchAllocations) {
          if (alloc.quantity <= 0) {
            throw new ApiError(400, 'Allocated batch quantity must be greater than 0');
          }

          const batch = await tx.inventoryBatch.findUnique({
            where: { id: alloc.batchId },
          });

          if (!batch) {
            throw new ApiError(404, `Inventory batch with ID ${alloc.batchId} not found`);
          }

          const availableInBatch = Number(batch.remainingQuantity) - Number(batch.reservedQuantity);
          if (availableInBatch < alloc.quantity) {
            throw new ApiError(
              400,
              `Insufficient inventory in batch ${batch.batchNumber}. Shortage: ${alloc.quantity - availableInBatch}`
            );
          }

          await tx.taskBatchAllocation.create({
            data: {
              taskId: task.id,
              batchId: alloc.batchId,
              allocatedQuantity: alloc.quantity,
            },
          });
        }
      }

      // Assign employees
      if (assignedEmployeeIds.length > 0) {
        await tx.taskAssignment.createMany({
          data: assignedEmployeeIds.map((empId) => ({
            taskId: task.id,
            employeeId: empId,
          })),
        });

        for (const empId of assignedEmployeeIds) {
          await notificationServices.create(
            empId,
            'New Task Assigned',
            `You have been assigned to production task "${task.title}"`,
            `/tasks/${task.id}`,
            `TASK_ASSIGNED:${task.id}:${empId}`
          );
        }
      }

      return taskServices.getTaskByIdInternal(task.id, tx);
    });
  },

  /**
   * Employee accepts an assigned task.
   * Atomically reserves allocated batch inventory in a transaction.
   */
  acceptTask: async (taskId: string, userId: string, userRole: string) => {
    return await (prisma as any).$transaction(async (tx: any) => {
      const task = await tx.task.findUnique({
        where: { id: taskId },
        include: {
          assignments: true,
          batchAllocations: {
            include: { batch: true },
          },
        },
      });

      if (!task) throw ApiError.notFound('Task not found');

      if (userRole === 'EMPLOYEE') {
        const isAssigned = task.assignments.some((a: any) => a.employeeId === userId);
        if (!isAssigned) {
          throw new ApiError(403, 'You are not assigned to this task');
        }
      }

      if (task.status !== 'PENDING') {
        throw new ApiError(400, `Task cannot be accepted because it is currently in ${task.status} status`);
      }

      // Reserve allocated batch stock
      for (const alloc of task.batchAllocations) {
        const batch = await tx.inventoryBatch.findUnique({
          where: { id: alloc.batchId },
          include: { product: true },
        });

        const allocQty = Number(alloc.allocatedQuantity);
        const availableInBatch = Number(batch.remainingQuantity) - Number(batch.reservedQuantity);

        if (availableInBatch < allocQty) {
          throw new ApiError(
            400,
            `Cannot accept task: Insufficient available inventory in batch ${batch.batchNumber}. Required: ${allocQty}, Available: ${availableInBatch}`
          );
        }

        await tx.inventoryBatch.update({
          where: { id: alloc.batchId },
          data: {
            reservedQuantity: Number(batch.reservedQuantity) + allocQty,
          },
        });

        // Same defect as the consumption movement below: `batch.product` is not
        // loaded here either. Reservations do not feed costing, but they are
        // read in the movement ledger, where a zero is just wrong.
        const { unitCost: reservedUnitCost } = unitCostOfBatch(batch);

        await tx.stockMovement.create({
          data: {
            productId: batch.productId,
            batchId: batch.id,
            type: 'TASK_RESERVATION',
            quantity: allocQty,
            unitCost: reservedUnitCost,
            totalCost: allocQty * reservedUnitCost,
            relatedTaskId: task.id,
            performedById: userId,
            reason: `Reserved for task: ${task.title}`,
          },
        });
      }

      const updatedTask = await tx.task.update({
        where: { id: taskId },
        data: {
          status: 'ACCEPTED',
          acceptedAt: new Date(),
        },
      });

      await notificationServices.notifyAdmins(
        'Task Accepted',
        `Employee accepted production task "${task.title}"`,
        `/tasks/${task.id}`,
        `TASK_ACCEPTED:${task.id}`
      );

      return taskServices.getTaskByIdInternal(updatedTask.id, tx);
    });
  },

  /**
   * Employee starts working on task.
   */
  startTask: async (taskId: string, userId: string, userRole: string) => {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { assignments: true },
    });

    if (!task) throw ApiError.notFound('Task not found');

    if (userRole === 'EMPLOYEE') {
      const isAssigned = task.assignments.some((a) => a.employeeId === userId);
      if (!isAssigned) throw new ApiError(403, 'You are not assigned to this task');
    }

    if (task.status !== 'ACCEPTED' && task.status !== 'PENDING') {
      throw new ApiError(400, `Task cannot be started from status ${task.status}`);
    }

    const updated = await prisma.task.update({
      where: { id: taskId },
      data: {
        status: 'IN_PROGRESS',
        startedAt: task.startedAt || new Date(),
      },
    });

    await notificationServices.notifyAdmins(
      'Task Started',
      `Employee started production task "${task.title}"`,
      `/tasks/${task.id}`,
      `TASK_STARTED:${task.id}`
    );

    return taskServices.getTaskByIdInternal(updated.id);
  },

  /**
   * Employee/Admin reports completed production result (Full or Partial).
   * Consumes material batches, adds output finished product to inventory, updates task.
   */
  reportProduction: async (payload: ReportProductionPayload) => {
    const { taskId, completedQuantity, notes, userId } = payload;

    if (completedQuantity <= 0) {
      throw new ApiError(400, 'Completed quantity must be greater than 0');
    }

    return await (prisma as any).$transaction(async (tx: any) => {
      const task = await tx.task.findUnique({
        where: { id: taskId },
        include: {
          product: true,
          // `batch.product` is needed to value consumption when a batch
          // predates costing; omitting it is what produced zero-cost movements.
          batchAllocations: { include: { batch: { include: { product: true } } } },
          assignments: true,
        },
      });

      if (!task) throw ApiError.notFound('Task not found');

      if (task.status === 'COMPLETED' || task.status === 'CANCELLED') {
        throw new ApiError(400, `Cannot report production for task in ${task.status} status`);
      }

      if (payload.userRole === 'EMPLOYEE') {
        const isAssigned = task.assignments.some((a: any) => a.employeeId === userId);
        if (!isAssigned) {
          throw new ApiError(403, 'Forbidden: You are not assigned to this task');
        }
      }

      const remainingAllowed = Number(task.remainingQuantity);
      if (completedQuantity > remainingAllowed) {
        throw new ApiError(
          400,
          `Cannot report ${completedQuantity} units. Only ${remainingAllowed} units remaining for this task.`
        );
      }

      const totalProdQty = Number(task.productionQuantity);
      const ratio = completedQuantity / totalProdQty;

      // Consume materials from allocated batches
      for (const alloc of task.batchAllocations) {
        const batch = alloc.batch;
        const consumeQty = Number(alloc.allocatedQuantity) * ratio;

        await tx.inventoryBatch.update({
          where: { id: batch.id },
          data: {
            remainingQuantity: Number(batch.remainingQuantity) - consumeQty,
            reservedQuantity: Math.max(0, Number(batch.reservedQuantity) - consumeQty),
          },
        });

        /*
          What the consumed stock actually cost, not what its product lists for.
          `batch.product` was never selected here, so `batch.product?.unitPrice`
          was always undefined and `|| 0` wrote a zero — which is what
          `materialCostOfTask` then summed, giving every manufactured batch a
          material cost of zero and every sale from one a 100% margin.

          `unitCostOfBatch` is the same rule `resolveUnitCost` applies to a
          sale, including the fallback for batches that predate costing —
          applied in memory here because this transaction runs close enough to
          Prisma's timeout that a lookup per allocation is worth avoiding.
        */
        const { unitCost: consumedUnitCost } = unitCostOfBatch(batch);

        await tx.stockMovement.create({
          data: {
            productId: batch.productId,
            batchId: batch.id,
            type: 'CONSUMPTION',
            quantity: -consumeQty,
            unitCost: consumedUnitCost,
            totalCost: consumeQty * consumedUnitCost,
            relatedTaskId: task.id,
            performedById: userId,
            notes: `Consumed for task production (${completedQuantity} ${task.product?.unit || 'units'})`,
            reason: notes || 'Task production consumption',
          },
        });
      }

      // Create new output InventoryBatch for finished product
      const outputBatchNumber = await generateBatchNumber();
      const outputBatch = await tx.inventoryBatch.create({
        data: {
          batchNumber: outputBatchNumber,
          productId: task.productId,
          initialQuantity: completedQuantity,
          remainingQuantity: completedQuantity,
          reservedQuantity: 0,
          createdById: userId,
          sourceTaskId: task.id,
        },
      });

      // Update finished product stock
      const updatedFinishedProduct = await tx.product.update({
        where: { id: task.productId },
        data: {
          currentStock: { increment: completedQuantity },
        },
      });

      // Cost the output batch from what this run actually consumed. Labour is
      // apportioned when the task completes — see `batch-costing.service`.
      const provisionalUnitCost = await batchCosting.costManufacturedBatch(
        tx,
        outputBatch.id,
        task.id,
        completedQuantity,
      );

      // Log assembly movement for finished product. The movement records what
      // the batch cost to make, not what the product sells for — booking the
      // list price here made every manufactured margin look like zero.
      await tx.stockMovement.create({
        data: {
          productId: task.productId,
          batchId: outputBatch.id,
          type: 'ASSEMBLY',
          quantity: completedQuantity,
          unitCost: provisionalUnitCost,
          totalCost: completedQuantity * provisionalUnitCost,
          relatedTaskId: task.id,
          performedById: userId,
          notes: `Production output batch ${outputBatchNumber} created from task: ${task.title}`,
        },
      });

      const newCompletedQty = Number(task.completedQuantity) + completedQuantity;
      const newRemainingQty = totalProdQty - newCompletedQty;

      const isFullyCompleted = newRemainingQty === 0;
      const nextStatus = isFullyCompleted ? 'COMPLETED' : 'PARTIALLY_COMPLETED';

      const updatedTask = await tx.task.update({
        where: { id: taskId },
        data: {
          completedQuantity: newCompletedQty,
          remainingQuantity: newRemainingQty,
          status: nextStatus,
          ...(isFullyCompleted && {
            completedAt: new Date(),
            completedById: userId,
          }),
        },
      });

      if (isFullyCompleted) {
        // The run is over, so its labour can finally be split across everything
        // it produced. Until now those batches carried material cost only.
        await batchCosting.finalizeTaskCosts(tx, taskId);

        await notificationServices.notifyAdmins(
          'Task Completed',
          `Production task "${task.title}" has been completed`,
          `/tasks/${task.id}`,
          `TASK_COMPLETED:${task.id}`
        );
      } else {
        await notificationServices.notifyAdmins(
          'Partial Production Reported',
          `Produced ${completedQuantity} units for task "${task.title}" (Remaining: ${newRemainingQty})`,
          `/tasks/${task.id}`,
          `TASK_PARTIAL:${task.id}:${newCompletedQty}`
        );
      }

      return {
        task: await taskServices.getTaskByIdInternal(updatedTask.id, tx),
        outputBatch,
      };
    });
  },

  /**
   * Employee/Admin reports damaged, lost, or faulty component.
   */
  reportDamage: async (payload: ReportDamagePayload) => {
    const { taskId, productId, batchId, quantity, reason, userId } = payload;

    if (quantity <= 0) {
      throw new ApiError(400, 'Damage quantity must be greater than 0');
    }

    return await (prisma as any).$transaction(async (tx: any) => {
      const task = await tx.task.findUnique({
        where: { id: taskId },
        include: { assignments: true },
      });
      if (!task) throw ApiError.notFound('Task not found');

      if (payload.userRole === 'EMPLOYEE') {
        const isAssigned = task.assignments.some((a: any) => a.employeeId === userId);
        if (!isAssigned) {
          throw new ApiError(403, 'Forbidden: You are not assigned to this task');
        }
      }

      const product = await tx.product.findUnique({ where: { id: productId } });
      if (!product) throw ApiError.notFound('Product not found');

      if (batchId) {
        const batch = await tx.inventoryBatch.findUnique({ where: { id: batchId } });
        if (!batch) throw ApiError.notFound('Batch not found');

        await tx.inventoryBatch.update({
          where: { id: batchId },
          data: {
            remainingQuantity: Math.max(0, Number(batch.remainingQuantity) - quantity),
            reservedQuantity: Math.max(0, Number(batch.reservedQuantity) - quantity),
          },
        });
      }

      await tx.product.update({
        where: { id: productId },
        data: { currentStock: { decrement: quantity } },
      });

      const unitCost = Number(product.unitPrice);
      const movement = await tx.stockMovement.create({
        data: {
          productId,
          batchId: batchId || null,
          type: 'DAMAGE',
          quantity: -quantity,
          unitCost,
          totalCost: quantity * unitCost,
          relatedTaskId: taskId,
          performedById: userId,
          notes: reason,
          reason,
        },
      });

      return movement;
    });
  },

  /**
   * Employee submits refill request for a task.
   */
  requestRefill: async (payload: RequestRefillPayload) => {
    const { taskId, productId, quantity, reason, userId } = payload;

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { assignments: true },
    });
    if (!task) throw ApiError.notFound('Task not found');

    if (payload.userRole === 'EMPLOYEE') {
      const isAssigned = task.assignments.some((a: any) => a.employeeId === userId);
      if (!isAssigned) {
        throw new ApiError(403, 'Forbidden: You are not assigned to this task');
      }
    }

    const request = await prisma.productRequest.create({
      data: {
        taskId,
        productId,
        quantity,
        type: 'TASK_RELATED',
        status: 'PENDING',
        requestedById: userId,
        reason,
      },
      include: {
        product: { select: { id: true, name: true, sku: true, unit: true } },
        requestedBy: { select: { id: true, name: true, email: true } },
      },
    });

    await notificationServices.notifyAdmins(
      'New Refill Request',
      `Refill requested for task "${task.title}" (${quantity} units of ${request.product.name})`,
      `/tasks/${task.id}`,
      `REFILL_REQUESTED:${request.id}`
    );

    return request;
  },

  /**
   * Admin approves or rejects refill request.
   */
  decideRefill: async (payload: DecideRefillPayload) => {
    const { requestId, status, rejectionReason, allocatedBatchId, userId } = payload;

    return await (prisma as any).$transaction(async (tx: any) => {
      const request = await tx.productRequest.findUnique({
        where: { id: requestId },
        include: { task: true, product: true },
      });

      if (!request) throw ApiError.notFound('Refill request not found');

      if (status === 'REJECTED') {
        const rejected = await tx.productRequest.update({
          where: { id: requestId },
          data: {
            status: 'REJECTED',
            rejectionReason: rejectionReason || 'Rejected by Admin',
            approvedById: userId,
          },
        });

        await notificationServices.create(
          request.requestedById,
          'Refill Request Rejected',
          `Your refill request for task "${request.task?.title || 'Task'}" was rejected${rejectionReason ? `: ${rejectionReason}` : ''}`,
          request.taskId ? `/tasks/${request.taskId}` : '/requests',
          `REFILL_REJECTED:${request.id}`
        );

        return rejected;
      }

      // Approved Refill: Allocate additional batch inventory if batch provided
      if (allocatedBatchId && request.taskId) {
        const batch = await tx.inventoryBatch.findUnique({ where: { id: allocatedBatchId } });
        if (!batch) throw ApiError.notFound('Allocated batch not found');

        await tx.taskBatchAllocation.upsert({
          where: {
            taskId_batchId: { taskId: request.taskId, batchId: allocatedBatchId },
          },
          update: {
            allocatedQuantity: { increment: Number(request.quantity) },
          },
          create: {
            taskId: request.taskId,
            batchId: allocatedBatchId,
            allocatedQuantity: Number(request.quantity),
          },
        });
      }

      const updatedRequest = await tx.productRequest.update({
        where: { id: requestId },
        data: {
          status: 'APPROVED',
          approvedById: userId,
        },
      });

      await notificationServices.create(
        request.requestedById,
        'Refill Request Approved',
        `Your refill request for task "${request.task?.title || 'Task'}" has been approved`,
        request.taskId ? `/tasks/${request.taskId}` : '/requests',
        `REFILL_APPROVED:${request.id}`
      );

      return updatedRequest;
    });
  },

  /**
   * Admin cancels task. Releases reserved batch inventory if task was accepted.
   */
  cancelTask: async (taskId: string, userId: string) => {
    return await (prisma as any).$transaction(async (tx: any) => {
      const task = await tx.task.findUnique({
        where: { id: taskId },
        include: {
          // `batch.product` is needed to value consumption when a batch
          // predates costing; omitting it is what produced zero-cost movements.
          batchAllocations: { include: { batch: { include: { product: true } } } },
          assignments: true,
        },
      });

      if (!task) throw ApiError.notFound('Task not found');

      if (task.status === 'CANCELLED' || task.status === 'COMPLETED') {
        throw new ApiError(400, `Task cannot be cancelled from status ${task.status}`);
      }

      // If inventory was reserved, release reservations
      if (task.status === 'ACCEPTED' || task.status === 'IN_PROGRESS' || task.status === 'PARTIALLY_COMPLETED') {
        for (const alloc of task.batchAllocations) {
          const batch = alloc.batch;
          const releaseQty = Number(alloc.allocatedQuantity);

          await tx.inventoryBatch.update({
            where: { id: batch.id },
            data: {
              reservedQuantity: Math.max(0, Number(batch.reservedQuantity) - releaseQty),
            },
          });

          await tx.stockMovement.create({
            data: {
              productId: batch.productId,
              batchId: batch.id,
              type: 'TASK_RELEASE',
              quantity: releaseQty,
              unitCost: Number(batch.product?.unitPrice || 0),
              totalCost: releaseQty * Number(batch.product?.unitPrice || 0),
              relatedTaskId: task.id,
              performedById: userId,
              reason: `Reservation released due to task cancellation`,
            },
          });
        }
      }

      const cancelledTask = await tx.task.update({
        where: { id: taskId },
        data: { status: 'CANCELLED' },
      });

      for (const a of task.assignments) {
        await notificationServices.create(
          a.employeeId,
          'Task Cancelled',
          `Task "${task.title}" has been cancelled by admin`,
          `/tasks/${task.id}`,
          `TASK_CANCELLED:${task.id}:${a.employeeId}`
        );
      }

      return taskServices.getTaskByIdInternal(cancelledTask.id, tx);
    });
  },

  /**
   * Internal helper to load full task details.
   */
  getTaskByIdInternal: async (id: string, db: any = prisma) => {
    const task = await db.task.findUnique({
      where: { id },
      include: {
        product: { select: { id: true, name: true, sku: true, itemType: true, unit: true, unitPrice: true, imageUrl: true } },
        createdBy: { select: { id: true, name: true, email: true } },
        completedBy: { select: { id: true, name: true, email: true } },
        assignments: {
          include: {
            employee: { select: { id: true, name: true, email: true } },
          },
        },
        requiredProducts: {
          include: {
            product: { select: { id: true, name: true, sku: true, unit: true, unitPrice: true } },
          },
        },
        batchAllocations: {
          include: {
            batch: {
              select: {
                id: true,
                batchNumber: true,
                remainingQuantity: true,
                reservedQuantity: true,
                product: { select: { id: true, name: true, sku: true } },
              },
            },
          },
        },
        outputBatches: { select: { id: true, batchNumber: true, remainingQuantity: true, createdAt: true } },
        subTasks: { select: { id: true, title: true, status: true, productionQuantity: true } },
      },
    });

    if (!task) throw ApiError.notFound('Task not found');
    return task;
  },

  getTaskById: async (id: string) => taskServices.getTaskByIdInternal(id),

  /**
   * Query tasks with pagination and filters.
   */
  getManyTask: async (query: any, userId?: string, userRole?: string) => {
    const pageNo = query.pageNo ? parseInt(query.pageNo, 10) : 1;
    const showPerPage = query.showPerPage ? parseInt(query.showPerPage, 10) : 20;
    const skip = (pageNo - 1) * showPerPage;

    const where: any = {};
    if (query.status) where.status = query.status;
    if (query.productId) where.productId = query.productId;
    if (query.createdBy) where.createdById = query.createdBy;

    if (userRole === 'EMPLOYEE' && userId) {
      where.OR = [
        { assignments: { some: { employeeId: userId } } },
        { createdById: userId },
      ];
    } else if (query.assigneeId) {
      where.assignments = { some: { employeeId: query.assigneeId } };
    }

    const [totalData, tasks] = await Promise.all([
      (prisma as any).task.count({ where }),
      (prisma as any).task.findMany({
        where,
        skip,
        take: showPerPage,
        include: {
          product: { select: { id: true, name: true, sku: true, unit: true, imageUrl: true } },
          createdBy: { select: { id: true, name: true, email: true } },
          assignments: {
            include: { employee: { select: { id: true, name: true, email: true } } },
          },
          batchAllocations: {
            include: { batch: { select: { id: true, batchNumber: true, remainingQuantity: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const totalPages = Math.ceil(totalData / showPerPage) || 1;
    return { tasks, totalData, totalPages, currentPage: pageNo };
  },
};
