import express from 'express';
import { dbHelper } from '../db.js';
import { stockValidator } from '../services/stockValidator.js';
import { config } from '../config.js';
import { generateDynamicCss, resolveTheme } from '../services/themeEngine.js';
import { blobService } from '../services/blobService.js';
import { syncEngine, resolveSupplierImageUrl } from '../services/syncEngine.js';

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
/**
 * Helper: parse, format, and normalize social handles and links
 */
export function formatSocialLinks(settings = {}) {
  // TikTok: support username e.g. @aurastore or full URL
  const rawTiktok = (settings.support_tiktok !== undefined ? settings.support_tiktok : config.store.tiktok) || '';
  let tiktokUsername = '';
  let tiktokUrl = '';
  const isTiktokDisabled = settings.tiktok_enabled === false || settings.tiktok_enabled === 'false' || settings.tiktok_enabled === 0;

  if (rawTiktok && String(rawTiktok).trim() && !isTiktokDisabled) {
    const raw = String(rawTiktok).trim().replace(/^https?:\/\/(www\.)?tiktok\.com\/@?/i, '');
    const cleanUser = raw.replace(/^@/, '').replace(/\/.*$/, '').trim();
    if (cleanUser) {
      tiktokUsername = `@${cleanUser}`;
      tiktokUrl = `https://www.tiktok.com/@${cleanUser}`;
    }
  }

  // Discord: support server invite code or full URL
  const rawDiscord = (settings.support_discord !== undefined ? settings.support_discord : config.store.discord) || '';
  let discordCode = '';
  let discordUrl = '';
  const isDiscordDisabled = settings.discord_enabled === false || settings.discord_enabled === 'false' || settings.discord_enabled === 0;

  if (rawDiscord && String(rawDiscord).trim() && !isDiscordDisabled) {
    const raw = String(rawDiscord).trim().replace(/^https?:\/\/(www\.)?discord\.(gg|com\/invite)\/?/i, '');
    const cleanCode = raw.replace(/\/.*$/, '').trim();
    if (cleanCode) {
      discordCode = cleanCode;
      discordUrl = `https://discord.gg/${cleanCode}`;
    }
  }

  // WhatsApp: support phone or wa.me URL
  const rawWhatsapp = (settings.support_whatsapp !== undefined ? settings.support_whatsapp : config.store.whatsapp) || '';
  let whatsappPhone = '';
  let whatsappUrl = '';
  const isWhatsappDisabled = settings.whatsapp_enabled === false || settings.whatsapp_enabled === 'false' || settings.whatsapp_enabled === 0;

  if (rawWhatsapp && String(rawWhatsapp).trim() && !isWhatsappDisabled) {
    const cleanDigits = String(rawWhatsapp).replace(/[^0-9]/g, '');
    if (cleanDigits) {
      whatsappPhone = String(rawWhatsapp).trim();
      whatsappUrl = `https://wa.me/${cleanDigits}`;
    }
  }

  return {
    support_tiktok: tiktokUrl,
    tiktok_username: tiktokUsername,
    tiktok_enabled: Boolean(tiktokUrl && !isTiktokDisabled),
    support_discord: discordUrl,
    discord_code: discordCode,
    discord_enabled: Boolean(discordUrl && !isDiscordDisabled),
    support_whatsapp: whatsappPhone,
    whatsapp_url: whatsappUrl,
    whatsapp_enabled: Boolean(whatsappUrl && !isWhatsappDisabled)
  };
}

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

    const socials = formatSocialLinks(settings);

    res.json({
      success: true,
      data: {
        name: settings.store_name || config.store.name,
        tagline: settings.tagline || config.store.tagline,
        logo_url: settings.logo_url || config.store.logoUrl || '',
        currency: settings.currency || config.store.currency,
        currency_symbol: settings.currency_symbol || config.store.currencySymbol,
        ...socials,
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
    const sanitizedProducts = products.map(p => ({
      ...p,
      images: (p.images || []).map(resolveSupplierImageUrl).filter(Boolean)
    }));
    
    // Find subcategories that have products
    const allCategories = dbHelper.getCategories('default', true);
    const subcategories = allCategories.filter(c => c.parent_id === category.supplier_category_id || c.parent_id === category.id).map(sc => ({
      ...sc,
      cover_image: resolveSupplierImageUrl(sc.cover_image)
    }));

    category.cover_image = resolveSupplierImageUrl(category.cover_image);

    res.json({
      success: true,
      data: {
        category,
        subcategories,
        products: sanitizedProducts
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

    const sanitizedProducts = products.map(p => ({
      ...p,
      images: (p.images || []).map(resolveSupplierImageUrl).filter(Boolean)
    }));

    res.json({
      success: true,
      data: sanitizedProducts
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

    product.images = (product.images || []).map(resolveSupplierImageUrl).filter(Boolean);

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
