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
import { requirePermission } from '../../middlewares/require-permission';

const router = Router();

router.use(isAuthorized);

/** @route GET /api/v1/tasks — View tasks */
router.get('/', requirePermission('PRODUCTION_VIEW'), validateTaskSearchQuery, getManyTask);

/** @route POST /api/v1/tasks — Create task */
router.post('/', requirePermission('PRODUCTION_CREATE_TASK'), validateCreateTask, createTask);

/** @route GET /api/v1/tasks/:id — Task details */
router.get('/:id', requirePermission('PRODUCTION_VIEW'), validateId, getTaskById);

/** @route POST /api/v1/tasks/:id/accept — Accept task */
router.post('/:id/accept', requirePermission('PRODUCTION_REPORT'), validateId, acceptTask);

/** @route POST /api/v1/tasks/:id/start — Start task */
router.post('/:id/start', requirePermission('PRODUCTION_REPORT'), validateId, startTask);

/** @route POST /api/v1/tasks/:id/report-production — Report production output */
router.post('/:id/report-production', requirePermission('PRODUCTION_REPORT'), validateId, validateReportProduction, reportProduction);

/** @route POST /api/v1/tasks/:id/report-damage — Report material damage */
router.post('/:id/report-damage', requirePermission('PRODUCTION_REPORT_DAMAGE'), validateId, validateReportDamage, reportDamage);

/** @route POST /api/v1/tasks/:id/refill-request — Request refill */
router.post('/:id/refill-request', requirePermission('PRODUCTION_MANAGE_REFILL'), validateId, validateRefillRequest, requestRefill);

/** @route PATCH /api/v1/tasks/refill-requests/:id — Decide refill request */
router.patch('/refill-requests/:id', requirePermission('PRODUCTION_MANAGE_REFILL'), validateId, validateRefillDecision, decideRefill);

/** @route POST /api/v1/tasks/:id/cancel — Cancel task */
router.post('/:id/cancel', requirePermission('PRODUCTION_MANAGE_TASK'), validateId, cancelTask);

module.exports = router;
