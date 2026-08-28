import { v2 as cloudinary } from 'cloudinary';
import config from '../../config/config';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export interface UploadResult {
  imageUrl: string;
  imageStorageId: string;
}

export interface IStorageProvider {
  uploadFile(file: any): Promise<UploadResult>;
  deleteFile(imageStorageId: string): Promise<void>;
}

// ────────────────────────────────────────────────
// On the shape of a stored URL
// ────────────────────────────────────────────────
// The local lane returns a *host-relative* path (`/uploads/<file>`), never an
// absolute one. Baking the host in at write time is what put rows reading
// `http://localhost:5000/uploads/...` into a shared database: every other
// environment then resolved them against the viewer's own machine, and no
// amount of fixing BASE_URL afterwards could repair data already written.
// The client resolves a relative path against whichever API it is talking to.
//
// Cloudinary is the exception, and deliberately: its `secure_url` is a
// permanent absolute CDN address that does not depend on where this server
// runs, so storing it whole is correct.

// ────────────────────────────────────────────────
// Local Directory Storage Provider
// ────────────────────────────────────────────────
class LocalStorageProvider implements IStorageProvider {
  private uploadDir: string;

  constructor() {
    // Relative to dist/utils/storage/storage.service.js or src/utils/storage/storage.service.ts
    // We target backend/public/uploads
    this.uploadDir = path.resolve(__dirname, '..', '..', '..', 'public', 'uploads');
    
    // Ensure upload directory exists
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  async uploadFile(file: any): Promise<UploadResult> {
    const ext = path.extname(file.name);
    const uniqueId = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const filename = `${uniqueId}${ext}`;
    const dest = path.join(this.uploadDir, filename);

    // Write file buffer to public/uploads
    await fs.promises.writeFile(dest, file.data);

    return {
      imageUrl: `/uploads/${filename}`,
      imageStorageId: filename,
    };
  }

  async deleteFile(imageStorageId: string): Promise<void> {
    const filePath = path.join(this.uploadDir, imageStorageId);
    try {
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
      }
    } catch (error) {
      console.error(`Failed to delete local file ${imageStorageId}:`, error);
    }
  }
}

/**
 * Builds a collision-proof asset name that still hints at the original file.
 *
 * The readable half is only a courtesy for browsing the media library; the
 * random half is what guarantees two uploads can never address one asset.
 */
function uniquePublicId(originalName?: string): string {
  const base = path
    .basename(String(originalName ?? ''), path.extname(String(originalName ?? '')))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  return base ? `${base}-${suffix}` : suffix;
}

// ────────────────────────────────────────────────
// Cloudinary Storage Provider
// ────────────────────────────────────────────────
class CloudinaryStorageProvider implements IStorageProvider {
  constructor() {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
  }

  async uploadFile(file: any): Promise<UploadResult> {
    return new Promise((resolve, reject) => {
      // If it's explicitly an image, use image, otherwise use raw
      const isImage = file.mimetype?.startsWith('image/');
      const resourceType = isImage ? 'image' : 'raw';

      const stream = cloudinary.uploader.upload_stream(
        {
          folder: 'inventory_products',
          resource_type: resourceType,
          // An explicit `public_id` overrides `unique_filename`, so passing the
          // client's filename made the asset name the filename verbatim: two
          // products uploading `photo.png` landed on one public id and the
          // second silently replaced the first, leaving both rows pointing at
          // the same picture. The id is server-generated for that reason, and
          // carries no extension — passing one produced `photo.png.png`.
          public_id: uniquePublicId(file.name),
          use_filename: false,
          unique_filename: false,
          overwrite: false,
        },
        (error, result) => {
          if (error) {
            return reject(new Error(`Cloudinary upload failed: ${error.message}`));
          }
          if (!result) {
            return reject(new Error('Cloudinary upload returned empty result'));
          }
          resolve({
            imageUrl: result.secure_url,
            imageStorageId: result.public_id,
          });
        }
      );
      stream.end(file.data);
    });
  }

