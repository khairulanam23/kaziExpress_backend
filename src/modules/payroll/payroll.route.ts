import { Router } from 'express';
import {
  getOwnPayrollSummary,
  getEmployeePayrollSummary,
  getMonthlyPayrollOverview,
  updateEmployeeHourlyRate,
  createSalaryPayment,
  getSalaryPaymentHistory,
  downloadOwnPayrollStatementPdf,
  downloadEmployeePayrollStatementPdf,
} from './payroll.controller';
import {
  validateCreateSalaryPayment,
  validateUpdateHourlyRate,
  validatePayrollQuery,
} from './payroll.validation';
import { validateId } from '../../handlers/common-zod-validator';
import isAuthorized from '../../middlewares/is-authorized';
import { checkRoles } from '../../middlewares/check-roles';

const router = Router();

router.use(isAuthorized);

/** @route GET /api/v1/payroll/me — Employee views own payroll summary */
router.get('/me', validatePayrollQuery, getOwnPayrollSummary);

/** @route GET /api/v1/payroll/me/statement/pdf — Employee downloads own payroll statement PDF */
router.get('/me/statement/pdf', downloadOwnPayrollStatementPdf);

/** @route GET /api/v1/payroll/overview — Admin only: Monthly overview for all employees */
router.get('/overview', checkRoles('ADMIN'), validatePayrollQuery, getMonthlyPayrollOverview);

/** @route GET /api/v1/payroll/payments — Admin / Employee (own) */
router.get('/payments', getSalaryPaymentHistory);

/** @route POST /api/v1/payroll/payments — Admin only: Record salary payment */
router.post('/payments', checkRoles('ADMIN'), validateCreateSalaryPayment, createSalaryPayment);

/** @route GET /api/v1/payroll/employees/:id — Admin only: View specific employee payroll summary */
router.get('/employees/:id', checkRoles('ADMIN'), validateId, getEmployeePayrollSummary);

/** @route GET /api/v1/payroll/employees/:id/statement/pdf — Admin only: Download employee payroll statement PDF */
router.get('/employees/:id/statement/pdf', checkRoles('ADMIN'), validateId, downloadEmployeePayrollStatementPdf);

/** @route PUT /api/v1/payroll/employees/:id/rate — Admin only: Update employee hourly rate */
router.put('/employees/:id/rate', checkRoles('ADMIN'), validateId, validateUpdateHourlyRate, updateEmployeeHourlyRate);

module.exports = router;
