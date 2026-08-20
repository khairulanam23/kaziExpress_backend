import prisma from '../../utils/prisma/prisma-client';
import ApiError from '../../utils/errors/api-error';
import { storageProvider, privateStorage } from '../../utils/storage/storage.service';
import {
  DOCUMENT_TYPES,
  IMAGE_TYPES,
  MAX_DOCUMENT_BYTES,
  MAX_IMAGE_BYTES,
  validateUpload,
} from '../../utils/files/file-validation.util';
import type {
  AdminUpdateProfileInput,
  CreateDocumentInput,
  DocumentQueryInput,
  UpdateDocumentInput,
  UpdateMyProfileInput,
  UpdateOrganizationInput,
} from './profile.validation';

/** Never leak credentials or storage internals to a client. */
const PROFILE_SELECT = {
  id: true,
  email: true,
  role: true,
  name: true,
  phone: true,
  address: true,
  isActive: true,
  avatarUrl: true,
  dateOfBirth: true,
  nidNumber: true,
  emergencyContactName: true,
  emergencyContactPhone: true,
  emergencyContactRelationship: true,
  createdAt: true,
  lastLogin: true,
  employeeProfile: {
    select: {
      id: true,
      department: true,
      designation: true,
      joinDate: true,
      hourlyRate: true,
      dailyRate: true,
      payCalculationMode: true,
      overtimeMultiplier: true,
    },
  },
} as const;

/**
 * Document rows are returned without `fileStorageId` or `fileUrl` — the client
 * addresses a document by its own id and streams the bytes through the
 * authenticated endpoint, so storage layout never reaches the browser.
 */
const DOCUMENT_SELECT = {
  id: true,
  userId: true,
  name: true,
  documentType: true,
  category: true,
  originalFileName: true,
  mimeType: true,
  fileSize: true,
  expiryDate: true,
  isVerified: true,
  notes: true,
  uploadedAt: true,
  updatedAt: true,
} as const;

const getProfile = async (userId: string) => {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: PROFILE_SELECT });
  if (!user) throw ApiError.notFound('Profile not found');
  return user;
};

/** Self-service update. Organisation-controlled fields are not accepted here. */
const updateMyProfile = async (userId: string, data: UpdateMyProfileInput) => {
  const payload: Record<string, unknown> = {};
  for (const key of [
    'name',
    'phone',
    'address',
    'dateOfBirth',
    'nidNumber',
    'emergencyContactName',
    'emergencyContactPhone',
    'emergencyContactRelationship',
  ] as const) {
    if (data[key] !== undefined) payload[key] = data[key];
  }

  await prisma.user.update({ where: { id: userId }, data: payload });
  return getProfile(userId);
};

/** Admin edits the organisation-controlled half of someone's profile. */
const adminUpdateProfile = async (targetUserId: string, data: AdminUpdateProfileInput) => {
  const profile = await prisma.employeeProfile.findUnique({ where: { userId: targetUserId } });
  if (!profile) throw ApiError.notFound('This user has no employee profile to update');

  await prisma.employeeProfile.update({
    where: { userId: targetUserId },
    data: {
      ...(data.department !== undefined && { department: data.department }),
      ...(data.designation !== undefined && { designation: data.designation }),
    },
  });

  return getProfile(targetUserId);
};

/**
 * Profile photos are public assets (they render in avatars across the app), so
 * they use the existing public storage lane rather than the private one.
 */
const updateAvatar = async (userId: string, file: any) => {
  validateUpload(file, { allowed: IMAGE_TYPES, maxBytes: MAX_IMAGE_BYTES, label: 'image' });

  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { avatarStorageId: true },
  });

  const { imageUrl, imageStorageId } = await storageProvider.uploadFile(file);

  await prisma.user.update({
    where: { id: userId },
    data: { avatarUrl: imageUrl, avatarStorageId: imageStorageId },
  });

  // Replace, don't accumulate — drop the previous file once the new one is live.
  if (existing?.avatarStorageId) {
    await storageProvider.deleteFile(existing.avatarStorageId).catch(() => undefined);
  }

  return getProfile(userId);
};

const removeAvatar = async (userId: string) => {
  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { avatarStorageId: true },
  });

  await prisma.user.update({
    where: { id: userId },
    data: { avatarUrl: null, avatarStorageId: null },
  });

  if (existing?.avatarStorageId) {
    await storageProvider.deleteFile(existing.avatarStorageId).catch(() => undefined);
  }

  return getProfile(userId);
};

// ───────────────────────────────────────────────────────────────────────────
// Legal documents
// ───────────────────────────────────────────────────────────────────────────

const listDocuments = async (userId: string, query: DocumentQueryInput) => {
  return prisma.employeeDocument.findMany({
    where: {
      userId,
      ...(query?.documentType && { documentType: query.documentType }),
      ...(query?.category && { category: query.category }),
    },
    select: DOCUMENT_SELECT,
    orderBy: { uploadedAt: 'desc' },
  });
};

