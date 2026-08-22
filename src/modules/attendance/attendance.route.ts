import { Router } from 'express';
import {
  checkIn,
  checkOut,
  getMyTodayStatus,
  getManyAttendance,
  decideOvertime,
  overrideAttendance,
  getMonthlyOvertimeReport,
  getRequiredWorkingHours,
  setRequiredWorkingHours,
} from './attendance.controller';
import {
  validateCheckIn,
  validateCheckOut,
  validateDecideOvertime,
  validateAdminAttendanceOverride,
  validateUpdateRequiredHours,
  validateAttendanceSearchQuery,
} from './attendance.validation';
import { validateId } from '../../handlers/common-zod-validator';
import isAuthorized from '../../middlewares/is-authorized';
import { requirePermission } from '../../middlewares/require-permission';

const router = Router();

router.use(isAuthorized);

/** @route POST /api/v1/attendance/check-in — Employee / Device */
router.post('/check-in', validateCheckIn, checkIn);

/** @route POST /api/v1/attendance/check-out — Employee / Device */
router.post('/check-out', validateCheckOut, checkOut);

/** @route GET /api/v1/attendance/me/today — Employee views today status */
router.get('/me/today', getMyTodayStatus);

/** @route GET /api/v1/attendance/overtime/monthly — Monthly overtime report */
router.get('/overtime/monthly', requirePermission('OVERTIME_VIEW'), getMonthlyOvertimeReport);

/** @route GET /api/v1/attendance/config/required-hours — Required working hours */
router.get('/config/required-hours', getRequiredWorkingHours);

/** @route PUT /api/v1/attendance/config/required-hours — Update required working hours */
router.put('/config/required-hours', requirePermission('ATTENDANCE_MANAGE'), validateUpdateRequiredHours, setRequiredWorkingHours);

/** @route GET /api/v1/attendance — Admin sees all, Employee sees own */
router.get('/', validateAttendanceSearchQuery, getManyAttendance);

/** @route PATCH /api/v1/attendance/:id/overtime — Approve/Reject/Edit overtime */
router.patch('/:id/overtime', requirePermission('OVERTIME_DECIDE'), validateId, validateDecideOvertime, decideOvertime);

/** @route PATCH /api/v1/attendance/:id/override — Override/correct attendance record */
router.patch('/:id/override', requirePermission('OVERTIME_OVERRIDE'), validateId, validateAdminAttendanceOverride, overrideAttendance);

module.exports = router;
