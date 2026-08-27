import { supplierApi } from './supplierApi.js';
import { dbHelper } from '../db.js';
import { config } from '../config.js';

export class SyncEngineService {
  constructor() {
    this.isSyncing = false;
    this.lastSyncTime = null;
    this.cronInterval = null;
  }

  init() {
    console.log(`[SyncEngine] 🕒 Initializing background product sync schedule: "${config.sync.cronSchedule}"`);

    if (config.sync.syncOnStartup) {
      setTimeout(() => {
        console.log(`[SyncEngine] 🚀 Running initial startup catalog synchronization...`);
        this.runFullSync().catch(err => {
          console.error(`[SyncEngine] ❌ Startup sync error:`, err.message);
        });
      }, 1000);
    }

    // Run delta sync every 5 minutes
    this.cronInterval = setInterval(() => {
      this.runIncrementalSync().catch(err => {
        console.warn(`[SyncEngine] ⚠️ Periodic delta sync notice:`, err.message);
      });
    }, 5 * 60 * 1000);
  }

  async runFullSync(resellerId = 'default') {
    if (this.isSyncing) {
      console.log(`[SyncEngine] ⚠️ Sync is already in progress, skipping...`);
      return { status: 'in_progress' };
    }

    this.isSyncing = true;
    const startTime = Date.now();
    let itemsSynced = 0;
    let itemsUpdated = 0;

    try {
      console.log(`[SyncEngine] 🔄 Starting Full Catalog Sync from Authoritative Supplier API...`);

      // 1. Ingest Categories
      const catRes = await supplierApi.getCategories().catch(() => null);
      const categories = catRes?.data || catRes?.categories || [];

      if (Array.isArray(categories) && categories.length > 0) {
        categories.forEach(cat => {
          dbHelper.upsertCategory({
            id: cat.id || `cat_${cat.slug || cat.name}`,
            supplier_category_id: cat.id || cat.supplier_category_id,
            parent_id: cat.parent_id || null,
            name: cat.name,
            name_ar: cat.name_ar || null,
            slug: cat.slug || cat.name.toLowerCase().replace(/\s+/g, '-'),
            description: cat.description || '',
            cover_image: cat.cover_image || cat.image || null,
            sort_order: cat.sort_order || 0,
            status: cat.status || (cat.is_displayed !== false ? 'active' : 'inactive')
          }, resellerId);
        });
        console.log(`[SyncEngine] 📁 Synchronized ${categories.length} product categories.`);
      }

      // 2. Ingest Full Sync / Products
      const syncRes = await supplierApi.getSyncDelta().catch(() => null);
      let products = syncRes?.data?.products || syncRes?.products || [];

      if (!products || products.length === 0) {
        const prodRes = await supplierApi.getProducts({ limit: 100 }).catch(() => null);
        products = prodRes?.data || prodRes?.products || [];
      }

      if (Array.isArray(products) && products.length > 0) {
        products.forEach(p => {
          // Parse variants into purchasable items
          const items = [];
          
          if (Array.isArray(p.variants) && p.variants.length > 0) {
            const optionGroups = p.option_groups || [];
            p.variants.forEach((v, idx) => {
              const basePrice = Number(v.reseller_price ?? v.price?.reseller ?? v.base_price ?? v.price?.base ?? v.price ?? p.price ?? 0);
              const isPriced = basePrice > 0;
              const isAvail = isPriced && (v.available !== false && v.is_available !== false);
              const selection = v.selection || {};
              const rawEdition = v.edition_label || 'Standard Edition';
              const resolvedName = dbHelper.resolveVariantDisplayName({ ...v, edition_label: rawEdition, selection }, optionGroups);

              items.push({
                id: v.id ? `item_${v.id}` : `item_${p.id}_${v.sku || idx}`,
                supplier_item_id: v.id || `item_${p.id}_${v.sku || idx}`,
                name: resolvedName,
                edition_label: rawEdition,
                sku: v.sku || `${p.slug || p.id}-sku-${idx + 1}`,
                selection,
                base_price: basePrice,
                currency: v.currency || p.currency || 'EGP',
                stock_status: isAvail ? 'IN_STOCK' : 'OUT_OF_STOCK',
                stock_quantity: isAvail ? (v.stock_quantity ?? 50) : 0,
                is_available: isAvail
              });
            });
          } else {
            // Standalone product item
            const basePrice = Number(p.price?.reseller ?? p.price?.base ?? p.price ?? p.price_base ?? 0);
            const isPriced = basePrice > 0;
            const isAvail = isPriced && (p.stock?.available !== false && p.is_available !== false);

            items.push({
              id: `item_${p.id}_default`,
              supplier_item_id: p.id,
              name: p.name,
              edition_label: 'Standard License',
              sku: `${p.slug || p.id}-std`,
              selection: {},
              base_price: basePrice,
              currency: p.currency || 'EGP',
              stock_status: isAvail ? 'IN_STOCK' : 'OUT_OF_STOCK',
              stock_quantity: isAvail ? (p.stock?.quantity ?? 50) : 0,
              is_available: isAvail
            });
          }

          const pricedItems = items.filter(it => it.base_price > 0 && it.is_available);
          const basePrice = pricedItems.length > 0 ? pricedItems[0].base_price : (items.length > 0 ? items[0].base_price : 0);

          let catId = p.category_id;
          if (!catId && p.category) catId = p.category;
          if (typeof catId === 'object' && catId !== null) {
            catId = catId.id || catId.slug || catId.name;
          }
          catId = String(catId || 'games');

          dbHelper.upsertProduct({
            id: p.id,
            supplier_product_id: p.id,
            category_id: catId,
            name: p.name,
            name_ar: p.name_ar || null,
            slug: p.slug || p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            description: p.description || '',
            description_ar: p.description_ar || null,
            images: Array.isArray(p.images) ? p.images : (p.image ? [p.image] : (p.cover_image ? [p.cover_image] : [])),
            option_groups: p.option_groups || [],
            custom_fields: p.custom_fields || [],
            has_variants: items.length > 1,
            price_base: basePrice,
            currency: p.currency || 'EGP',
            stock_available: p.is_available !== false && (p.stock?.available !== false),
            stock_quantity: p.stock?.quantity ?? 50,
            status: p.status || 'active',
            sort_order: p.sort_order || 0,
            supplier_updated_at: p.updated_at || null,
            items
          }, resellerId);

          itemsSynced++;
          itemsUpdated++;
        });
      }

      const durationMs = Date.now() - startTime;
      this.lastSyncTime = new Date().toISOString();

      dbHelper.logSync({
        sync_type: 'full',
        items_synced: itemsSynced,
        items_updated: itemsUpdated,
        items_disabled: 0,
        duration_ms: durationMs,
        status: 'success'
      });

      console.log(`[SyncEngine] ✅ Full Catalog Sync complete in ${durationMs}ms: ${categories.length} categories, ${products.length} products synced.`);

      return {
        success: true,
        categories_synced: categories.length,
        products_synced: products.length,
        duration_ms: durationMs
      };
    } catch (err) {
      const durationMs = Date.now() - startTime;
      console.error(`[SyncEngine] ❌ Full Catalog Sync failed:`, err.message);

      dbHelper.logSync({
        sync_type: 'full',
        items_synced: itemsSynced,
        items_updated: itemsUpdated,
        items_disabled: 0,
        duration_ms: durationMs,
        status: 'failed',
        error_message: err.message
      });

      throw err;
    } finally {
      this.isSyncing = false;
    }
  }

