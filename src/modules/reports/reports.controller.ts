import { Request, Response } from 'express';
import { reportServices } from './reports.service';
import { analyticsServices } from './reports.analytics.service';
import { pdfGenerators } from '../../utils/pdf/pdf-generator.util';
import { csvExporters } from '../../utils/csv/csv-exporter.util';
import ServerResponse from '../../helpers/responses/custom-response';
import catchAsync from '../../utils/catch-async/catch-async';
import ApiError from '../../utils/errors/api-error';

interface AuthedRequest extends Request {
  user?: { id: string; email: string; role: string };
}

/**
 * `validateQuery` writes the Zod-coerced query (page/limit/year/month as
 * numbers) to `req.validatedQuery`, leaving `req.query` as raw strings.
 * Reading the raw object passed strings straight into Prisma's `take` and
 * integer `where` filters, which threw. Mirrors products/users/documents.
 */
const readQuery = (req: Request): any => ({ ...((req as any).validatedQuery ?? req.query) });

/** 1. Inventory Report */
export const getInventoryReport = catchAsync(async (req: AuthedRequest, res: Response) => {
  const data = await reportServices.getInventoryReport(readQuery(req));
  ServerResponse(res, true, 200, 'Inventory report retrieved successfully', data);
});

export const getInventoryReportPDF = catchAsync(async (req: AuthedRequest, res: Response) => {
  const data = await reportServices.getInventoryReport(readQuery(req));
  const pdfBuffer = await pdfGenerators.generateInventoryPDF(data);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="inventory-report-${Date.now()}.pdf"`);
  res.send(pdfBuffer);
});

/** 2. Stock Movement Report */
export const getStockMovementReport = catchAsync(async (req: AuthedRequest, res: Response) => {
  const data = await reportServices.getStockMovementReport(readQuery(req));
  ServerResponse(res, true, 200, 'Stock movement report retrieved successfully', data);
});

export const getStockMovementReportPDF = catchAsync(async (req: AuthedRequest, res: Response) => {
  const data = await reportServices.getStockMovementReport({ ...readQuery(req), limit: 5000 });
  const pdfBuffer = await pdfGenerators.generateStockMovementPDF(data);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="stock-movements-${Date.now()}.pdf"`);
  res.send(pdfBuffer);
});

export const exportStockMovementsCSV = catchAsync(async (req: AuthedRequest, res: Response) => {
  const data = await reportServices.getStockMovementReport({ ...readQuery(req), limit: 10000 });
  const csvStr = csvExporters.exportStockMovementsCSV(data.movements);

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="stock-movements-${Date.now()}.csv"`);
  res.status(200).send(csvStr);
});

/** 3. Production Report */
export const getProductionReport = catchAsync(async (req: AuthedRequest, res: Response) => {
  const query = readQuery(req);
  if (req.user!.role === 'EMPLOYEE') {
    query.employeeId = req.user!.id;
  }
  const data = await reportServices.getProductionReport(query);
  ServerResponse(res, true, 200, 'Production report retrieved successfully', data);
});

export const getProductionReportPDF = catchAsync(async (req: AuthedRequest, res: Response) => {
  const query = readQuery(req);
  if (req.user!.role === 'EMPLOYEE') {
    query.employeeId = req.user!.id;
  }
  const data = await reportServices.getProductionReport(query);
  const pdfBuffer = await pdfGenerators.generateProductionPDF(data);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="production-report-${Date.now()}.pdf"`);
  res.send(pdfBuffer);
});

export const exportProductionCSV = catchAsync(async (req: AuthedRequest, res: Response) => {
  const query = readQuery(req);
  if (req.user!.role === 'EMPLOYEE') {
    query.employeeId = req.user!.id;
  }
  const data = await reportServices.getProductionReport(query);
  const csvStr = csvExporters.exportProductionCSV(data.tasks);

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="production-report-${Date.now()}.csv"`);
  res.status(200).send(csvStr);
});

/** 4. Attendance Report */
export const getAttendanceReport = catchAsync(async (req: AuthedRequest, res: Response) => {
  const query = readQuery(req);
  if (req.user!.role === 'EMPLOYEE') {
    query.employeeId = req.user!.id;
  }
  const data = await reportServices.getAttendanceReport(query);
  ServerResponse(res, true, 200, 'Attendance report retrieved successfully', data);
});

export const getAttendanceReportPDF = catchAsync(async (req: AuthedRequest, res: Response) => {
  const query = readQuery(req);
  if (req.user!.role === 'EMPLOYEE') {
    query.employeeId = req.user!.id;
  }
  const data = await reportServices.getAttendanceReport(query);
  const pdfBuffer = await pdfGenerators.generateAttendancePDF(data);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="attendance-report-${Date.now()}.pdf"`);
  res.send(pdfBuffer);
});