  async deleteFile(imageStorageId: string): Promise<void> {
    // Server-generated ids carry no extension, so the resource type can no
    // longer be inferred from the name. Try the likely one, then the other:
    // `destroy` on a type that does not hold the asset reports "not found"
    // rather than failing, so the fallback costs one call in the rare case.
    for (const resourceType of ['image', 'raw'] as const) {
      const result = await cloudinary.uploader
        .destroy(imageStorageId, { resource_type: resourceType })
        .catch((error: unknown) => {
          console.error(`Failed to delete Cloudinary asset ${imageStorageId}:`, error);
          return null;
        });
      if (result?.result === 'ok') return;
    }
    // Nothing to remove is not a failure: the caller is cleaning up after a
    // replacement, and a missing old asset means the job is already done.
  }
}

// ────────────────────────────────────────────────
// Dynamic Factory Selection
// ────────────────────────────────────────────────
// Credentials are validated in `config.ts`, which refuses to boot when
// `cloudinary` is selected without them — so reaching here means the chosen
// lane is usable.
export const storageProvider: IStorageProvider =
  config.STORAGE_PROVIDER === 'cloudinary'
    ? new CloudinaryStorageProvider()
    : new LocalStorageProvider();

// Which lane is live is the single most useful thing to know when an image
// will not load, and the least obvious from the outside.
console.log(
  config.STORAGE_PROVIDER === 'cloudinary'
    ? `🖼️  Media storage: Cloudinary (cloud: ${config.CLOUDINARY_CLOUD_NAME})`
    : '🖼️  Media storage: local disk — files are lost on restart on ephemeral hosts such as Render',
);

// ────────────────────────────────────────────────
// Private storage lane (legal documents)
// ────────────────────────────────────────────────
//
// Legal documents must never be reachable without authentication. The public
// lane above writes into `public/uploads`, which `app.ts` serves statically —
// fine for product images and avatars, wrong for identity documents.
//
// This lane is the *same* storage abstraction, pointed at a directory outside
// the static root. Files are addressed by an opaque storage id only; there is
// no URL for them, and the sole way to read one back is the authenticated
// document endpoint, which re-checks ownership on every request.

export interface PrivateUploadResult {
  storageId: string;
  size: number;
  mimeType: string;
  originalFileName: string;
}

const PRIVATE_DIR = path.resolve(__dirname, '..', '..', '..', 'storage', 'private');

const ensurePrivateDir = () => {
  if (!fs.existsSync(PRIVATE_DIR)) {
    fs.mkdirSync(PRIVATE_DIR, { recursive: true });
  }
};

/**
 * Resolves a storage id to an absolute path, refusing anything that escapes
 * the private directory. Storage ids are server-generated, but this is the
 * backstop that makes traversal impossible even if one is ever attacker-influenced.
 */
export const resolvePrivatePath = (storageId: string): string => {
  // A valid id is a bare filename — no separators, no traversal segments.
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/.test(storageId)) {
    throw new Error('Invalid storage identifier');
  }
  const resolved = path.resolve(PRIVATE_DIR, storageId);
  if (path.dirname(resolved) !== PRIVATE_DIR) {
    throw new Error('Invalid storage identifier');
  }
  return resolved;
};

/**
 * Marks a storage id as living in Cloudinary rather than on this disk.
 * Format: `cld:<resource_type>:<public_id>`.
 *
 * Read and delete dispatch on the id itself rather than on current config, so
 * a deployment that switches lanes can still serve documents stored under the
 * old one. Only uploads follow the configured provider.
 */
const CLOUD_ID_PREFIX = 'cld:';

function parseCloudId(storageId: string): { resourceType: 'raw' | 'image'; publicId: string } | null {
  if (!storageId.startsWith(CLOUD_ID_PREFIX)) return null;
  const rest = storageId.slice(CLOUD_ID_PREFIX.length);
  const separator = rest.indexOf(':');
  if (separator < 0) return null;
  const resourceType = rest.slice(0, separator);
  const publicId = rest.slice(separator + 1);
  if ((resourceType !== 'raw' && resourceType !== 'image') || !publicId) return null;
  return { resourceType, publicId };
}

