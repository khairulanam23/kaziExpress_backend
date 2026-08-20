import { Router } from 'express';
import {
  createTask,
  getTaskById,
  getManyTask,
  acceptTask,
  startTask,
  reportProduction,
  reportDamage,
  requestRefill,
  decideRefill,
  cancelTask,
} from './tasks.controller';
import {
  validateCreateTask,
  validateReportProduction,
  validateReportDamage,
  validateRefillRequest,
  validateRefillDecision,
  validateTaskSearchQuery,
} from './tasks.validation';
import { validateId } from '../../handlers/common-zod-validator';
import isAuthorized from '../../middlewares/is-authorized';
import { checkRoles } from '../../middlewares/check-roles';

const router = Router();

router.use(isAuthorized);

/** @route GET /api/v1/tasks — Admin sees all, Employee sees assigned */
router.get('/', validateTaskSearchQuery, getManyTask);

/** @route POST /api/v1/tasks — Admin only: create task with explicit batch allocations */
router.post('/', checkRoles('ADMIN'), validateCreateTask, createTask);

/** @route GET /api/v1/tasks/:id — Task details */
router.get('/:id', validateId, getTaskById);

/** @route POST /api/v1/tasks/:id/accept — Employee/Admin accepts task & reserves batch inventory */
router.post('/:id/accept', validateId, acceptTask);

/** @route POST /api/v1/tasks/:id/start — Employee/Admin starts task */
router.post('/:id/start', validateId, startTask);

/** @route POST /api/v1/tasks/:id/report-production — Employee/Admin reports production result */
router.post('/:id/report-production', validateId, validateReportProduction, reportProduction);

/** @route POST /api/v1/tasks/:id/report-damage — Employee/Admin reports damage */
router.post('/:id/report-damage', validateId, validateReportDamage, reportDamage);

/** @route POST /api/v1/tasks/:id/refill-request — Employee requests refill for task */
router.post('/:id/refill-request', validateId, validateRefillRequest, requestRefill);

/** @route PATCH /api/v1/tasks/refill-requests/:id — Admin approves or rejects refill request */
router.patch('/refill-requests/:id', checkRoles('ADMIN'), validateId, validateRefillDecision, decideRefill);

/** @route POST /api/v1/tasks/:id/cancel — Admin cancels task & releases batch reservation */
router.post('/:id/cancel', checkRoles('ADMIN'), validateId, cancelTask);

module.exports = router;