const uploadDocument = async (userId: string, data: CreateDocumentInput, file: any) => {
  const validated = validateUpload(file, {
    allowed: DOCUMENT_TYPES,
    maxBytes: MAX_DOCUMENT_BYTES,
    label: 'document',
  });

  const stored = await privateStorage.uploadFile(file, validated.extension);

  return prisma.employeeDocument.create({
    data: {
      userId,
      name: data.name,
      documentType: data.documentType,
      category: data.category ?? 'PERSONAL',
      fileStorageId: stored.storageId,
      isPrivate: true,
      originalFileName: validated.originalFileName,
      mimeType: validated.mimeType,
      fileSize: validated.size,
      expiryDate: data.expiryDate ?? null,
      notes: data.notes ?? null,
    },
    select: DOCUMENT_SELECT,
  });
};

/** Raw row including storage internals — for internal authorisation checks only. */
const getDocumentRaw = async (id: string) => {
  return prisma.employeeDocument.findUnique({ where: { id } });
};

/**
 * Updates metadata and, when a file is supplied, replaces the stored bytes.
 * The old file is removed only after the new one is safely written.
 */
const updateDocument = async (id: string, data: UpdateDocumentInput, file?: any) => {
  const existing = await getDocumentRaw(id);
  if (!existing) throw ApiError.notFound('Document not found');

  const payload: Record<string, unknown> = {
    ...(data.name !== undefined && { name: data.name }),
    ...(data.documentType !== undefined && { documentType: data.documentType }),
    ...(data.category !== undefined && { category: data.category }),
    ...(data.expiryDate !== undefined && { expiryDate: data.expiryDate }),
    ...(data.notes !== undefined && { notes: data.notes }),
    ...(data.isVerified !== undefined && { isVerified: data.isVerified }),
  };

  let replacedStorageId: string | null = null;

  if (file) {
    const validated = validateUpload(file, {
      allowed: DOCUMENT_TYPES,
      maxBytes: MAX_DOCUMENT_BYTES,
      label: 'document',
    });
    const stored = await privateStorage.uploadFile(file, validated.extension);

    payload.fileStorageId = stored.storageId;
    payload.isPrivate = true;
    payload.fileUrl = null;
    payload.originalFileName = validated.originalFileName;
    payload.mimeType = validated.mimeType;
    payload.fileSize = validated.size;

    if (existing.isPrivate) replacedStorageId = existing.fileStorageId;
  }

  const updated = await prisma.employeeDocument.update({
    where: { id },
    data: payload,
    select: DOCUMENT_SELECT,
  });

  if (replacedStorageId) {
    await privateStorage.deleteFile(replacedStorageId).catch(() => undefined);
  }

  return updated;
};

const deleteDocument = async (id: string) => {
  const existing = await getDocumentRaw(id);
  if (!existing) throw ApiError.notFound('Document not found');

  await prisma.employeeDocument.delete({ where: { id } });

  if (existing.isPrivate) {
    await privateStorage.deleteFile(existing.fileStorageId).catch(() => undefined);
  } else {
    await storageProvider.deleteFile(existing.fileStorageId).catch(() => undefined);
  }

  return { id };
};

/** Loads the bytes for an authorised caller. Ownership is checked by the controller. */
const readDocumentFile = async (id: string) => {
  const doc = await getDocumentRaw(id);
  if (!doc) throw ApiError.notFound('Document not found');

  if (!doc.isPrivate) {
    // Legacy row written before private storage existed.
    throw ApiError.notFound('This document predates secure storage and must be re-uploaded');
  }

  if (!privateStorage.exists(doc.fileStorageId)) {
    throw ApiError.notFound('The stored file for this document is missing');
  }

  const buffer = await privateStorage.readFile(doc.fileStorageId);

  return {
    buffer,
    mimeType: doc.mimeType ?? 'application/octet-stream',
    fileName: doc.originalFileName ?? `${doc.name}`,
  };
};

// ───────────────────────────────────────────────────────────────────────────
// Organisation profile (single row)
// ───────────────────────────────────────────────────────────────────────────

const DEFAULT_ORG_NAME = 'Inventory Management System';

/** Reads the organisation row, creating the default one on first access. */
const getOrganization = async () => {
  const existing = await prisma.organizationProfile.findFirst();
  if (existing) return existing;
  return prisma.organizationProfile.create({ data: { name: DEFAULT_ORG_NAME } });
};

const updateOrganization = async (data: UpdateOrganizationInput, updatedById: string) => {
  const org = await getOrganization();
  return prisma.organizationProfile.update({
    where: { id: org.id },
    data: { ...data, updatedById },
  });
};

const updateOrganizationLogo = async (file: any, updatedById: string) => {
  validateUpload(file, { allowed: IMAGE_TYPES, maxBytes: MAX_IMAGE_BYTES, label: 'logo' });

  const org = await getOrganization();
  const { imageUrl, imageStorageId } = await storageProvider.uploadFile(file);

  const updated = await prisma.organizationProfile.update({
    where: { id: org.id },
    data: { logoUrl: imageUrl, logoStorageId: imageStorageId, updatedById },
  });

  if (org.logoStorageId) {
    await storageProvider.deleteFile(org.logoStorageId).catch(() => undefined);
  }

  return updated;
};

export const profileServices = {
  getProfile,
  updateMyProfile,
  adminUpdateProfile,
  updateAvatar,
  removeAvatar,
  listDocuments,
  uploadDocument,
  getDocumentRaw,
  updateDocument,
  deleteDocument,
  readDocumentFile,
  getOrganization,
  updateOrganization,
  updateOrganizationLogo,
};
