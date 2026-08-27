import { put, del } from '@vercel/blob';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { config } from '../config.js';

export const blobService = {
  /**
   * Check if Vercel Blob is configured with an active token
   */
  isBlobConfigured() {
    return Boolean(process.env.BLOB_READ_WRITE_TOKEN || config.blob?.token);
  },

  /**
   * Upload a file buffer to Vercel Blob with seamless local fallback
   * @param {string} originalFilename
   * @param {Buffer} buffer
   * @param {Object} options
   * @param {string} [options.folder='uploads'] - Subfolder/prefix in storage (e.g. 'branding', 'proofs')
   * @param {string} [options.contentType='application/octet-stream'] - MIME type
   * @param {'public'} [options.access='public'] - Storage access level
   * @returns {Promise<{ url: string, pathname: string, provider: 'vercel-blob' | 'local' }>}
   */
  async upload(originalFilename, buffer, options = {}) {
    const {
      folder = 'uploads',
      contentType = 'application/octet-stream',
      access = 'public'
    } = options;

    const ext = path.extname(originalFilename || '').toLowerCase() || '.png';
    const randomSuffix = crypto.randomBytes(6).toString('hex');
    const baseName = path.basename(originalFilename || 'file', ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `${baseName}-${Date.now()}-${randomSuffix}${ext}`;
    const pathname = `${folder}/${filename}`;

    const token = process.env.BLOB_READ_WRITE_TOKEN || config.blob?.token;

    if (token) {
      try {
        console.log(`[BlobService] ☁️ Uploading to Vercel Blob: ${pathname} (${buffer.length} bytes)...`);
        const blob = await put(pathname, buffer, {
          access,
          contentType,
          token,
          addRandomSuffix: false
        });
        console.log(`[BlobService] ✅ Uploaded to Vercel Blob: ${blob.url}`);
        return {
          url: blob.url,
          pathname: blob.pathname || pathname,
          provider: 'vercel-blob'
        };
      } catch (err) {
        console.error(`[BlobService] ❌ Vercel Blob upload failed: ${err.message}. Falling back to local storage...`);
        // Fallback to local storage
      }
    }

    // Local Disk Fallback (for development / offline environments)
    const localDir = path.resolve(process.cwd(), 'uploads', folder);
    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(localDir, { recursive: true });
    }
    const localFilePath = path.join(localDir, filename);
    fs.writeFileSync(localFilePath, buffer);
    const localUrl = `/uploads/${folder}/${filename}`;
    console.log(`[BlobService] 💾 Stored in local disk storage: ${localUrl}`);

    return {
      url: localUrl,
      pathname,
      provider: 'local'
    };
  },

  /**
   * Delete a file from Vercel Blob or local disk storage
   * @param {string} urlOrPath
   */
  async delete(urlOrPath) {
    if (!urlOrPath) return false;
    const token = process.env.BLOB_READ_WRITE_TOKEN || config.blob?.token;

    if (urlOrPath.startsWith('http://') || urlOrPath.startsWith('https://')) {
      if (token && urlOrPath.includes('blob.vercel-storage.com')) {
        try {
          await del(urlOrPath, { token });
          console.log(`[BlobService] 🗑️ Deleted from Vercel Blob: ${urlOrPath}`);
          return true;
        } catch (err) {
          console.warn(`[BlobService] ⚠️ Failed to delete from Vercel Blob: ${err.message}`);
          return false;
        }
      }
    } else if (urlOrPath.startsWith('/uploads/')) {
      try {
        const localPath = path.resolve(process.cwd(), urlOrPath.replace(/^\//, ''));
        if (fs.existsSync(localPath)) {
          fs.unlinkSync(localPath);
          console.log(`[BlobService] 🗑️ Deleted local file: ${localPath}`);
          return true;
        }
      } catch (err) {
        console.warn(`[BlobService] ⚠️ Failed to delete local file: ${err.message}`);
        return false;
      }
    }
    return false;
  }
};
