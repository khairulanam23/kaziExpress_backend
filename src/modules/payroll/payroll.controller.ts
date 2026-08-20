import { Request, Response } from 'express';
import { payrollServices } from './payroll.service';
import ServerResponse from '../../helpers/responses/custom-response';
import catchAsync from '../../utils/catch-async/catch-async';

interface AuthedRequest extends Request {
  user?: { id: string; email: string; role: string };
}

export const getOwnPayrollSummary = catchAsync(async (req: AuthedRequest, res: Response) => {
  const year = req.query.year ? parseInt(req.query.year as string, 10) : new Date().getFullYear();
  const month = req.query.month ? parseInt(req.query.month as string, 10) : new Date().getMonth() + 1;
  const result = await payrollServices.getEmployeePayrollSummary(req.user!.id, year, month);
  ServerResponse(res, true, 200, 'Payroll summary retrieved successfully', result);
});

export const getEmployeePayrollSummary = catchAsync(async (req: Request, res: Response) => {
  const employeeId = req.params.id as string;
  const year = req.query.year ? parseInt(req.query.year as string, 10) : new Date().getFullYear();
  const month = req.query.month ? parseInt(req.query.month as string, 10) : new Date().getMonth() + 1;
  const result = await payrollServices.getEmployeePayrollSummary(employeeId, year, month);
  ServerResponse(res, true, 200, 'Employee payroll summary retrieved successfully', result);
});

export const getMonthlyPayrollOverview = catchAsync(async (req: Request, res: Response) => {
  const year = req.query.year ? parseInt(req.query.year as string, 10) : new Date().getFullYear();
  const month = req.query.month ? parseInt(req.query.month as string, 10) : new Date().getMonth() + 1;
  const result = await payrollServices.getMonthlyPayrollOverview(year, month);
  ServerResponse(res, true, 200, 'Monthly payroll overview retrieved successfully', result);
});

export const updateEmployeeHourlyRate = catchAsync(async (req: AuthedRequest, res: Response) => {
  const employeeId = req.params.id as string;
  const result = await payrollServices.updateEmployeeHourlyRate(employeeId, req.body.hourlyRate, req.user!.id);
  ServerResponse(res, true, 200, 'Employee hourly rate updated successfully', result);
});

export const createSalaryPayment = catchAsync(async (req: AuthedRequest, res: Response) => {
  const result = await payrollServices.createSalaryPayment(req.body, req.user!.id);
  ServerResponse(res, true, 201, 'Salary payment recorded successfully', result);
});

export const getSalaryPaymentHistory = catchAsync(async (req: AuthedRequest, res: Response) => {
  const employeeId = req.user!.role === 'EMPLOYEE' ? req.user!.id : (req.query.employeeId as string);
  const year = req.query.year ? parseInt(req.query.year as string, 10) : undefined;
  const month = req.query.month ? parseInt(req.query.month as string, 10) : undefined;
  const result = await payrollServices.getSalaryPaymentHistory(employeeId, year, month);
  ServerResponse(res, true, 200, 'Salary payment history retrieved successfully', result);
});

export const downloadOwnPayrollStatementPdf = catchAsync(async (req: AuthedRequest, res: Response) => {
  const year = req.query.year ? parseInt(req.query.year as string, 10) : new Date().getFullYear();
  const month = req.query.month ? parseInt(req.query.month as string, 10) : new Date().getMonth() + 1;
  const pdfBuffer = await payrollServices.generatePayrollStatementPdf(req.user!.id, year, month);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=payroll-statement-${year}-${month}.pdf`);
  res.send(pdfBuffer);
});

export const downloadEmployeePayrollStatementPdf = catchAsync(async (req: Request, res: Response) => {
  const employeeId = req.params.id as string;
  const year = req.query.year ? parseInt(req.query.year as string, 10) : new Date().getFullYear();
  const month = req.query.month ? parseInt(req.query.month as string, 10) : new Date().getMonth() + 1;
  const pdfBuffer = await payrollServices.generatePayrollStatementPdf(employeeId, year, month);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=payroll-statement-${employeeId}-${year}-${month}.pdf`);
  res.send(pdfBuffer);
});
