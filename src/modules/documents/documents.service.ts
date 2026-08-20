import { profileServices } from '../profile/profile.service';
import type { CreateDocumentInput, UpdateDocumentInput, DocumentListQueryInput } from './documents.validation';

/**
 * Legacy `/api/v1/documents` surface.
 *
 * These endpoints predate the profile module and are kept for backward
 * compatibility, but they no longer carry their own storage logic: every call
 * delegates to `profileServices`, which validates uploads and writes them to
 * the private lane. Previously this module wrote unvalidated files into
 * `public/uploads`, where identity documents were readable without a session.
 *
 * New clients should prefer `/api/v1/profile/me/documents`.
 */

const uploadDocument = async (userId: string, data: CreateDocumentInput, file: any) =>
  profileServices.uploadDocument(
    userId,
    {
      name: data.name,
      documentType: data.documentType,
      category: 'PERSONAL',
      expiryDate: data.expiryDate ?? null,
      notes: data.notes ?? null,
    },
    file,
  );

const listDocuments = async (userId: string, query: DocumentListQueryInput) =>
  profileServices.listDocuments(userId, { documentType: query?.documentType });

const listDocumentsForUser = async (targetUserId: string, query: DocumentListQueryInput) =>
  profileServices.listDocuments(targetUserId, { documentType: query?.documentType });

const getDocumentById = async (id: string) => profileServices.getDocumentRaw(id);

const updateDocument = async (id: string, data: UpdateDocumentInput) =>
  profileServices.updateDocument(id, {
    notes: data.notes ?? undefined,
    ...(data.name !== undefined && { name: data.name }),
    ...(data.documentType !== undefined && { documentType: data.documentType }),
    ...(data.expiryDate !== undefined && { expiryDate: data.expiryDate }),
    ...(data.isVerified !== undefined && { isVerified: data.isVerified }),
  });

const deleteDocument = async (id: string) => profileServices.deleteDocument(id);

export const documentServices = {
  uploadDocument,
  listDocuments,
  listDocumentsForUser,
  getDocumentById,
  updateDocument,
  deleteDocument,
};
