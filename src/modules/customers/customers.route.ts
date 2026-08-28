import { Router } from 'express';
import {
  createCustomer,
  deleteCustomer,
  getCustomerById,
  getManyCustomer,
  updateCustomer,
} from './customers.controller';
import {
  validateCreateCustomer,
  validateCustomerQuery,
  validateUpdateCustomer,
} from './customers.validation';
import { validateId } from '../../handlers/common-zod-validator';
import isAuthorized from '../../middlewares/is-authorized';
import { requirePermission } from '../../middlewares/require-permission';

const router = Router();

router.use(isAuthorized);

/** @route GET /api/v1/customers — List customers */
router.get('/', requirePermission('CUSTOMER_VIEW'), validateCustomerQuery, getManyCustomer);

/** @route POST /api/v1/customers — Create a customer */
router.post('/', requirePermission('CUSTOMER_MANAGE'), validateCreateCustomer, createCustomer);

/** @route GET /api/v1/customers/:id — Customer detail */
router.get('/:id', requirePermission('CUSTOMER_VIEW'), validateId, getCustomerById);

/** @route PATCH /api/v1/customers/:id — Update a customer */
router.patch('/:id', requirePermission('CUSTOMER_MANAGE'), validateId, validateUpdateCustomer, updateCustomer);

/** @route DELETE /api/v1/customers/:id — Delete, or deactivate if they have history */
router.delete('/:id', requirePermission('CUSTOMER_MANAGE'), validateId, deleteCustomer);

module.exports = router;