export const exportAttendanceCSV = catchAsync(async (req: AuthedRequest, res: Response) => {
  const query = readQuery(req);
  if (req.user!.role === 'EMPLOYEE') {
    query.employeeId = req.user!.id;
  }
  const data = await reportServices.getAttendanceReport(query);
  const csvStr = csvExporters.exportAttendanceCSV(data.employeeSummaries);

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="attendance-report-${Date.now()}.csv"`);
  res.status(200).send(csvStr);
});

/** 5. Payroll Report (Admin Only) */
export const getPayrollReport = catchAsync(async (req: AuthedRequest, res: Response) => {
  const data = await reportServices.getPayrollReport(readQuery(req));
  ServerResponse(res, true, 200, 'Payroll report retrieved successfully', data);
});

export const getPayrollReportPDF = catchAsync(async (req: AuthedRequest, res: Response) => {
  const data = await reportServices.getPayrollReport(readQuery(req));
  const pdfBuffer = await pdfGenerators.generatePayrollPDF(data);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="payroll-report-${Date.now()}.pdf"`);
  res.send(pdfBuffer);
});

export const exportPayrollCSV = catchAsync(async (req: AuthedRequest, res: Response) => {
  const data = await reportServices.getPayrollReport(readQuery(req));
  const csvStr = csvExporters.exportPayrollCSV(data.employeeBreakdown, data.period);

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="payroll-report-${Date.now()}.csv"`);
  res.status(200).send(csvStr);
});

/** 6. Employee Performance Report */
export const getEmployeePerformanceReport = catchAsync(async (req: AuthedRequest, res: Response) => {
  const targetEmployeeId = req.params.id as string;

  if (req.user!.role === 'EMPLOYEE' && targetEmployeeId !== req.user!.id) {
    throw new ApiError(403, 'Forbidden: You can only view your own performance report');
  }

  const data = await reportServices.getEmployeePerformanceReport(targetEmployeeId, readQuery(req));
  ServerResponse(res, true, 200, 'Employee performance report retrieved successfully', data);
});

export const getEmployeePerformanceReportPDF = catchAsync(async (req: AuthedRequest, res: Response) => {
  const targetEmployeeId = req.params.id as string;

  if (req.user!.role === 'EMPLOYEE' && targetEmployeeId !== req.user!.id) {
    throw new ApiError(403, 'Forbidden: You can only view your own performance report');
  }

  const data = await reportServices.getEmployeePerformanceReport(targetEmployeeId, readQuery(req));
  const pdfBuffer = await pdfGenerators.generateEmployeePerformancePDF(data);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="employee-performance-${Date.now()}.pdf"`);
  res.send(pdfBuffer);
});


// ── Analytical reports (roadmap items 4, 5, 7, 11, 12) ─────────────────────

/** Waste & scrap analysis — what was destroyed, what it cost, and where. */
export const getWasteReport = catchAsync(async (req: AuthedRequest, res: Response) => {
  const data = await analyticsServices.getWasteReport(readQuery(req));
  ServerResponse(res, true, 200, 'Waste report retrieved successfully', data);
});

/** Reorder planning — consumption rate against vendor lead time. */
export const getReorderReport = catchAsync(async (req: AuthedRequest, res: Response) => {
  const data = await analyticsServices.getReorderReport(readQuery(req));
  ServerResponse(res, true, 200, 'Reorder report retrieved successfully', data);
});

/** Production cost per unit — actual material plus attributed labour. */
export const getProductionCostReport = catchAsync(async (req: AuthedRequest, res: Response) => {
  const data = await analyticsServices.getProductionCostReport(readQuery(req));
  ServerResponse(res, true, 200, 'Production cost report retrieved successfully', data);
});

/** Inventory valuation — stock on hand at actual acquisition cost. */
export const getValuationReport = catchAsync(async (req: AuthedRequest, res: Response) => {
  const data = await analyticsServices.getValuationReport(readQuery(req));
  ServerResponse(res, true, 200, 'Valuation report retrieved successfully', data);
});

/** Labour efficiency — output per hour and schedule adherence. */
export const getLabourEfficiencyReport = catchAsync(async (req: AuthedRequest, res: Response) => {
  const data = await analyticsServices.getLabourEfficiencyReport(readQuery(req));
  ServerResponse(res, true, 200, 'Labour efficiency report retrieved successfully', data);
});

/** Vendor performance — purchase price history and cost drift. */
export const getVendorPerformanceReport = catchAsync(async (req: AuthedRequest, res: Response) => {
  const data = await analyticsServices.getVendorPerformanceReport(readQuery(req));
  ServerResponse(res, true, 200, 'Vendor performance report retrieved successfully', data);
});