/**
 * Uploads a document to Cloudinary as an *authenticated* asset.
 *
 * `type: 'authenticated'` is what keeps the security model intact: the asset
 * has no publicly reachable URL, and delivery requires a signature generated
 * from the API secret. The signed URL is built server-side, used immediately
 * to pull the bytes, and never handed to a client — so the document endpoint,
 * which re-checks ownership on every request, remains the only way in.
 */
function uploadPrivateToCloudinary(file: any): Promise<{ storageId: string }> {
  return new Promise((resolve, reject) => {
    const resourceType: 'raw' | 'image' = file.mimetype?.startsWith('image/') ? 'image' : 'raw';
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: 'employee_documents',
        resource_type: resourceType,
        type: 'authenticated',
        // Server-generated, exactly as on the local lane: a client filename
        // must never determine where a document is addressed.
        public_id: crypto.randomUUID(),
        use_filename: false,
        unique_filename: false,
        overwrite: false,
      },
      (error, result) => {
        if (error) return reject(new Error(`Document upload failed: ${error.message}`));
        if (!result) return reject(new Error('Document upload returned empty result'));
        resolve({ storageId: `${CLOUD_ID_PREFIX}${resourceType}:${result.public_id}` });
      },
    );
    stream.end(file.data);
  });
}

export const privateStorage = {
  /**
   * Persists a validated upload under a server-generated name. The client
   * filename is recorded as metadata only and never used to build a path.
   */
  async uploadFile(file: any, extension: string): Promise<PrivateUploadResult> {
    const common = {
      size: file.size ?? file.data?.length ?? 0,
      mimeType: file.mimetype,
      originalFileName: typeof file.name === 'string' ? path.basename(file.name) : 'upload',
    };

    if (config.STORAGE_PROVIDER === 'cloudinary') {
      const { storageId } = await uploadPrivateToCloudinary(file);
      return { storageId, ...common };
    }

    ensurePrivateDir();

    const safeExt = extension.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
    const storageId = `${crypto.randomUUID()}.${safeExt}`;
    const dest = resolvePrivatePath(storageId);

    await fs.promises.writeFile(dest, file.data, { mode: 0o600 });

    return { storageId, ...common };
  },

  /** Reads a private file back for streaming to an authorised caller. */
  async readFile(storageId: string): Promise<Buffer> {
    const cloud = parseCloudId(storageId);
    if (cloud) {
      const signedUrl = cloudinary.url(cloud.publicId, {
        resource_type: cloud.resourceType,
        type: 'authenticated',
        sign_url: true,
        secure: true,
      });
      const response = await fetch(signedUrl);
      if (!response.ok) {
        throw new Error(`Stored file is missing (${response.status})`);
      }
      return Buffer.from(await response.arrayBuffer());
    }

    const filePath = resolvePrivatePath(storageId);
    if (!fs.existsSync(filePath)) {
      throw new Error('Stored file is missing');
    }
    return fs.promises.readFile(filePath);
  },

  async deleteFile(storageId: string): Promise<void> {
    const cloud = parseCloudId(storageId);
    if (cloud) {
      await cloudinary.uploader
        .destroy(cloud.publicId, { resource_type: cloud.resourceType, type: 'authenticated' })
        .catch((error: unknown) => {
          console.error(`Failed to delete private asset ${storageId}:`, error);
        });
      return;
    }

    try {
      const filePath = resolvePrivatePath(storageId);
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
      }
    } catch (error) {
      console.error(`Failed to delete private file ${storageId}:`, error);
    }
  },

  async exists(storageId: string): Promise<boolean> {
    const cloud = parseCloudId(storageId);
    if (cloud) {
      return cloudinary.api
        .resource(cloud.publicId, { resource_type: cloud.resourceType, type: 'authenticated' })
        .then(() => true)
        .catch(() => false);
    }
    try {
      return fs.existsSync(resolvePrivatePath(storageId));
    } catch {
      return false;
    }
  },
};
