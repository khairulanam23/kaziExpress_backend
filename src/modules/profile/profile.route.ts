import { Router } from 'express';
import {
  getMyProfile,
  updateMyProfile,
  uploadMyAvatar,
  removeMyAvatar,
  listMyDocuments,
  uploadMyDocument,
  updateMyDocument,
  deleteMyDocument,
  downloadDocumentFile,
  getEmployeeProfile,
  adminUpdateEmployeeProfile,
  listEmployeeDocuments,
  getOrganization,
  updateOrganization,
  uploadOrganizationLogo,
} from './profile.controller';
import {
  validateUpdateMyProfile,
  validateAdminUpdateProfile,
  validateCreateDocument,
  validateUpdateDocument,
  validateDocumentQuery,
  validateUpdateOrganization,
} from './profile.validation';
import { validateId } from '../../handlers/common-zod-validator';
import isAuthorized from '../../middlewares/is-authorized';
import { checkRoles } from '../../middlewares/check-roles';

const router = Router();

// Every profile and document route requires a valid session.
router.use(isAuthorized);

// ── Organisation (declared first so /organization is never read as an id) ──

/** @route GET /api/v1/profile/organization — any signed-in user (PDF letterhead) */
router.get('/organization', getOrganization);

/** @route PUT /api/v1/profile/organization — Admin only */
router.put('/organization', checkRoles('ADMIN'), validateUpdateOrganization, updateOrganization);

/** @route POST /api/v1/profile/organization/logo — Admin only (multipart "file") */
router.post('/organization/logo', checkRoles('ADMIN'), uploadOrganizationLogo);

// ── Own profile ────────────────────────────────────────────────────────────

/** @route GET /api/v1/profile/me */
router.get('/me', getMyProfile);

/** @route PUT /api/v1/profile/me — self-editable fields only */
router.put('/me', validateUpdateMyProfile, updateMyProfile);

/** @route POST /api/v1/profile/me/avatar — multipart "file" */
router.post('/me/avatar', uploadMyAvatar);

/** @route DELETE /api/v1/profile/me/avatar */
router.delete('/me/avatar', removeMyAvatar);

// ── Own documents ──────────────────────────────────────────────────────────

/** @route GET /api/v1/profile/me/documents */
router.get('/me/documents', validateDocumentQuery, listMyDocuments);

/** @route POST /api/v1/profile/me/documents — multipart "file" + metadata */
router.post('/me/documents', validateCreateDocument, uploadMyDocument);

/** @route GET /api/v1/profile/me/documents/:id/file — authenticated stream */
router.get('/me/documents/:id/file', validateId, downloadDocumentFile);

/** @route PUT /api/v1/profile/me/documents/:id — metadata and/or file replacement */
router.put('/me/documents/:id', validateId, validateUpdateDocument, updateMyDocument);

/** @route DELETE /api/v1/profile/me/documents/:id */
router.delete('/me/documents/:id', validateId, deleteMyDocument);

// ── Another employee (ownership re-checked in the controller) ──────────────

/** @route GET /api/v1/profile/employees/:id */
router.get('/employees/:id', validateId, getEmployeeProfile);

/** @route PATCH /api/v1/profile/employees/:id — Admin only: department & designation */
router.patch('/employees/:id', checkRoles('ADMIN'), validateId, validateAdminUpdateProfile, adminUpdateEmployeeProfile);

/** @route GET /api/v1/profile/employees/:id/documents */
router.get('/employees/:id/documents', validateId, validateDocumentQuery, listEmployeeDocuments);

/** @route GET /api/v1/profile/employees/:id/documents/:documentId/file — authenticated stream */
router.get('/employees/:id/documents/:documentId/file', (req, _res, next) => {
  // Reuse the single document handler, which resolves ownership from the row itself.
  req.params.id = req.params.documentId as string;
  next();
}, downloadDocumentFile);

module.exports = router;
