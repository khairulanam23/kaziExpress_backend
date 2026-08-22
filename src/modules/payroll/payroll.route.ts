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
import { requirePermission } from '../../middlewares/require-permission';

const router = Router();

router.use(isAuthorized);

/** @route GET /api/v1/payroll/me — Employee views own payroll summary */
router.get('/me', requirePermission('PAYROLL_VIEW'), validatePayrollQuery, getOwnPayrollSummary);

/** @route GET /api/v1/payroll/me/statement/pdf — Employee downloads own payroll statement PDF */
router.get('/me/statement/pdf', requirePermission('PAYROLL_VIEW'), downloadOwnPayrollStatementPdf);

/** @route GET /api/v1/payroll/overview — Monthly overview for all employees */
router.get('/overview', requirePermission('PAYROLL_VIEW_ALL'), validatePayrollQuery, getMonthlyPayrollOverview);

/** @route GET /api/v1/payroll/payments — Salary payment history */
router.get('/payments', requirePermission('PAYROLL_VIEW'), getSalaryPaymentHistory);

/** @route POST /api/v1/payroll/payments — Record salary payment */
router.post('/payments', requirePermission('PAYROLL_RECORD_PAYMENT'), validateCreateSalaryPayment, createSalaryPayment);

/** @route GET /api/v1/payroll/employees/:id — View specific employee payroll summary */
router.get('/employees/:id', requirePermission('PAYROLL_VIEW_ALL'), validateId, getEmployeePayrollSummary);

/** @route GET /api/v1/payroll/employees/:id/statement/pdf — Download employee payroll statement PDF */
router.get('/employees/:id/statement/pdf', requirePermission('PAYROLL_VIEW_ALL'), validateId, downloadEmployeePayrollStatementPdf);

/** @route PUT /api/v1/payroll/employees/:id/rate — Update employee hourly rate */
router.put('/employees/:id/rate', requirePermission('PAYROLL_UPDATE_RATE'), validateId, validateUpdateHourlyRate, updateEmployeeHourlyRate);

module.exports = router;
