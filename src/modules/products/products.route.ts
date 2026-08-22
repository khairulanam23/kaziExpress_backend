import { Router } from 'express';
import {
  createProduct,
  updateProduct,
  deleteProduct,
  getProductById,
  getManyProduct,
  getLowStockProducts,
  getProductBOM,
  getProductBOMCost,
  replaceProductBOM,
  addOrUpdateCustomField,
  removeCustomField,
} from './products.controller';
import {
  validateCreateProduct,
  validateUpdateProduct,
  validateProductSearchQuery,
  validateReplaceBOM,
  validateCustomField,
} from './products.validation';
import { validateId } from '../../handlers/common-zod-validator';
import isAuthorized from '../../middlewares/is-authorized';
import { requirePermission } from '../../middlewares/require-permission';

const parseProductMultipart = (req: any, res: any, next: any) => {
  if (req.body) {
    delete req.body.image;
    if (typeof req.body.unitPrice === 'string' && req.body.unitPrice !== '') {
      req.body.unitPrice = Number(req.body.unitPrice);
    }
    if (typeof req.body.currentStock === 'string' && req.body.currentStock !== '') {
      req.body.currentStock = Number(req.body.currentStock);
    }
    if (typeof req.body.lowStockThreshold === 'string' && req.body.lowStockThreshold !== '') {
      req.body.lowStockThreshold = Number(req.body.lowStockThreshold);
    } else if (req.body.lowStockThreshold === '' || req.body.lowStockThreshold === 'null') {
      delete req.body.lowStockThreshold;
    }
    if (typeof req.body.reorderTimeDays === 'string' && req.body.reorderTimeDays !== '') {
      req.body.reorderTimeDays = parseInt(req.body.reorderTimeDays, 10);
    } else if (req.body.reorderTimeDays === '' || req.body.reorderTimeDays === 'null') {
      delete req.body.reorderTimeDays;
    }
    if (typeof req.body.quantityInReorder === 'string' && req.body.quantityInReorder !== '') {
      req.body.quantityInReorder = Number(req.body.quantityInReorder);
    } else if (req.body.quantityInReorder === '' || req.body.quantityInReorder === 'null') {
      delete req.body.quantityInReorder;
    }
    if (typeof req.body.isComposite === 'string') {
      req.body.isComposite = req.body.isComposite === 'true';
    }
    if (typeof req.body.isDiscontinued === 'string') {
      req.body.isDiscontinued = req.body.isDiscontinued === 'true';
    }
    if (typeof req.body.bomItems === 'string' && req.body.bomItems !== '') {
      try {
        req.body.bomItems = JSON.parse(req.body.bomItems);
      } catch (e) {
        req.body.bomItems = undefined;
      }
    } else if (req.body.bomItems === '') {
      req.body.bomItems = undefined;
    }
    if (typeof req.body.customFields === 'string' && req.body.customFields !== '') {
      try {
        req.body.customFields = JSON.parse(req.body.customFields);
      } catch (e) {
        req.body.customFields = {};
      }
    } else if (req.body.customFields === '') {
      req.body.customFields = {};
    }
    if (req.body.vendorId === '' || req.body.vendorId === 'null' || req.body.vendorId === 'undefined') {
      req.body.vendorId = null;
    }
    if (req.body.categoryId === '' || req.body.categoryId === 'null' || req.body.categoryId === 'undefined') {
      req.body.categoryId = null;
    }
  }
  next();
};

const router = Router();

router.use(isAuthorized);

/** @route GET /api/v1/products/low-stock — Low stock items */
router.get('/low-stock', requirePermission('PRODUCT_VIEW'), getLowStockProducts);

/** @route GET /api/v1/products — Search & list products */
router.get('/', requirePermission('PRODUCT_VIEW'), validateProductSearchQuery, getManyProduct);

/** @route POST /api/v1/products — Create product */
router.post('/', requirePermission('PRODUCT_CREATE'), parseProductMultipart, validateCreateProduct, createProduct);

/** @route GET /api/v1/products/:id — Product detail */
router.get('/:id', requirePermission('PRODUCT_VIEW'), validateId, getProductById);

/** @route PATCH /api/v1/products/:id — Update product */
router.patch('/:id', requirePermission('PRODUCT_UPDATE'), validateId, parseProductMultipart, validateUpdateProduct, updateProduct);

/** @route DELETE /api/v1/products/:id — Delete product */
router.delete('/:id', requirePermission('PRODUCT_DELETE'), validateId, deleteProduct);

/** @route GET /api/v1/products/:id/bom — View BOM */
router.get('/:id/bom', requirePermission('BOM_VIEW'), validateId, getProductBOM);

/** @route GET /api/v1/products/:id/bom/cost — View BOM cost breakdown */
router.get('/:id/bom/cost', requirePermission('BOM_VIEW'), validateId, getProductBOMCost);

/** @route PUT /api/v1/products/:id/bom — Replace BOM */
router.put('/:id/bom', requirePermission('BOM_UPDATE'), validateId, validateReplaceBOM, replaceProductBOM);

/** @route POST /api/v1/products/:id/custom-fields — Custom fields */
router.post('/:id/custom-fields', requirePermission('PRODUCT_UPDATE'), validateId, validateCustomField, addOrUpdateCustomField);

/** @route DELETE /api/v1/products/:id/custom-fields/:key — Custom fields */
router.delete('/:id/custom-fields/:key', requirePermission('PRODUCT_UPDATE'), validateId, removeCustomField);

module.exports = router;