  async runIncrementalSync(resellerId = 'default') {
    if (this.isSyncing) return { status: 'skipped' };
    this.isSyncing = true;
    const startTime = Date.now();

    try {
      const since = this.lastSyncTime || new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const deltaRes = await supplierApi.getSyncDelta(since).catch(() => null);
      const products = deltaRes?.data?.products || deltaRes?.products || [];

      if (Array.isArray(products) && products.length > 0) {
        products.forEach(p => {
          const items = [];
          if (Array.isArray(p.variants) && p.variants.length > 0) {
            const optionGroups = p.option_groups || [];
            p.variants.forEach((v, idx) => {
              const selection = v.selection || {};
              const rawEdition = v.edition_label || 'Standard Edition';
              const resolvedName = dbHelper.resolveVariantDisplayName({ ...v, edition_label: rawEdition, selection }, optionGroups);
              items.push({
                id: v.id ? `item_${v.id}` : `item_${p.id}_${v.sku || idx}`,
                supplier_item_id: v.id || `item_${p.id}_${v.sku || idx}`,
                name: resolvedName,
                edition_label: rawEdition,
                sku: v.sku || `${p.slug || p.id}-sku-${idx + 1}`,
                selection,
                base_price: Number(v.reseller_price ?? v.price?.reseller ?? v.base_price ?? v.price?.base ?? 0),
                currency: v.currency || p.currency || 'EGP',
                stock_status: v.stock_status || (v.available !== false ? 'IN_STOCK' : 'OUT_OF_STOCK'),
                stock_quantity: v.stock_quantity ?? 50,
                is_available: v.available !== false && v.is_available !== false
              });
            });
          }

          let catId = p.category_id;
          if (!catId && p.category) catId = p.category;
          if (typeof catId === 'object' && catId !== null) {
            catId = catId.id || catId.slug || catId.name;
          }
          catId = String(catId || 'games');

          dbHelper.upsertProduct({
            id: p.id,
            supplier_product_id: p.id,
            category_id: catId,
            name: p.name,
            name_ar: p.name_ar || null,
            slug: p.slug || p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            description: p.description || '',
            description_ar: p.description_ar || null,
            images: Array.isArray(p.images) ? p.images : (p.image ? [p.image] : []),
            option_groups: p.option_groups || [],
            custom_fields: p.custom_fields || [],
            has_variants: p.has_variants || false,
            price_base: items.length > 0 ? items[0].base_price : 0,
            currency: p.currency || 'EGP',
            stock_available: p.is_available !== false && (p.stock?.available !== false),
            stock_quantity: p.stock?.quantity ?? 50,
            status: p.status || 'active',
            sort_order: p.sort_order || 0,
            supplier_updated_at: p.updated_at || null,
            items
          }, resellerId);
        });
      }

      this.lastSyncTime = new Date().toISOString();
      const durationMs = Date.now() - startTime;

      dbHelper.logSync({
        sync_type: 'incremental',
        items_synced: products.length,
        items_updated: products.length,
        items_disabled: 0,
        duration_ms: durationMs,
        status: 'success'
      });

      return { success: true, items_updated: products.length };
    } catch (err) {
      console.warn(`[SyncEngine] ⚠️ Delta sync notice:`, err.message);
      return { success: false, error: err.message };
    } finally {
      this.isSyncing = false;
    }
  }
}

export const syncEngine = new SyncEngineService();
