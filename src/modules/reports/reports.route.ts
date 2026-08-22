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
import { requirePermission } from '../../middlewares/require-permission';

const router = Router();

router.use(isAuthorized);

/** Inventory Reports */
router.get('/inventory/pdf', requirePermission('REPORT_INVENTORY'), validateInventoryReportQuery, getInventoryReportPDF);
router.get('/inventory', requirePermission('REPORT_INVENTORY'), validateInventoryReportQuery, getInventoryReport);

/** Stock Movement Reports */
router.get('/stock-movements/pdf', requirePermission('REPORT_STOCK_MOVEMENTS'), validateStockMovementReportQuery, getStockMovementReportPDF);
router.get('/stock-movements/export', requirePermission('REPORT_STOCK_MOVEMENTS'), validateStockMovementReportQuery, exportStockMovementsCSV);
router.get('/stock-movements', requirePermission('REPORT_STOCK_MOVEMENTS'), validateStockMovementReportQuery, getStockMovementReport);

/** Production Reports */
router.get('/production/pdf', requirePermission('REPORT_PRODUCTION'), validateProductionReportQuery, getProductionReportPDF);
router.get('/production/export', requirePermission('REPORT_PRODUCTION'), validateProductionReportQuery, exportProductionCSV);
router.get('/production', requirePermission('REPORT_PRODUCTION'), validateProductionReportQuery, getProductionReport);

/** Attendance Reports */
router.get('/attendance/pdf', requirePermission('REPORT_ATTENDANCE'), validateAttendanceReportQuery, getAttendanceReportPDF);
router.get('/attendance/export', requirePermission('REPORT_ATTENDANCE'), validateAttendanceReportQuery, exportAttendanceCSV);
router.get('/attendance', requirePermission('REPORT_ATTENDANCE'), validateAttendanceReportQuery, getAttendanceReport);

/** Payroll Reports */
router.get('/payroll/pdf', requirePermission('REPORT_PAYROLL'), validatePayrollReportQuery, getPayrollReportPDF);
router.get('/payroll/export', requirePermission('REPORT_PAYROLL'), validatePayrollReportQuery, exportPayrollCSV);
router.get('/payroll', requirePermission('REPORT_PAYROLL'), validatePayrollReportQuery, getPayrollReport);

/** Employee Performance Reports */
router.get('/employee-performance/:id/pdf', requirePermission('REPORT_EMPLOYEE_PERFORMANCE'), validateId, validateEmployeePerformanceQuery, getEmployeePerformanceReportPDF);
router.get('/employee-performance/:id', requirePermission('REPORT_EMPLOYEE_PERFORMANCE'), validateId, validateEmployeePerformanceQuery, getEmployeePerformanceReport);

module.exports = router;
