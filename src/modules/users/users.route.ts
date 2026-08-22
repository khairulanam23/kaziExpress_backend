import { Router } from 'express';
import {
  createUser,
  updateUser,
  deactivateUser,
  getUserById,
  getManyUser,
  getMe,
  updateMe,
  getMyEarnings,
  getEmployeePerformanceSummary,
  downloadEmployeeReport,
} from './users.controller';
import { validateCreateUser, validateUpdateUser, validateUpdateMe, validateUserSearchQuery, validateEarningsQuery } from './users.validation';
import { validateId } from '../../handlers/common-zod-validator';
import isAuthorized from '../../middlewares/is-authorized';
import { requirePermission } from '../../middlewares/require-permission';
import {
  getUserPermissions,
  replaceUserPermissions,
  addUserPermissions,
  removeUserPermission,
} from '../permissions/permissions.controller';
import { validatePermissionsPayload } from '../permissions/permissions.validation';

const router = Router();

// ── Self-service (must be registered before the `/:id` routes) ──

/**
 * @route GET /api/v1/users/me
 * @description Current user profile + real-time estimated earnings
 * @access Private (Employee)
 */
router.get('/me', isAuthorized, getMe);

/**
 * @route PATCH /api/v1/users/me
 * @description Update own basic profile (name, address, phone)
 * @access Private (Employee)
 */
router.patch('/me', isAuthorized, validateUpdateMe, updateMe);

/**
 * @route GET /api/v1/users/me/earnings
 * @description Detailed earnings breakdown (query: from, to)
 * @access Private (Employee)
 */
router.get('/me/earnings', isAuthorized, validateEarningsQuery, getMyEarnings);

// ── Admin / Delegated management ──

/**
 * @route GET /api/v1/users
 * @description List all users (filters: role, isActive, search)
 * @access Private (EMPLOYEE_VIEW)
 */
router.get('/', isAuthorized, requirePermission('EMPLOYEE_VIEW'), validateUserSearchQuery, getManyUser);

/**
 * @route POST /api/v1/users
 * @description Create new employee (with profile, rates, pay mode)
 * @access Private (EMPLOYEE_CREATE)
 */
router.post('/', isAuthorized, requirePermission('EMPLOYEE_CREATE'), validateCreateUser, createUser);

/**
 * @route GET /api/v1/users/:id
 * @description Get user details + employee profile
 * @access Private (EMPLOYEE_VIEW or Self)
 */
router.get('/:id', isAuthorized, validateId, getUserById);

/**
 * @route PATCH /api/v1/users/:id
 * @description Update user / employee profile / rates / rules
 * @access Private (EMPLOYEE_UPDATE)
 */
router.patch('/:id', isAuthorized, requirePermission('EMPLOYEE_UPDATE'), validateId, validateUpdateUser, updateUser);

/**
 * @route DELETE /api/v1/users/:id
 * @description Soft-delete / deactivate a user
 * @access Private (EMPLOYEE_DELETE)
 */
router.delete('/:id', isAuthorized, requirePermission('EMPLOYEE_DELETE'), validateId, deactivateUser);

/**
 * @route GET /api/v1/users/:id/performance
 * @description Monthly performance summary: tasks, hours, earnings (query: year, month)
 * @access Private (Admin, REPORT_EMPLOYEE_PERFORMANCE or Self)
 */
router.get('/:id/performance', isAuthorized, validateId, getEmployeePerformanceSummary);

/**
 * @route GET /api/v1/users/:id/report
 * @description Download PDF report (query: year, month — defaults to last month)
 * @access Private (Admin, REPORT_EMPLOYEE_PERFORMANCE or Self)
 */
router.get('/:id/report', isAuthorized, validateId, downloadEmployeeReport);

// ── Employee Permission Management ──

/** @route GET /api/v1/users/:id/permissions */
router.get('/:id/permissions', isAuthorized, requirePermission('EMPLOYEE_MANAGE_PERMISSIONS'), validateId, getUserPermissions);

/** @route PUT /api/v1/users/:id/permissions */
router.put('/:id/permissions', isAuthorized, requirePermission('EMPLOYEE_MANAGE_PERMISSIONS'), validateId, validatePermissionsPayload, replaceUserPermissions);

/** @route POST /api/v1/users/:id/permissions */
router.post('/:id/permissions', isAuthorized, requirePermission('EMPLOYEE_MANAGE_PERMISSIONS'), validateId, validatePermissionsPayload, addUserPermissions);

/** @route DELETE /api/v1/users/:id/permissions/:permissionKey */
router.delete('/:id/permissions/:permissionKey', isAuthorized, requirePermission('EMPLOYEE_MANAGE_PERMISSIONS'), validateId, removeUserPermission);

module.exports = router;
