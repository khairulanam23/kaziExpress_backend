import { Router } from 'express';
import { createVendor, updateVendor, deleteVendor, getVendorById, getManyVendor } from './vendors.controller';
import { validateCreateVendor, validateUpdateVendor, validateVendorSearchQuery } from './vendors.validation';
import { validateId } from '../../handlers/common-zod-validator';
import isAuthorized from '../../middlewares/is-authorized';
import { requirePermission } from '../../middlewares/require-permission';

const router = Router();

router.use(isAuthorized);

/** @route GET /api/v1/vendors — List all vendors */
router.get('/', requirePermission('VENDOR_VIEW'), validateVendorSearchQuery, getManyVendor);

/** @route POST /api/v1/vendors — Create vendor */
router.post('/', requirePermission('VENDOR_CREATE'), validateCreateVendor, createVendor);

/** @route GET /api/v1/vendors/:id — Vendor detail */
router.get('/:id', requirePermission('VENDOR_VIEW'), validateId, getVendorById);

/** @route PATCH /api/v1/vendors/:id — Update vendor */
router.patch('/:id', requirePermission('VENDOR_UPDATE'), validateId, validateUpdateVendor, updateVendor);

/** @route DELETE /api/v1/vendors/:id — Soft-delete vendor */
router.delete('/:id', requirePermission('VENDOR_DELETE'), validateId, deleteVendor);

module.exports = router;
