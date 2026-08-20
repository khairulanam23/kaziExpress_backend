import { Router } from 'express';
import { addStock, adjustStock, getBatches, getMovements } from './inventory.controller';
import { validateAddStock, validateAdjustStock, validateMovementQuery } from './inventory.validation';
import isAuthorized from '../../middlewares/is-authorized';
import { checkRoles } from '../../middlewares/check-roles';

const router = Router();

router.use(isAuthorized);

/** @route GET /api/v1/inventory/batches — Admin / Employee list active batches */
router.get('/batches', getBatches);

/** @route GET /api/v1/inventory/movements — Admin / Employee view inventory history */
router.get('/movements', validateMovementQuery, getMovements);

/** @route POST /api/v1/inventory/add — Admin only: add stock & auto-create batch */
router.post('/add', checkRoles('ADMIN'), validateAddStock, addStock);

/** @route POST /api/v1/inventory/adjust — Admin only: adjust stock with accountability note */
router.post('/adjust', checkRoles('ADMIN'), validateAdjustStock, adjustStock);

module.exports = router;
