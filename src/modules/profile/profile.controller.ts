import { Request, Response } from 'express';
import { profileServices } from './profile.service';
import ServerResponse from '../../helpers/responses/custom-response';
import catchAsync from '../../utils/catch-async/catch-async';
import ApiError from '../../utils/errors/api-error';
import { contentDisposition } from '../../utils/files/file-validation.util';

interface AuthedRequest extends Request {
  user?: { id: string; email: string; role: string };
}

const readQuery = (req: Request): any => ({ ...((req as any).validatedQuery ?? req.query) });

/** express-fileupload puts the upload on `req.files`. */
const getUploadedFile = (req: Request, field = 'file') => {
  const files = (req as any).files;
  if (!files || !files[field]) return null;
  return Array.isArray(files[field]) ? files[field][0] : files[field];
};

/**
 * Central authorisation gate for anything addressed by a user id.
 *
 * An employee may only ever act on their own record; passing another user's id
 * is rejected with 403 rather than silently falling back to self, so an IDOR
 * attempt fails loudly instead of leaking that the id exists.
 */
const assertCanAccessUser = (req: AuthedRequest, targetUserId: string) => {
  const actor = req.user!;
  if (actor.role === 'ADMIN') return;
  if (actor.id !== targetUserId) {
    throw ApiError.forbidden('You can only access your own profile');
  }
};

/** Ownership gate for a document, resolved from the document's own owner. */
const assertCanAccessDocument = async (req: AuthedRequest, documentId: string) => {
  const doc = await profileServices.getDocumentRaw(documentId);
  if (!doc) throw ApiError.notFound('Document not found');
  assertCanAccessUser(req, doc.userId);
  return doc;
};

// ── Profile ────────────────────────────────────────────────────────────────

export const getMyProfile = catchAsync(async (req: AuthedRequest, res: Response) => {
  const result = await profileServices.getProfile(req.user!.id);
  ServerResponse(res, true, 200, 'Profile retrieved successfully', result);
});

export const updateMyProfile = catchAsync(async (req: AuthedRequest, res: Response) => {
  const result = await profileServices.updateMyProfile(req.user!.id, req.body);
  ServerResponse(res, true, 200, 'Profile updated successfully', result);
});

export const getEmployeeProfile = catchAsync(async (req: AuthedRequest, res: Response) => {
  const targetUserId = String(req.params.id);
  assertCanAccessUser(req, targetUserId);
  const result = await profileServices.getProfile(targetUserId);
  ServerResponse(res, true, 200, 'Employee profile retrieved successfully', result);
});

export const adminUpdateEmployeeProfile = catchAsync(async (req: AuthedRequest, res: Response) => {
  const result = await profileServices.adminUpdateProfile(String(req.params.id), req.body);
  ServerResponse(res, true, 200, 'Employee profile updated successfully', result);
});

// ── Avatar ─────────────────────────────────────────────────────────────────

export const uploadMyAvatar = catchAsync(async (req: AuthedRequest, res: Response) => {
  const file = getUploadedFile(req);
  if (!file) throw ApiError.badRequest('No image was received. Attach it in the "file" field.');

  const result = await profileServices.updateAvatar(req.user!.id, file);
  ServerResponse(res, true, 200, 'Profile photo updated successfully', result);
});

export const removeMyAvatar = catchAsync(async (req: AuthedRequest, res: Response) => {
  const result = await profileServices.removeAvatar(req.user!.id);
  ServerResponse(res, true, 200, 'Profile photo removed successfully', result);
});

// ── Documents ──────────────────────────────────────────────────────────────

export const listMyDocuments = catchAsync(async (req: AuthedRequest, res: Response) => {
  const result = await profileServices.listDocuments(req.user!.id, readQuery(req));
  ServerResponse(res, true, 200, 'Documents retrieved successfully', result);
});

export const uploadMyDocument = catchAsync(async (req: AuthedRequest, res: Response) => {
  const file = getUploadedFile(req);
  if (!file) throw ApiError.badRequest('No document was received. Attach it in the "file" field.');

  const result = await profileServices.uploadDocument(req.user!.id, req.body, file);
  ServerResponse(res, true, 201, 'Document uploaded successfully', result);
});

export const updateMyDocument = catchAsync(async (req: AuthedRequest, res: Response) => {
  const id = String(req.params.id);
  await assertCanAccessDocument(req, id);

  const file = getUploadedFile(req);
  const data = { ...req.body };

  // Only an admin may mark a document verified.
  if (req.user!.role !== 'ADMIN') delete data.isVerified;

  const result = await profileServices.updateDocument(id, data, file ?? undefined);
  ServerResponse(res, true, 200, 'Document updated successfully', result);
});

export const deleteMyDocument = catchAsync(async (req: AuthedRequest, res: Response) => {
  const id = String(req.params.id);
  await assertCanAccessDocument(req, id);

  const result = await profileServices.deleteDocument(id);
  ServerResponse(res, true, 200, 'Document deleted successfully', result);
});

/**
 * Streams a document's bytes to an authorised caller.
 *
 * `?download=1` forces a save dialog; otherwise the file renders inline so the
 * UI can preview images and PDFs. Either way the response is marked
 * non-cacheable and nosniff, and never redirects to a public asset URL.
 */
export const downloadDocumentFile = catchAsync(async (req: AuthedRequest, res: Response) => {
  const id = String(req.params.id);
  await assertCanAccessDocument(req, id);

  const { buffer, mimeType, fileName } = await profileServices.readDocumentFile(id);
  const mode = req.query.download ? 'attachment' : 'inline';

  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Length', String(buffer.length));
  res.setHeader('Content-Disposition', contentDisposition(mode, fileName));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; object-src 'none'");
  res.send(buffer);
});

// ── Admin: another employee's documents ────────────────────────────────────

export const listEmployeeDocuments = catchAsync(async (req: AuthedRequest, res: Response) => {
  const targetUserId = String(req.params.id);
  assertCanAccessUser(req, targetUserId);
  const result = await profileServices.listDocuments(targetUserId, readQuery(req));
  ServerResponse(res, true, 200, 'Employee documents retrieved successfully', result);
});

// ── Organisation ───────────────────────────────────────────────────────────

export const getOrganization = catchAsync(async (_req: AuthedRequest, res: Response) => {
  const result = await profileServices.getOrganization();
  ServerResponse(res, true, 200, 'Organization profile retrieved successfully', result);
});

export const updateOrganization = catchAsync(async (req: AuthedRequest, res: Response) => {
  const result = await profileServices.updateOrganization(req.body, req.user!.id);
  ServerResponse(res, true, 200, 'Organization profile updated successfully', result);
});

export const uploadOrganizationLogo = catchAsync(async (req: AuthedRequest, res: Response) => {
  const file = getUploadedFile(req);
  if (!file) throw ApiError.badRequest('No logo was received. Attach it in the "file" field.');

  const result = await profileServices.updateOrganizationLogo(file, req.user!.id);
  ServerResponse(res, true, 200, 'Organization logo updated successfully', result);
});
