import { Router } from 'express';
import {
  getInventoryReport,
  getInventoryReportPDF,
  getStockMovementReport,
  exportStockMovementsCSV,
  getStockMovementReportPDF,
  getProductionReport,
  getProductionReportPDF,
  exportProductionCSV,
  getAttendanceReport,
  getAttendanceReportPDF,
  exportAttendanceCSV,
  getPayrollReport,
  getPayrollReportPDF,
  exportPayrollCSV,
  getEmployeePerformanceReport,
  getEmployeePerformanceReportPDF,
} from './reports.controller';
import {
  validateInventoryReportQuery,
  validateStockMovementReportQuery,
  validateProductionReportQuery,
  validateAttendanceReportQuery,
  validatePayrollReportQuery,
  validateEmployeePerformanceQuery,
} from './reports.validation';
import { validateId } from '../../handlers/common-zod-validator';
import isAuthorized from '../../middlewares/is-authorized';
import { checkRoles } from '../../middlewares/check-roles';

const router = Router();

router.use(isAuthorized);

/** Inventory Reports (Admin Only) */
router.get('/inventory/pdf', checkRoles('ADMIN'), validateInventoryReportQuery, getInventoryReportPDF);
router.get('/inventory', checkRoles('ADMIN'), validateInventoryReportQuery, getInventoryReport);

/** Stock Movement Reports (Admin Only) */
router.get('/stock-movements/pdf', checkRoles('ADMIN'), validateStockMovementReportQuery, getStockMovementReportPDF);
router.get('/stock-movements/export', checkRoles('ADMIN'), validateStockMovementReportQuery, exportStockMovementsCSV);
router.get('/stock-movements', checkRoles('ADMIN'), validateStockMovementReportQuery, getStockMovementReport);

/** Production Reports (Admin / Employee-scoped) */
router.get('/production/pdf', validateProductionReportQuery, getProductionReportPDF);
router.get('/production/export', validateProductionReportQuery, exportProductionCSV);
router.get('/production', validateProductionReportQuery, getProductionReport);

/** Attendance Reports (Admin / Employee-scoped) */
router.get('/attendance/pdf', validateAttendanceReportQuery, getAttendanceReportPDF);
router.get('/attendance/export', validateAttendanceReportQuery, exportAttendanceCSV);
router.get('/attendance', validateAttendanceReportQuery, getAttendanceReport);

/** Payroll Reports (Admin Only) */
router.get('/payroll/pdf', checkRoles('ADMIN'), validatePayrollReportQuery, getPayrollReportPDF);
router.get('/payroll/export', checkRoles('ADMIN'), validatePayrollReportQuery, exportPayrollCSV);
router.get('/payroll', checkRoles('ADMIN'), validatePayrollReportQuery, getPayrollReport);

/** Employee Performance Reports */
router.get('/employee-performance/:id/pdf', validateId, validateEmployeePerformanceQuery, getEmployeePerformanceReportPDF);
router.get('/employee-performance/:id', validateId, validateEmployeePerformanceQuery, getEmployeePerformanceReport);

module.exports = router;
