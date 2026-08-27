import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import multer from 'multer';
import { requireAdmin, requirePermission, requireRole } from '../middleware/auth.js';
import { dbHelper } from '../db.js';
import { orderService } from '../services/orderService.js';
import { syncEngine } from '../services/syncEngine.js';
import { supplierApi } from '../services/supplierApi.js';
import { blobService } from '../services/blobService.js';
import { resolveTheme } from '../services/themeEngine.js';
import { config } from '../config.js';

const uploadLogoMulter = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp|svg\+xml|svg|gif/i;
    const extName = /\.(jpe?g|png|webp|svg|gif)$/i.test(file.originalname);
    const mimeType = allowed.test(file.mimetype);
    if (extName || mimeType) {
      return cb(null, true);
    }
    cb(new Error('Only image files (PNG, JPG, JPEG, WEBP, SVG, GIF) are allowed for logo.'));
  }
});

export const dashboardRouter = express.Router();

// Enforce Strict Admin Authorization on all Dashboard API routes
dashboardRouter.use(requireAdmin);

/**
 * GET /api/dashboard/overview
 */
dashboardRouter.get('/overview', async (req, res) => {
  try {
    const metrics = dbHelper.getOverviewMetrics();
    const conn = await supplierApi.checkHealth();
    res.json({
      success: true,
      data: {
        ...metrics,
        supplierConnection: conn
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/dashboard/orders
 */
dashboardRouter.get('/orders', (req, res) => {
  try {
    const { status, payment_status, search, limit, offset } = req.query;
    const orders = dbHelper.getOrders({
      status: status || 'all',
      payment_status: payment_status || 'all',
      search: search || '',
      limit: parseInt(limit || '50', 10),
      offset: parseInt(offset || '0', 10)
    });

    res.json({
      success: true,
      data: orders
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/dashboard/orders/:id
 */
dashboardRouter.get('/orders/:id', (req, res) => {
  try {
    const order = dbHelper.getOrderById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, error: { message: 'Order not found' } });
    }
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/dashboard/orders/:id/approve-payment
 */
dashboardRouter.post('/orders/:id/approve-payment', requirePermission('approve_payments'), async (req, res) => {
  try {
    const { note } = req.body;
    const updated = await orderService.approvePayment(req.params.id, { note });
    res.json({
      success: true,
      message: 'Payment verified and approved. Order status updated to Paid.',
      data: updated
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/dashboard/orders/:id/reject-payment
 */
dashboardRouter.post('/orders/:id/reject-payment', requirePermission('approve_payments'), async (req, res) => {
  try {
    const { reason } = req.body;
    const updated = await orderService.rejectPayment(req.params.id, { reason });
    res.json({
      success: true,
      message: 'Payment proof rejected. Customer notified to upload another proof.',
      data: updated
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/dashboard/orders/:id/retry-discord-webhook
 */
dashboardRouter.post('/orders/:id/retry-discord-webhook', requirePermission('approve_payments'), async (req, res) => {
  try {
    const order = dbHelper.getOrderById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, error: { message: 'Order not found' } });
    }

    const eventId = `evt_ORD_${order.reseller_order_id}_PAYMENT_PROOF_RETRY_${Date.now()}`;
    const webhookUrl = config.discordWebhookUrl;

    if (!webhookUrl || webhookUrl.trim() === '') {
      dbHelper.updateDiscordWebhookStatus(order.id, {
        sent_to_discord: 1,
        discord_event_id: eventId,
        sent_at: new Date().toISOString(),
        delivery_status: 'simulated'
      });
      return res.json({ success: true, message: 'Discord Webhook URL not configured in .env (Simulated Delivery Success).' });
    }

    const payloadJson = {
      content: `🔄 **إعادة إرسال إشعار الطلب يدويًا من لوحة الإدارة** — طلب **#${order.reseller_order_id}**`,
      embeds: [
        {
          title: `Order #${order.reseller_order_id} — Manual Delivery Retry`,
          description: `تمت إعادة إرسال تفاصيل الطلب بنجاح بواسطة مسؤول النظام.`,
          color: 0x10b981,
          fields: [
            { name: '👤 Customer', value: `${order.customer_name}\n📧 ${order.customer_email}\n📱 ${order.customer_phone}`, inline: true },
            { name: '💳 Payment Method', value: `${order.payment_method_name || 'Manual Transfer'}\n**Status:** ${order.payment_status}`, inline: true },
            { name: '💰 Total Amount', value: `**${Number(order.total || 0).toLocaleString()} ${order.currency || 'EGP'}**`, inline: true },
            { name: '📦 Items', value: (order.items || []).map(it => `• ${it.quantity || 1}× ${it.item_name || it.name} (${(it.total_price || it.price || 0).toLocaleString()} ${order.currency || 'EGP'})`).join('\n') || 'N/A', inline: false }
          ],
          footer: { text: `AURA Store Webhook Engine • Event: ${eventId}` },
          timestamp: new Date().toISOString()
        }
      ]
    };

    const resp = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payloadJson)
    });

    if (resp.ok || resp.status === 204) {
      dbHelper.updateDiscordWebhookStatus(order.id, {
        sent_to_discord: 1,
        discord_event_id: eventId,
        sent_at: new Date().toISOString(),
        delivery_status: 'delivered'
      });
      return res.json({ success: true, message: 'Discord webhook successfully delivered.' });
    } else {
      const errText = await resp.text().catch(() => '');
      dbHelper.updateDiscordWebhookStatus(order.id, {
        sent_to_discord: 0,
        discord_event_id: eventId,
        sent_at: null,
        delivery_status: 'failed'
      });
      return res.status(502).json({ success: false, error: { message: `Discord returned HTTP ${resp.status}: ${errText.slice(0, 150)}` } });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET & POST /api/dashboard/pricing (Category Margins)
 */
dashboardRouter.get('/pricing', (req, res) => {
  try {
    const margins = dbHelper.getCategoryMargins();
    res.json({ success: true, data: margins });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

dashboardRouter.post('/pricing', requirePermission('manage_pricing'), (req, res) => {
  try {
    const { category_id, margin_percent, margin_fixed, is_active } = req.body;
    if (!category_id || margin_percent === undefined) {
      return res.status(400).json({ success: false, error: { message: 'Category ID and margin percentage are required.' } });
    }

    dbHelper.saveCategoryMargin(category_id, margin_percent, margin_fixed || 0, is_active !== false);

    res.json({
      success: true,
      message: `Profit margin updated for category ${category_id}. All customer prices recalculated immediately.`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/dashboard/catalog
 * Returns products and categories with their visibility status for dashboard control
 */
dashboardRouter.get('/catalog', async (req, res) => {
  try {
    try {
      const overrides = await blobService.loadCatalogOverrides();
      if (overrides) {
        dbHelper.applyCatalogOverrides(overrides);
      }
    } catch {}

    const products = dbHelper.getProducts({ limit: 500, includeHidden: true });
    const categories = dbHelper.getCategories('default', false, true);
    const overrides = dbHelper.getHiddenCatalogOverrides();

    res.json({
      success: true,
      data: {
        products,
        categories,
        hidden_products_count: overrides.hiddenProductIds.length,
        hidden_categories_count: overrides.hiddenCategoryIds.length
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/dashboard/products/:id/toggle-visibility
 */
dashboardRouter.post('/products/:id/toggle-visibility', requirePermission('manage_settings'), async (req, res) => {
  try {
    const productId = req.params.id;
    const isHidden = req.body.is_hidden !== undefined ? Boolean(req.body.is_hidden) : null;
    const result = dbHelper.toggleProductVisibility(productId, isHidden);
    if (!result) {
      return res.status(404).json({ success: false, error: { message: 'Product not found.' } });
    }

    // Persist to Vercel Blob
    try {
      const overrides = dbHelper.getHiddenCatalogOverrides();
      await blobService.saveCatalogOverrides(overrides);
    } catch (blobErr) {
      console.warn('[Dashboard] Failed to save catalog overrides to blob:', blobErr.message);
    }

    res.json({
      success: true,
      data: result,
      message: result.is_hidden ? `تم إخفاء المنتج "${result.name || productId}" من المتجر بنجاح 👁️‍🗨️` : `تم إظهار المنتج "${result.name || productId}" في المتجر بنجاح 👁️`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/dashboard/categories/:id/toggle-visibility
 */
dashboardRouter.post('/categories/:id/toggle-visibility', requirePermission('manage_settings'), async (req, res) => {
  try {
    const categoryId = req.params.id;
    const isHidden = req.body.is_hidden !== undefined ? Boolean(req.body.is_hidden) : null;
    const result = dbHelper.toggleCategoryVisibility(categoryId, isHidden);
    if (!result) {
      return res.status(404).json({ success: false, error: { message: 'Category not found.' } });
    }

    // Persist to Vercel Blob
    try {
      const overrides = dbHelper.getHiddenCatalogOverrides();
      await blobService.saveCatalogOverrides(overrides);
    } catch (blobErr) {
      console.warn('[Dashboard] Failed to save catalog overrides to blob:', blobErr.message);
    }

    res.json({
      success: true,
      data: result,
      message: result.is_hidden ? `تم إخفاء القسم "${result.name || result.slug || categoryId}" وجميع منتجاته من المتجر 👁️‍🗨️` : `تم إظهار القسم "${result.name || result.slug || categoryId}" في المتجر بنجاح 👁️`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET & POST /api/dashboard/payment-methods
 */
dashboardRouter.get('/payment-methods', async (req, res) => {
  try {
    try {
      const blobMethods = await blobService.loadPaymentMethods();
      if (blobMethods && Array.isArray(blobMethods) && blobMethods.length > 0) {
        for (const m of blobMethods) {
          dbHelper.upsertPaymentMethod(m);
        }
      }
    } catch {}

    const methods = dbHelper.getPaymentMethods(false);
    res.json({ success: true, data: methods });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

dashboardRouter.post('/payment-methods', requirePermission('manage_payment_methods'), async (req, res) => {
  try {
    const pm = req.body;
    if (!pm.name || !pm.account_number) {
      return res.status(400).json({ success: false, error: { message: 'Name and account number are required.' } });
    }

    dbHelper.upsertPaymentMethod(pm);
    const allMethods = dbHelper.getPaymentMethods(false);
    try {
      await blobService.savePaymentMethods(allMethods);
    } catch {}

    res.json({ success: true, message: 'Payment method saved successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

dashboardRouter.delete('/payment-methods/:id', requirePermission('manage_payment_methods'), async (req, res) => {
  try {
    dbHelper.deletePaymentMethod(req.params.id);
    const allMethods = dbHelper.getPaymentMethods(false);
    try {
      await blobService.savePaymentMethods(allMethods);
    } catch {}

    res.json({ success: true, message: 'Payment method deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * User Management
 */
dashboardRouter.get('/users', requirePermission('manage_users'), (req, res) => {
  try {
    const users = dbHelper.getUsers();
    res.json({ success: true, data: users });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

dashboardRouter.post('/users', requirePermission('manage_users'), (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, error: { message: 'Name, email, and password are required.' } });
    }

    const passHash = crypto.createHash('sha256').update(password).digest('hex');
    const newUser = dbHelper.createUser({
      name,
      email: email.trim().toLowerCase(),
      password_hash: passHash,
      role: role || 'SUPPORT',
      permissions: ['view_orders', 'view_payments', 'approve_payments']
    });

    res.status(201).json({ success: true, data: newUser });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

dashboardRouter.patch('/users/:id', requirePermission('manage_users'), (req, res) => {
  try {
    const { role, status, permissions } = req.body;
    if (role) dbHelper.updateUserRole(req.params.id, role, permissions || []);
    if (status) dbHelper.toggleUserStatus(req.params.id, status);
    res.json({ success: true, message: 'User updated.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Catalog Sync Controls
 */
dashboardRouter.post('/sync/full', requirePermission('manage_products'), async (req, res) => {
  try {
    const result = await syncEngine.runFullSync();
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

dashboardRouter.post('/sync/delta', requirePermission('manage_products'), async (req, res) => {
  try {
    const result = await syncEngine.runIncrementalSync();
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

dashboardRouter.get('/sync/logs', (req, res) => {
  try {
    const logs = dbHelper.getSyncLogs();
    res.json({ success: true, data: logs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Logs & Webhooks
 */
dashboardRouter.get('/webhooks', requirePermission('manage_webhooks'), (req, res) => {
  try {
    const webhooks = dbHelper.getWebhookLogs();
    res.json({ success: true, data: webhooks });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

dashboardRouter.get('/logs', (req, res) => {
  try {
    const logs = dbHelper.getApiLogs();
    res.json({ success: true, data: logs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Store Settings
 */
dashboardRouter.get('/settings', async (req, res) => {
  try {
    const dbSettings = dbHelper.getStoreSettings();
    let blobSettings = null;
    try {
      blobSettings = await blobService.loadSettings();
    } catch (e) { /* blob not available */ }
    const settings = { ...dbSettings, ...(blobSettings || {}) };

    const resolvedTheme = resolveTheme({
      themePreset: settings.theme_preset || config.store.themePreset,
      themePrimaryColor: settings.theme_primary_color || config.store.themePrimaryColor,
      themePrimaryHover: settings.theme_primary_hover || config.store.themePrimaryHover,
      themeAccentColor: settings.theme_accent_color || config.store.themeAccentColor,
      themeBgColor: settings.theme_bg_color || config.store.themeBgColor,
      themeSurfaceColor: settings.theme_surface_color || config.store.themeSurfaceColor
    });

    res.json({
      success: true,
      data: {
        ...settings,
        store_name: settings.store_name || config.store.name,
        tagline: settings.tagline || config.store.tagline,
        logo_url: settings.logo_url || config.store.logoUrl || '',
        support_whatsapp: settings.support_whatsapp || config.store.whatsapp,
        whatsapp_enabled: settings.whatsapp_enabled !== undefined ? settings.whatsapp_enabled : true,
        support_discord: settings.support_discord || config.store.discord,
        discord_enabled: settings.discord_enabled !== undefined ? settings.discord_enabled : true,
        support_tiktok: settings.support_tiktok || config.store.tiktok,
        tiktok_enabled: settings.tiktok_enabled !== undefined ? settings.tiktok_enabled : true,
        theme_bg_color: settings.theme_bg_color || config.store.themeBgColor || '#06080d',
        theme_surface_color: settings.theme_surface_color || config.store.themeSurfaceColor || '#101622',
        theme_accent_color: settings.theme_accent_color || config.store.themeAccentColor || '#6366f1',
        theme_primary_color: settings.theme_primary_color || config.store.themePrimaryColor || '#6366f1',
        theme_primary_hover: settings.theme_primary_hover || config.store.themePrimaryHover || '#4f46e5',
        theme: resolvedTheme
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

dashboardRouter.post('/settings', requirePermission('manage_settings'), async (req, res) => {
  try {
    // Save to SQLite (ephemeral on Vercel, works locally)
    dbHelper.saveStoreSettings(req.body);

    // Also save to Vercel Blob for persistent storage across serverless cold starts
    try {
      const existingBlob = await blobService.loadSettings();
      const merged = { ...(existingBlob || {}), ...req.body };
      await blobService.saveSettings(merged);
    } catch (blobErr) {
      console.warn('[Dashboard] Blob settings save skipped:', blobErr.message);
    }

    res.json({ success: true, message: 'Settings saved.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/dashboard/upload-logo
 * Uploads store logo image and automatically updates store_settings
 */
dashboardRouter.post('/upload-logo', requirePermission('manage_settings'), (req, res) => {
  uploadLogoMulter.single('logo')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ success: false, error: err.message });
    }
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ success: false, error: 'No logo image file was uploaded.' });
    }

    try {
      const result = await blobService.upload(req.file.originalname, req.file.buffer, {
        folder: 'branding',
        contentType: req.file.mimetype,
        access: 'public'
      });

      dbHelper.saveStoreSettings({ logo_url: result.url });

      // Persist to blob for Vercel
      try {
        const existingBlob = await blobService.loadSettings();
        await blobService.saveSettings({ ...(existingBlob || {}), logo_url: result.url });
      } catch (e) { /* blob not available */ }

      res.json({
        success: true,
        message: 'Store logo uploaded successfully.',
        data: { logo_url: result.url, provider: result.provider }
      });
    } catch (uploadErr) {
      console.error('[Dashboard] Error uploading store logo:', uploadErr);
      res.status(500).json({ success: false, error: uploadErr.message });
    }
  });
});

/**
 * GET /api/dashboard/payment-proofs/:filename
 * Securely streams private payment proof images ONLY to authenticated dashboard users
 */
dashboardRouter.get('/payment-proofs/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(config.uploadDir, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).send('Payment proof image not found.');
  }

  res.sendFile(filePath);
});
