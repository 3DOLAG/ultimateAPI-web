import { put, del, list } from '@vercel/blob';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { config } from '../config.js';

// In-memory cache for settings to avoid repeated blob fetches within the same cold start
let _settingsCache = null;
let _settingsCacheTime = 0;
const SETTINGS_CACHE_TTL = 15000; // 15 seconds

export const blobService = {
  /**
   * Check if Vercel Blob is configured with an active token
   */
  isBlobConfigured() {
    return Boolean(process.env.BLOB_READ_WRITE_TOKEN || config.blob?.token);
  },

  /**
   * Save store settings as a JSON blob for persistent storage on Vercel
   */
  async saveSettings(settingsObj) {
    const token = process.env.BLOB_READ_WRITE_TOKEN || config.blob?.token;
    if (!token) return null;

    try {
      const blob = await put('settings/store-settings.json', JSON.stringify(settingsObj, null, 2), {
        access: 'public',
        contentType: 'application/json',
        token,
        addRandomSuffix: false
      });
      // Update cache
      _settingsCache = settingsObj;
      _settingsCacheTime = Date.now();
      console.log('[BlobService] ✅ Settings saved to Vercel Blob');
      return blob;
    } catch (err) {
      console.error('[BlobService] ❌ Failed to save settings to blob:', err.message);
      return null;
    }
  },

  /**
   * Load store settings from Vercel Blob
   */
  async loadSettings() {
    const token = process.env.BLOB_READ_WRITE_TOKEN || config.blob?.token;
    if (!token) return null;

    // Return cached if fresh
    if (_settingsCache && (Date.now() - _settingsCacheTime) < SETTINGS_CACHE_TTL) {
      return _settingsCache;
    }

    try {
      const { blobs } = await list({ prefix: 'settings/store-settings', token });
      if (blobs.length > 0) {
        const res = await fetch(blobs[0].url);
        if (res.ok) {
          const data = await res.json();
          _settingsCache = data;
          _settingsCacheTime = Date.now();
          return data;
        }
      }
    } catch (err) {
      console.warn('[BlobService] ⚠️ Failed to load settings from blob:', err.message);
    }
    return null;
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
