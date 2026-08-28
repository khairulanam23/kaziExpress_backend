import { Router } from 'express';
import { addStock, adjustStock, getBatches, getMovements, getBatchTrace } from './inventory.controller';
import { validateAddStock, validateAdjustStock, validateMovementQuery } from './inventory.validation';
import { validateId } from '../../handlers/common-zod-validator';
import isAuthorized from '../../middlewares/is-authorized';
import { requirePermission } from '../../middlewares/require-permission';

const router = Router();

router.use(isAuthorized);

/** @route GET /api/v1/inventory/batches — List active batches */
router.get('/batches', requirePermission('INVENTORY_VIEW'), getBatches);

/** @route GET /api/v1/inventory/batches/:id/trace — Batch genealogy & recall trace */
router.get('/batches/:id/trace', requirePermission('INVENTORY_MANAGE_BATCHES'), validateId, getBatchTrace);

/** @route GET /api/v1/inventory/movements — View inventory movement history */
router.get('/movements', requirePermission('INVENTORY_VIEW_MOVEMENTS'), validateMovementQuery, getMovements);

/** @route POST /api/v1/inventory/add — Add stock & auto-create batch */
router.post('/add', requirePermission('INVENTORY_CREATE'), validateAddStock, addStock);

/** @route POST /api/v1/inventory/adjust — Adjust stock with accountability note */
router.post('/adjust', requirePermission('INVENTORY_MANAGE_STOCK'), validateAdjustStock, adjustStock);

module.exports = router;
