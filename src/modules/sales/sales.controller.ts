import { Request, Response } from 'express';
import catchAsync from '../../utils/catch-async/catch-async';
import ServerResponse from '../../helpers/responses/custom-response';
import { salesServices } from './sales.service';
import { profitServices } from './profit.service';

interface AuthedRequest extends Request {
  user?: { id: string; email: string; role: string };
}

/** `validateQuery` writes coerced values to `validatedQuery`, not `req.query`. */
const readQuery = (req: Request): any => ({ ...((req as any).validatedQuery ?? req.query) });

/** The finished goods register: manufactured batches and what became of them. */
export const getFinishedGoods = catchAsync(async (req: AuthedRequest, res: Response) => {
  const data = await salesServices.getFinishedGoods(readQuery(req));
  ServerResponse(res, true, 200, 'Finished goods retrieved successfully', data);
});

export const getFinishedGoodsBatch = catchAsync(async (req: AuthedRequest, res: Response) => {
  const data = await salesServices.getFinishedGoodsBatch(String(req.params.id));
  ServerResponse(res, true, 200, 'Finished goods batch retrieved successfully', data);
});

/** Sets the default price offered for a product's finished goods. */
export const setSellingPrice = catchAsync(async (req: AuthedRequest, res: Response) => {
  const data = await salesServices.setSellingPrice(String(req.params.id), req.body.sellingPrice);
  ServerResponse(res, true, 200, 'Selling price updated successfully', data);
});

/** Sell, transfer to the own store, or write off part of a batch. */
export const createDisposition = catchAsync(async (req: AuthedRequest, res: Response) => {
  const data = await salesServices.createDisposition(String(req.params.id), req.body, req.user!.id);
  ServerResponse(res, true, 201, 'Disposition recorded successfully', data);
});

export const reverseDisposition = catchAsync(async (req: AuthedRequest, res: Response) => {
  const data = await salesServices.reverseDisposition(String(req.params.id), req.body.reason, req.user!.id);
  ServerResponse(res, true, 200, 'Disposition reversed and stock returned to its batch', data);
});

export const getDispositions = catchAsync(async (req: AuthedRequest, res: Response) => {
  const data = await salesServices.getDispositions(readQuery(req));
  ServerResponse(res, true, 200, 'Dispositions retrieved successfully', data);
});

/** Revenue, cost of goods sold and gross profit. */
export const getProfitReport = catchAsync(async (req: AuthedRequest, res: Response) => {
  const data = await profitServices.getProfitReport(readQuery(req));
  ServerResponse(res, true, 200, 'Profit report retrieved successfully', data);
});
