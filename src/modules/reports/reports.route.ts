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
  getWasteReport,
  getReorderReport,
  getProductionCostReport,
  getValuationReport,
  getLabourEfficiencyReport,
  getVendorPerformanceReport,
  getEmployeePerformanceReportPDF,
} from './reports.controller';
import {
  validateInventoryReportQuery,
  validateStockMovementReportQuery,
  validateProductionReportQuery,
  validateAttendanceReportQuery,
  validatePayrollReportQuery,
  validateEmployeePerformanceQuery,
  validateWasteReportQuery,
  validateReorderReportQuery,
  validateProductionCostQuery,
  validateValuationQuery,
  validateLabourEfficiencyQuery,
  validateVendorPerformanceQuery,
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

/** Waste & scrap analysis — reads the same DAMAGE/WRITE_OFF ledger as the movement report. */
router.get('/waste', requirePermission('REPORT_STOCK_MOVEMENTS'), validateWasteReportQuery, getWasteReport);

/** Reorder planning & inventory valuation — inventory reporting. */
router.get('/reorder', requirePermission('REPORT_INVENTORY'), validateReorderReportQuery, getReorderReport);
router.get('/valuation', requirePermission('REPORT_INVENTORY'), validateValuationQuery, getValuationReport);

/** Production economics — production reporting. */
router.get('/production-cost', requirePermission('REPORT_PRODUCTION'), validateProductionCostQuery, getProductionCostReport);
router.get('/labour-efficiency', requirePermission('REPORT_PRODUCTION'), validateLabourEfficiencyQuery, getLabourEfficiencyReport);

/** Vendor performance — purchasing analysis, gated with the inventory reports. */
router.get('/vendor-performance', requirePermission('REPORT_INVENTORY'), validateVendorPerformanceQuery, getVendorPerformanceReport);

module.exports = router;
