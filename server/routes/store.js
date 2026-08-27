import express from 'express';
import { dbHelper } from '../db.js';
import { stockValidator } from '../services/stockValidator.js';
import { config } from '../config.js';
import { generateDynamicCss, resolveTheme } from '../services/themeEngine.js';
import { blobService } from '../services/blobService.js';
import { syncEngine } from '../services/syncEngine.js';

export const storeRouter = express.Router();

/**
 * Helper: merge settings from blob (persistent) → db (ephemeral) → env defaults
 */
async function getMergedSettings() {
  const dbSettings = dbHelper.getStoreSettings();
  let blobSettings = null;
  try {
    blobSettings = await blobService.loadSettings();
  } catch (e) { /* blob not available */ }
  // Blob wins over db, db wins over env defaults
  return { ...dbSettings, ...(blobSettings || {}) };
}

/**
 * Helper: ensure database catalog is populated from supplier API if empty
 */
async function ensureCatalogSynced() {
  const cats = dbHelper.getCategories('default', true);
  if (!cats || cats.length === 0) {
    try {
      console.log('[Store] Empty catalog detected. Fetching live catalog from Supplier API...');
      await syncEngine.runFullSync();
    } catch (err) {
      console.warn('[Store] Live catalog sync notice:', err.message);
    }
  }
}

/**
 * GET /api/theme.css & /theme.css
 */
storeRouter.get(['/theme.css', '/theme/style.css'], async (req, res) => {
  try {
    const settings = await getMergedSettings();
    const themeConfig = {
      themePreset: settings.theme_preset || config.store.themePreset,
      themePrimaryColor: settings.theme_primary_color || config.store.themePrimaryColor,
      themePrimaryHover: settings.theme_primary_hover || config.store.themePrimaryHover,
      themeAccentColor: settings.theme_accent_color || config.store.themeAccentColor,
      themeBgColor: settings.theme_bg_color || config.store.themeBgColor,
      themeSurfaceColor: settings.theme_surface_color || config.store.themeSurfaceColor
    };
    res.setHeader('Content-Type', 'text/css');
    res.setHeader('Cache-Control', 'public, max-age=10');
    res.send(generateDynamicCss(themeConfig));
  } catch (err) {
    res.setHeader('Content-Type', 'text/css');
    res.send('/* error loading theme */');
  }
});

/**
 * GET /api/store/info & /api/info
 */
storeRouter.get(['/info', '/store/info'], async (req, res) => {
  try {
    const settings = await getMergedSettings();
    const themeConfig = {
      themePreset: settings.theme_preset || config.store.themePreset,
      themePrimaryColor: settings.theme_primary_color || config.store.themePrimaryColor,
      themePrimaryHover: settings.theme_primary_hover || config.store.themePrimaryHover,
      themeAccentColor: settings.theme_accent_color || config.store.themeAccentColor,
      themeBgColor: settings.theme_bg_color || config.store.themeBgColor,
      themeSurfaceColor: settings.theme_surface_color || config.store.themeSurfaceColor
    };
    res.json({
      success: true,
      data: {
        name: settings.store_name || config.store.name,
        tagline: settings.tagline || config.store.tagline,
        logo_url: settings.logo_url || config.store.logoUrl || '',
        currency: settings.currency || config.store.currency,
        currency_symbol: settings.currency_symbol || config.store.currencySymbol,
        support_whatsapp: settings.support_whatsapp || config.store.whatsapp,
        support_discord: settings.support_discord || config.store.discord,
        support_tiktok: settings.support_tiktok || config.store.tiktok,
        theme: resolveTheme(themeConfig)
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/categories & GET /api/categories/tree
 */
storeRouter.get('/categories/tree', async (req, res) => {
  try {
    await ensureCatalogSynced();
    const includeEmpty = req.query.includeEmpty === 'true' || req.query.all === 'true';
    const tree = dbHelper.getCategoryTree('default', !includeEmpty);
    res.json({ success: true, data: tree });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

storeRouter.get('/categories', async (req, res) => {
  try {
    await ensureCatalogSynced();
    const includeEmpty = req.query.includeEmpty === 'true' || req.query.all === 'true';
    const categories = dbHelper.getCategories('default', !includeEmpty);
    res.json({ success: true, data: categories });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/categories/:slug
 */
storeRouter.get('/categories/:slug', async (req, res) => {
  try {
    await ensureCatalogSynced();
    const slug = req.params.slug;
    const category = dbHelper.getCategoryBySlugOrId(slug);
    if (!category) {
      return res.status(404).json({ success: false, error: { code: 'CATEGORY_NOT_FOUND', message: 'Category not found' } });
    }

    const products = dbHelper.getProducts({ category: category.supplier_category_id || category.slug });
    
    // Find subcategories that have products
    const allCategories = dbHelper.getCategories('default', true);
    const subcategories = allCategories.filter(c => c.parent_id === category.supplier_category_id || c.parent_id === category.id);

    res.json({
      success: true,
      data: {
        category,
        subcategories,
        products
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/products
 */
storeRouter.get('/products', async (req, res) => {
  try {
    await ensureCatalogSynced();
    const { category, search, inStockOnly, sort, limit, offset } = req.query;
    const products = dbHelper.getProducts({
      category: category || 'all',
      search: search || '',
      inStockOnly: inStockOnly === 'true',
      sort: sort || 'newest',
      limit: parseInt(limit || '50', 10),
      offset: parseInt(offset || '0', 10)
    });

    res.json({
      success: true,
      data: products
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/products/:slug
 */
storeRouter.get('/products/:slug', async (req, res) => {
  try {
    await ensureCatalogSynced();
    const slug = req.params.slug;
    const product = dbHelper.getProductByIdOrSlug(slug);
    if (!product) {
      return res.status(404).json({
        success: false,
        error: { code: 'PRODUCT_NOT_FOUND', message: 'Product not found.' }
      });
    }

    res.json({
      success: true,
      data: product
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/items/:id/availability
 */
storeRouter.get('/items/:id/availability', async (req, res) => {
  try {
    const itemId = req.params.id;
    const availability = await stockValidator.validateItem(itemId);
    res.json({
      success: true,
      data: availability
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
