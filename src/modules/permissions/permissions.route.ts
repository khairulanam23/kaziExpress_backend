import { Router } from 'express';
import {
  getAllPermissions,
  getUserPermissions,
  replaceUserPermissions,
  addUserPermissions,
  removeUserPermission,
} from './permissions.controller';
import { validatePermissionsPayload } from './permissions.validation';
import { validateId } from '../../handlers/common-zod-validator';
import isAuthorized from '../../middlewares/is-authorized';
import { requirePermission } from '../../middlewares/require-permission';

const router = Router();

router.use(isAuthorized);
router.use(requirePermission('EMPLOYEE_MANAGE_PERMISSIONS'));

// GET /api/v1/permissions — List all available system permissions & presets
router.get('/', getAllPermissions);

// GET /api/v1/permissions/employees/:id — Get permissions for an employee
router.get('/employees/:id', validateId, getUserPermissions);

// PUT /api/v1/permissions/employees/:id — Replace permissions for an employee
router.put('/employees/:id', validateId, validatePermissionsPayload, replaceUserPermissions);

// POST /api/v1/permissions/employees/:id — Add permissions for an employee
router.post('/employees/:id', validateId, validatePermissionsPayload, addUserPermissions);

// DELETE /api/v1/permissions/employees/:id/:permissionKey — Delete a permission from an employee
router.delete('/employees/:id/:permissionKey', validateId, removeUserPermission);

module.exports = router;
