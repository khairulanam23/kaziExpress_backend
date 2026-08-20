import { z } from 'zod';
import { validateBody, validateQuery } from '../../handlers/zod-error-handler';

/** Document types the UI offers. Free-form on the model so new kinds need no migration. */
export const DOCUMENT_TYPES = [
  'NID',
  'PASSPORT',
  'OTHER_ID',
  'OTHER_LEGAL',
  'BUSINESS_REGISTRATION',
  'TRADE_LICENSE',
  'TAX_DOCUMENT',
] as const;

const optionalText = (max = 191) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v === '' ? null : v));

/**
 * Fields a user may change on their own profile.
 *
 * Deliberately excluded: email, role, isActive, hourly/daily rates, department
 * and designation. Those are organisation-controlled and stay admin-only, so
 * they are served read-only and rejected here even if posted.
 */
const zodUpdateMyProfileSchema = z
  .object({
    name: optionalText(120),
    phone: optionalText(40),
    address: optionalText(255),
    dateOfBirth: z.coerce.date().optional().nullable(),
    nidNumber: optionalText(60),
    emergencyContactName: optionalText(120),
    emergencyContactPhone: optionalText(40),
    emergencyContactRelationship: optionalText(60),
  })
  .strict();

export type UpdateMyProfileInput = z.infer<typeof zodUpdateMyProfileSchema>;

/** Admin-only fields on someone else's profile. */
const zodAdminUpdateProfileSchema = z
  .object({
    department: optionalText(120),
    designation: optionalText(120),
  })
  .strict();

export type AdminUpdateProfileInput = z.infer<typeof zodAdminUpdateProfileSchema>;

const zodCreateDocumentSchema = z
  .object({
    name: z.string({ message: 'A document name is required' }).trim().min(1).max(160),
    documentType: z.string({ message: 'A document type is required' }).trim().min(1).max(60),
    category: z.enum(['PERSONAL', 'BUSINESS']).optional().default('PERSONAL'),
    expiryDate: z.coerce.date().optional().nullable(),
    notes: optionalText(500),
  })
  .strict();

export type CreateDocumentInput = z.infer<typeof zodCreateDocumentSchema>;

const zodUpdateDocumentSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    documentType: z.string().trim().min(1).max(60).optional(),
    category: z.enum(['PERSONAL', 'BUSINESS']).optional(),
    expiryDate: z.coerce.date().optional().nullable(),
    notes: optionalText(500),
    isVerified: z.boolean().optional(),
  })
  .strict();

export type UpdateDocumentInput = z.infer<typeof zodUpdateDocumentSchema>;

const zodDocumentQuerySchema = z
  .object({
    documentType: z.string().optional(),
    category: z.enum(['PERSONAL', 'BUSINESS']).optional(),
  })
  .strict();

export type DocumentQueryInput = z.infer<typeof zodDocumentQuerySchema>;

const zodUpdateOrganizationSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    legalName: optionalText(160),
    registrationNumber: optionalText(80),
    taxId: optionalText(80),
    email: z.string().trim().email().optional().nullable().or(z.literal('').transform(() => null)),
    phone: optionalText(40),
    website: optionalText(160),
    addressLine: optionalText(255),
    city: optionalText(120),
    country: optionalText(120),
  })
  .strict();

export type UpdateOrganizationInput = z.infer<typeof zodUpdateOrganizationSchema>;

export const validateUpdateMyProfile = validateBody(zodUpdateMyProfileSchema);
export const validateAdminUpdateProfile = validateBody(zodAdminUpdateProfileSchema);
export const validateCreateDocument = validateBody(zodCreateDocumentSchema);
export const validateUpdateDocument = validateBody(zodUpdateDocumentSchema);
export const validateDocumentQuery = validateQuery(zodDocumentQuerySchema);
export const validateUpdateOrganization = validateBody(zodUpdateOrganizationSchema);
