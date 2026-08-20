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
import { checkRoles } from '../../middlewares/check-roles';

const router = Router();

router.use(isAuthorized);

/** @route POST /api/v1/attendance/check-in — Employee / Device */
router.post('/check-in', validateCheckIn, checkIn);

/** @route POST /api/v1/attendance/check-out — Employee / Device */
router.post('/check-out', validateCheckOut, checkOut);

/** @route GET /api/v1/attendance/me/today — Employee views today status */
router.get('/me/today', getMyTodayStatus);

/** @route GET /api/v1/attendance/overtime/monthly — Admin only: Monthly overtime report */
router.get('/overtime/monthly', checkRoles('ADMIN'), getMonthlyOvertimeReport);

/** @route GET /api/v1/attendance/config/required-hours — Admin / Employee */
router.get('/config/required-hours', getRequiredWorkingHours);

/** @route PUT /api/v1/attendance/config/required-hours — Admin only */
router.put('/config/required-hours', checkRoles('ADMIN'), validateUpdateRequiredHours, setRequiredWorkingHours);

/** @route GET /api/v1/attendance — Admin sees all, Employee sees own */
router.get('/', validateAttendanceSearchQuery, getManyAttendance);

/** @route PATCH /api/v1/attendance/:id/overtime — Admin only: Approve/Reject/Edit overtime */
router.patch('/:id/overtime', checkRoles('ADMIN'), validateId, validateDecideOvertime, decideOvertime);

/** @route PATCH /api/v1/attendance/:id/override — Admin only: Override/correct attendance record */
router.patch('/:id/override', checkRoles('ADMIN'), validateId, validateAdminAttendanceOverride, overrideAttendance);

module.exports = router;
