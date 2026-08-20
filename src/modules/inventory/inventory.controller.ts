import { Request, Response } from 'express';
import catchAsync from '../../utils/catch-async/catch-async';
import ServerResponse from '../../helpers/responses/custom-response';
import { inventoryService } from './inventory.service';

interface AuthedRequest extends Request {
  user?: { id: string; email: string; role: string };
}

export const addStock = catchAsync(async (req: AuthedRequest, res: Response) => {
  const userId = req.user!.id;
  const result = await inventoryService.addStock({
    ...req.body,
    userId,
  });

  return ServerResponse(res, true, 201, 'Stock added successfully and new batch created', result);
});

export const adjustStock = catchAsync(async (req: AuthedRequest, res: Response) => {
  const userId = req.user!.id;
  const result = await inventoryService.adjustStock({
    ...req.body,
    userId,
  });

  return ServerResponse(res, true, 200, 'Inventory adjusted successfully', result);
});

export const getBatches = catchAsync(async (req: Request, res: Response) => {
  const productId = req.query.productId as string | undefined;
  const batches = await inventoryService.listBatches(productId);

  return ServerResponse(res, true, 200, 'Batches retrieved successfully', batches);
});

export const getMovements = catchAsync(async (req: Request, res: Response) => {
  // `validateMovementQuery` writes the coerced values (pageNo/showPerPage as
  // numbers) to `validatedQuery`; reading raw `req.query` passed strings
  // straight through to Prisma's `take`. Matches the convention used by the
  // products/users/documents controllers.
  const query = ((req as any).validatedQuery || req.query) as any;
  const result = await inventoryService.listMovements(query);

  return ServerResponse(res, true, 200, 'Inventory movements retrieved successfully', {
    movements: result.movements,
    totalData: result.totalData,
    totalPages: result.totalPages,
    currentPage: result.currentPage,
  });
});
