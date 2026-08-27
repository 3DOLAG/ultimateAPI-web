import express from 'express';
import { dbHelper } from '../db.js';
import { stockValidator } from '../services/stockValidator.js';
import { config } from '../config.js';

export const storeRouter = express.Router();

/**
 * GET /api/store/info & /api/info
 */
storeRouter.get(['/info', '/store/info'], (req, res) => {
  const settings = dbHelper.getStoreSettings();
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
      support_tiktok: settings.support_tiktok || config.store.tiktok
    }
  });
});

/**
 * GET /api/categories & GET /api/categories/tree
 */
storeRouter.get('/categories/tree', (req, res) => {
  try {
    const includeEmpty = req.query.includeEmpty === 'true' || req.query.all === 'true';
    const tree = dbHelper.getCategoryTree('default', !includeEmpty);
    res.json({ success: true, data: tree });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

storeRouter.get('/categories', (req, res) => {
  try {
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
storeRouter.get('/categories/:slug', (req, res) => {
  try {
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
storeRouter.get('/products', (req, res) => {
  try {
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
storeRouter.get('/products/:slug', (req, res) => {
  try {
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
