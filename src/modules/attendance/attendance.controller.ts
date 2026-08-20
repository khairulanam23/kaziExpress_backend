import { Request, Response } from 'express';
import { attendanceServices } from './attendance.service';
import ServerResponse from '../../helpers/responses/custom-response';
import catchAsync from '../../utils/catch-async/catch-async';

interface AuthedRequest extends Request {
  user?: { id: string; email: string; role: string };
}

export const checkIn = catchAsync(async (req: AuthedRequest, res: Response) => {
  const result = await attendanceServices.checkIn(req.user!.id, req.body);
  ServerResponse(res, true, 201, 'Checked in successfully', result);
});

export const checkOut = catchAsync(async (req: AuthedRequest, res: Response) => {
  const result = await attendanceServices.checkOut(req.user!.id, req.body);
  ServerResponse(res, true, 200, 'Checked out successfully', result);
});

export const getMyTodayStatus = catchAsync(async (req: AuthedRequest, res: Response) => {
  const result = await attendanceServices.getMyTodayStatus(req.user!.id);
  ServerResponse(res, true, 200, "Today's status retrieved successfully", result);
});

export const getManyAttendance = catchAsync(async (req: AuthedRequest, res: Response) => {
  const { records, totalData, totalPages, currentPage } = await attendanceServices.getManyAttendance(
    req.query,
    req.user!
  );
  ServerResponse(res, true, 200, 'Attendance records retrieved successfully', {
    records,
    totalData,
    totalPages,
    currentPage,
  });
});

export const decideOvertime = catchAsync(async (req: AuthedRequest, res: Response) => {
  const result = await attendanceServices.decideOvertime(
    req.params.id as string,
    req.body,
    req.user!.id
  );
  ServerResponse(res, true, 200, 'Overtime decision updated successfully', result);
});

export const overrideAttendance = catchAsync(async (req: AuthedRequest, res: Response) => {
  const result = await attendanceServices.overrideAttendance(
    req.params.id as string,
    req.body,
    req.user!.id
  );
  ServerResponse(res, true, 200, 'Attendance record corrected successfully', result);
});

export const getMonthlyOvertimeReport = catchAsync(async (req: Request, res: Response) => {
  const year = req.query.year ? parseInt(req.query.year as string, 10) : new Date().getFullYear();
  const month = req.query.month ? parseInt(req.query.month as string, 10) : new Date().getMonth() + 1;
  const result = await attendanceServices.getMonthlyOvertimeReport(year, month);
  ServerResponse(res, true, 200, 'Monthly overtime report generated successfully', result);
});

export const getRequiredWorkingHours = catchAsync(async (_req: Request, res: Response) => {
  const hours = await attendanceServices.getRequiredWorkingHours();
  ServerResponse(res, true, 200, 'Required working hours retrieved successfully', { requiredWorkingHours: hours });
});

export const setRequiredWorkingHours = catchAsync(async (req: AuthedRequest, res: Response) => {
  const hours = req.body.requiredWorkingHours;
  const result = await attendanceServices.setRequiredWorkingHours(hours, req.user!.id);
  ServerResponse(res, true, 200, 'Required working hours updated successfully', result);
});
