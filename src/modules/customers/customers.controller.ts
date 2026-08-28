import { Request, Response } from 'express';
import catchAsync from '../../utils/catch-async/catch-async';
import ServerResponse from '../../helpers/responses/custom-response';
import { customerServices } from './customers.service';

interface AuthedRequest extends Request {
  user?: { id: string; email: string; role: string };
}

/** `validateQuery` writes coerced values to `validatedQuery`, not `req.query`. */
const readQuery = (req: Request): any => ({ ...((req as any).validatedQuery ?? req.query) });

export const getManyCustomer = catchAsync(async (req: AuthedRequest, res: Response) => {
  const data = await customerServices.getMany(readQuery(req));
  ServerResponse(res, true, 200, 'Customers retrieved successfully', data);
});

export const getCustomerById = catchAsync(async (req: AuthedRequest, res: Response) => {
  const data = await customerServices.getById(String(req.params.id));
  ServerResponse(res, true, 200, 'Customer retrieved successfully', data);
});

export const createCustomer = catchAsync(async (req: AuthedRequest, res: Response) => {
  const data = await customerServices.create(req.body, req.user!.id);
  ServerResponse(res, true, 201, 'Customer created successfully', data);
});

export const updateCustomer = catchAsync(async (req: AuthedRequest, res: Response) => {
  const data = await customerServices.update(String(req.params.id), req.body);
  ServerResponse(res, true, 200, 'Customer updated successfully', data);
});

export const deleteCustomer = catchAsync(async (req: AuthedRequest, res: Response) => {
  const result = await customerServices.remove(String(req.params.id));
  ServerResponse(
    res,
    true,
    200,
    result.deactivated
      ? 'Customer deactivated — past sales keep their buyer'
      : 'Customer deleted successfully',
    result.customer,
  );
});
