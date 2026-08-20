import path from 'path';
import ApiError from '../errors/api-error';

/**
 * Upload validation for profile photos and legal documents.
 *
 * A client can set any `Content-Type` and any filename it likes, so neither is
 * trusted on its own. Every upload must agree on three independent signals:
 * the declared MIME type, the file extension, and the leading bytes of the
 * file itself. A mismatch is rejected rather than coerced.
 */

export interface AllowedType {
  mime: string;
  extensions: string[];
  /** Leading byte signatures; at least one must match. */
  magic: number[][];
}

const PDF: AllowedType = {
  mime: 'application/pdf',
  extensions: ['pdf'],
  magic: [[0x25, 0x50, 0x44, 0x46]], // %PDF
};

const JPEG: AllowedType = {
  mime: 'image/jpeg',
  extensions: ['jpg', 'jpeg'],
  magic: [[0xff, 0xd8, 0xff]],
};

const PNG: AllowedType = {
  mime: 'image/png',
  extensions: ['png'],
  magic: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
};

const WEBP: AllowedType = {
  mime: 'image/webp',
  // RIFF....WEBP — bytes 8-11 are checked separately below.
  extensions: ['webp'],
  magic: [[0x52, 0x49, 0x46, 0x46]],
};

/** Legal documents: PDF and the three required image formats. */
export const DOCUMENT_TYPES: AllowedType[] = [PDF, JPEG, PNG];

/** Profile photos and logos: images only — never a PDF. */
export const IMAGE_TYPES: AllowedType[] = [JPEG, PNG, WEBP];

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

const humanSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(0)} MB` : `${Math.round(bytes / 1024)} KB`;

const startsWith = (buffer: Buffer, signature: number[]) =>
  signature.every((byte, i) => buffer[i] === byte);

export interface ValidatedUpload {
  extension: string;
  mimeType: string;
  size: number;
  originalFileName: string;
}

export interface ValidateOptions {
  allowed: AllowedType[];
  maxBytes: number;
  /** Used in the error message, e.g. "document" or "image". */
  label?: string;
}

/**
 * Validates an `express-fileupload` file and returns the normalised metadata
 * to persist. Throws an `ApiError` with a message safe to show a user.
 */
export function validateUpload(file: any, options: ValidateOptions): ValidatedUpload {
  const { allowed, maxBytes, label = 'file' } = options;

  if (!file || !file.data || !Buffer.isBuffer(file.data)) {
    throw ApiError.badRequest(`No ${label} was received. Attach it in the "file" field.`);
  }

  const size: number = file.size ?? file.data.length;

  if (size <= 0) {
    throw ApiError.badRequest(`That ${label} is empty.`);
  }

  if (size > maxBytes) {
    throw ApiError.badRequest(
      `That ${label} is ${humanSize(size)}. The maximum accepted size is ${humanSize(maxBytes)}.`,
    );
  }

  const declaredMime = String(file.mimetype || '').toLowerCase().split(';')[0].trim();

  // The client filename is only ever read for its extension, and only after
  // `path.basename` strips any directory component a client may have injected.
  const safeName = path.basename(String(file.name || ''));
  const extension = path.extname(safeName).replace('.', '').toLowerCase();

  const readable = allowed.map((t) => t.extensions.join('/')).join(', ');

  const byMime = allowed.find((t) => t.mime === declaredMime);
  const byExtension = allowed.find((t) => t.extensions.includes(extension));

  if (!byMime || !byExtension) {
    throw ApiError.badRequest(`Unsupported ${label} format. Accepted formats: ${readable}.`);
  }

  // Declared type and extension must describe the same format — a PDF renamed
  // to .png (or the reverse) is rejected rather than silently stored.
  if (byMime.mime !== byExtension.mime) {
    throw ApiError.badRequest(
      `That ${label}'s extension (.${extension}) doesn't match its type (${declaredMime}).`,
    );
  }

  // Finally, the bytes themselves must match the claimed format.
  const magicMatches = byMime.magic.some((signature) => startsWith(file.data, signature));
  const webpConfirmed =
    byMime.mime !== 'image/webp' ||
    file.data.slice(8, 12).toString('ascii') === 'WEBP';

  if (!magicMatches || !webpConfirmed) {
    throw ApiError.badRequest(`That ${label} doesn't appear to be a valid ${byMime.mime.split('/')[1].toUpperCase()}.`);
  }

  return {
    extension: byExtension.extensions[0] === 'jpg' && extension === 'jpeg' ? 'jpeg' : extension,
    mimeType: byMime.mime,
    size,
    originalFileName: safeName || `upload.${extension}`,
  };
}

/** Content-Disposition value that is safe for any original filename. */
export function contentDisposition(mode: 'inline' | 'attachment', filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${mode}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
