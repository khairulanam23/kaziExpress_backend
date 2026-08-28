import { Router } from 'express';
import {
  createDisposition,
  getDispositions,
  getFinishedGoods,
  getFinishedGoodsBatch,
  getProfitReport,
  reverseDisposition,
  setSellingPrice,
} from './sales.controller';
import {
  validateCreateDisposition,
  validateDispositionQuery,
  validateFinishedGoodsQuery,
  validateProfitQuery,
  validateReverseDisposition,
  validateSellingPrice,
} from './sales.validation';
import { validateId } from '../../handlers/common-zod-validator';
import isAuthorized from '../../middlewares/is-authorized';
import { requirePermission } from '../../middlewares/require-permission';

const router = Router();

router.use(isAuthorized);

/** @route GET /api/v1/sales/finished-goods — Manufactured batches and their disposal status */
router.get('/finished-goods', requirePermission('FINISHED_GOODS_VIEW'), validateFinishedGoodsQuery, getFinishedGoods);

/** @route GET /api/v1/sales/finished-goods/:id — One batch, its cost breakdown and history */
router.get('/finished-goods/:id', requirePermission('FINISHED_GOODS_VIEW'), validateId, getFinishedGoodsBatch);

/** @route POST /api/v1/sales/finished-goods/:id/dispositions — Sell, transfer or write off */
router.post('/finished-goods/:id/dispositions', requirePermission('SALES_RECORD'), validateId, validateCreateDisposition, createDisposition);

/** @route PATCH /api/v1/sales/products/:id/selling-price — Set the default selling price */
router.patch('/products/:id/selling-price', requirePermission('SALES_SET_PRICE'), validateId, validateSellingPrice, setSellingPrice);

/** @route GET /api/v1/sales/dispositions — Disposition history */
router.get('/dispositions', requirePermission('FINISHED_GOODS_VIEW'), validateDispositionQuery, getDispositions);

/** @route POST /api/v1/sales/dispositions/:id/reverse — Undo one and return the stock */
router.post('/dispositions/:id/reverse', requirePermission('SALES_REVERSE'), validateId, validateReverseDisposition, reverseDisposition);

/** @route GET /api/v1/sales/profit — Revenue, COGS and gross profit */
router.get('/profit', requirePermission('REPORT_PROFIT'), validateProfitQuery, getProfitReport);

module.exports = router;
