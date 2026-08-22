import { Router } from 'express';
import { createMovement, consumeProduct, assembleProduct, getManyMovement, getMovementsForProduct } from './stock-movements.controller';
import { validateCreateMovement, validateConsume, validateAssemble, validateMovementSearchQuery } from './stock-movements.validation';
import isAuthorized from '../../middlewares/is-authorized';
import { requirePermission } from '../../middlewares/require-permission';

const router = Router();

router.use(isAuthorized);

/** @route GET /api/v1/stock-movements — List movements */
router.get('/', requirePermission('INVENTORY_VIEW_MOVEMENTS'), validateMovementSearchQuery, getManyMovement);

/** @route POST /api/v1/stock-movements — Create manual movement */
router.post('/', requirePermission('INVENTORY_MANAGE_STOCK'), validateCreateMovement, createMovement);

/** @route POST /api/v1/stock-movements/consume — Consume product(s) */
router.post('/consume', requirePermission('INVENTORY_MANAGE_STOCK'), validateConsume, consumeProduct);

/** @route POST /api/v1/stock-movements/assemble — Assemble compound product */
router.post('/assemble', requirePermission('INVENTORY_MANAGE_STOCK'), validateAssemble, assembleProduct);

/** @route GET /api/v1/stock-movements/product/:productId — Movement history of product */
router.get('/product/:productId', requirePermission('INVENTORY_VIEW_MOVEMENTS'), getMovementsForProduct);

module.exports = router;
