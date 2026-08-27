import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure storage directories exist
const dbDir = path.dirname(config.databasePath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

if (!fs.existsSync(config.uploadDir)) {
  fs.mkdirSync(config.uploadDir, { recursive: true });
}

export const db = new DatabaseSync(config.databasePath);

// Enable SQLite Write-Ahead Logging & Foreign Keys for maximum throughput and ACID safety
db.exec(`PRAGMA journal_mode = WAL;`);
db.exec(`PRAGMA foreign_keys = ON;`);
db.exec(`PRAGMA busy_timeout = 10000;`);

// -------------------------------------------------------------
// Ephemeral In-Memory Orders (Zero Website Database Storage)
// Orders are dispatched exclusively to Discord Webhook
// -------------------------------------------------------------
const ephemeralOrders = new Map();

/**
 * Initialize Authoritative Reseller Database Schema
 */
export function initDatabase() {
  db.exec(`
    -- Reseller Categories (Hierarchical with parent_id)
    CREATE TABLE IF NOT EXISTS reseller_categories (
      id TEXT PRIMARY KEY,
      reseller_id TEXT NOT NULL DEFAULT 'default',
      supplier_category_id TEXT NOT NULL,
      parent_id TEXT,
      name TEXT NOT NULL,
      name_ar TEXT,
      slug TEXT NOT NULL,
      description TEXT,
      cover_image TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      synced_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(reseller_id, supplier_category_id)
    );

    CREATE INDEX IF NOT EXISTS idx_reseller_cat_parent ON reseller_categories(parent_id);
    CREATE INDEX IF NOT EXISTS idx_reseller_cat_slug ON reseller_categories(slug);
    CREATE INDEX IF NOT EXISTS idx_reseller_cat_sort ON reseller_categories(sort_order);

    -- Category Profit Margins (Dynamic Reseller Pricing Engine)
    CREATE TABLE IF NOT EXISTS category_margins (
      category_id TEXT PRIMARY KEY,
      parent_id TEXT,
      margin_percent REAL NOT NULL DEFAULT 15.0,
      margin_fixed REAL NOT NULL DEFAULT 0.0,
      is_active INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Reseller Products (Parent Product Entities)
    CREATE TABLE IF NOT EXISTS reseller_products (
      id TEXT PRIMARY KEY,
      reseller_id TEXT NOT NULL DEFAULT 'default',
      supplier_product_id TEXT NOT NULL,
      category_id TEXT NOT NULL,
      name TEXT NOT NULL,
      name_ar TEXT,
      slug TEXT NOT NULL,
      description TEXT,
      description_ar TEXT,
      images_json TEXT NOT NULL DEFAULT '[]',
      option_groups_json TEXT NOT NULL DEFAULT '[]',
      has_variants INTEGER NOT NULL DEFAULT 0,
      price_base REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'EGP',
      stock_available INTEGER NOT NULL DEFAULT 1,
      stock_quantity INTEGER NOT NULL DEFAULT 50,
      status TEXT NOT NULL DEFAULT 'active',
      sort_order INTEGER NOT NULL DEFAULT 0,
      supplier_updated_at TEXT,
      synced_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(reseller_id, supplier_product_id)
    );

    CREATE INDEX IF NOT EXISTS idx_reseller_prod_cat ON reseller_products(category_id);
    CREATE INDEX IF NOT EXISTS idx_reseller_prod_slug ON reseller_products(slug);
    CREATE INDEX IF NOT EXISTS idx_reseller_prod_status ON reseller_products(status);

    -- Reseller Items (Individual Purchasable Variants/SKUs)
    CREATE TABLE IF NOT EXISTS reseller_items (
      id TEXT PRIMARY KEY,
      reseller_id TEXT NOT NULL DEFAULT 'default',
      supplier_item_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      name TEXT NOT NULL,
      edition_label TEXT,
      sku TEXT,
      selection_json TEXT NOT NULL DEFAULT '{}',
      base_price REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'EGP',
      stock_status TEXT NOT NULL DEFAULT 'IN_STOCK',
      stock_quantity INTEGER DEFAULT 50,
      is_available INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active',
      synced_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(reseller_id, supplier_item_id),
      FOREIGN KEY(product_id) REFERENCES reseller_products(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_reseller_items_prod ON reseller_items(product_id);
    CREATE INDEX IF NOT EXISTS idx_reseller_items_avail ON reseller_items(is_available);

    -- Payment Methods (Manageable via Dashboard)
    CREATE TABLE IF NOT EXISTS payment_methods (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      name_ar TEXT NOT NULL,
      type TEXT NOT NULL,
      account_number TEXT NOT NULL,
      account_name TEXT,
      instructions TEXT NOT NULL,
      instructions_ar TEXT NOT NULL,
      logo_icon TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Reseller Orders (Triplet ID mapped records with Payment Proof)
    CREATE TABLE IF NOT EXISTS reseller_orders (
      id TEXT PRIMARY KEY,
      reseller_id TEXT NOT NULL DEFAULT 'default',
      reseller_order_id TEXT UNIQUE NOT NULL,
      supplier_order_id TEXT,
      external_order_id TEXT UNIQUE NOT NULL,
      idempotency_key TEXT UNIQUE NOT NULL,
      customer_name TEXT NOT NULL,
      customer_email TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      subtotal REAL NOT NULL,
      tax REAL NOT NULL DEFAULT 0,
      shipping_fee REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'EGP',
      supplier_cost REAL NOT NULL DEFAULT 0,
      reseller_profit REAL NOT NULL DEFAULT 0,
      payment_method_id TEXT,
      payment_method_name TEXT,
      payment_proof_path TEXT,
      payment_reference TEXT,
      payment_status TEXT NOT NULL DEFAULT 'pending',
      rejection_reason TEXT,
      supplier_status TEXT NOT NULL DEFAULT 'pending',
      local_status TEXT NOT NULL DEFAULT 'pending',
      tracking_number TEXT,
      carrier TEXT,
      tracking_token TEXT UNIQUE NOT NULL,
      timeline_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_reseller_orders_supp ON reseller_orders(supplier_order_id);
    CREATE INDEX IF NOT EXISTS idx_reseller_orders_ext ON reseller_orders(external_order_id);
    CREATE INDEX IF NOT EXISTS idx_reseller_orders_email ON reseller_orders(customer_email);
    CREATE INDEX IF NOT EXISTS idx_reseller_orders_pstatus ON reseller_orders(payment_status);
    CREATE INDEX IF NOT EXISTS idx_reseller_orders_status ON reseller_orders(local_status);

    -- Reseller Order Line Items
    CREATE TABLE IF NOT EXISTS reseller_order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      reseller_id TEXT NOT NULL DEFAULT 'default',
      product_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      supplier_item_id TEXT NOT NULL,
      item_name TEXT NOT NULL,
      variant_label TEXT,
      quantity INTEGER NOT NULL,
      unit_supplier_cost REAL NOT NULL DEFAULT 0,
      unit_customer_price REAL NOT NULL,
      total_price REAL NOT NULL,
      FOREIGN KEY(order_id) REFERENCES reseller_orders(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_order_items_order ON reseller_order_items(order_id);

    -- Reseller Users & RBAC
    CREATE TABLE IF NOT EXISTS reseller_users (
      id TEXT PRIMARY KEY,
      reseller_id TEXT NOT NULL DEFAULT 'default',
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'VIEWER',
      permissions_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_login_at TEXT
    );

    -- User Session Tokens
    CREATE TABLE IF NOT EXISTS user_sessions (
      session_token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(user_id) REFERENCES reseller_users(id) ON DELETE CASCADE
    );

    -- Webhook Events & Outgoing Deliveries
    CREATE TABLE IF NOT EXISTS webhook_events (
      id TEXT PRIMARY KEY,
      event_id TEXT UNIQUE NOT NULL,
      event_type TEXT NOT NULL,
      order_id TEXT,
      supplier_order_id TEXT,
      payload_json TEXT NOT NULL,
      direction TEXT NOT NULL DEFAULT 'INCOMING',
      status TEXT NOT NULL DEFAULT 'processed',
      attempts INTEGER NOT NULL DEFAULT 1,
      last_attempt_at TEXT NOT NULL DEFAULT (datetime('now')),
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_webhook_event_id ON webhook_events(event_id);
    CREATE INDEX IF NOT EXISTS idx_webhook_type ON webhook_events(event_type);

    -- API Request Logs
    CREATE TABLE IF NOT EXISTS api_request_logs (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      reseller_id TEXT NOT NULL DEFAULT 'default',
      method TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      status_code INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      is_error INTEGER NOT NULL DEFAULT 0,
      error_details TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_api_logs_created ON api_request_logs(created_at);

    -- Sync Logs
    CREATE TABLE IF NOT EXISTS sync_logs (
      id TEXT PRIMARY KEY,
      reseller_id TEXT NOT NULL DEFAULT 'default',
      sync_type TEXT NOT NULL,
      items_synced INTEGER NOT NULL DEFAULT 0,
      items_updated INTEGER NOT NULL DEFAULT 0,
      items_disabled INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL,
      status TEXT NOT NULL,
      error_message TEXT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Store Settings
    CREATE TABLE IF NOT EXISTS store_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Safe schema migrations
  try { db.exec(`ALTER TABLE reseller_orders ADD COLUMN payment_proof_path TEXT;`); } catch { }
  try { db.exec(`ALTER TABLE reseller_orders ADD COLUMN payment_reference TEXT;`); } catch { }
  try { db.exec(`ALTER TABLE reseller_orders ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'pending';`); } catch { }
  try { db.exec(`ALTER TABLE reseller_orders ADD COLUMN rejection_reason TEXT;`); } catch { }
  try { db.exec(`ALTER TABLE reseller_orders ADD COLUMN payment_proof_submitted INTEGER NOT NULL DEFAULT 0;`); } catch { }
  try { db.exec(`ALTER TABLE reseller_orders ADD COLUMN payment_proof_sent_to_discord INTEGER NOT NULL DEFAULT 0;`); } catch { }
  try { db.exec(`ALTER TABLE reseller_orders ADD COLUMN payment_proof_sent_at TEXT;`); } catch { }
  try { db.exec(`ALTER TABLE reseller_orders ADD COLUMN discord_event_id TEXT;`); } catch { }
  try { db.exec(`ALTER TABLE reseller_orders ADD COLUMN customer_data_json TEXT NOT NULL DEFAULT '{}';`); } catch { }
  try { db.exec(`ALTER TABLE reseller_orders ADD COLUMN customer_notes TEXT;`); } catch { }
  try { db.exec(`ALTER TABLE reseller_products ADD COLUMN custom_fields_json TEXT NOT NULL DEFAULT '[]';`); } catch { }
  try { db.exec(`ALTER TABLE reseller_products ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0;`); } catch { }
  try { db.exec(`ALTER TABLE reseller_categories ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0;`); } catch { }
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_reseller_prod_hidden ON reseller_products(is_hidden);`); } catch { }
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_reseller_cat_hidden ON reseller_categories(is_hidden);`); } catch { }
  try { db.exec(`ALTER TABLE reseller_users ADD COLUMN discord_id TEXT;`); } catch { }
  try { db.exec(`ALTER TABLE reseller_users ADD COLUMN avatar_url TEXT;`); } catch { }
  try { db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_reseller_users_discord ON reseller_users(discord_id) WHERE discord_id IS NOT NULL;`); } catch { }

  // Initialize Default Store Settings
  const insertSetting = db.prepare(`INSERT OR REPLACE INTO store_settings (key, value) VALUES (?, ?)`);
  insertSetting.run('store_name', config.store.name);
  insertSetting.run('tagline', config.store.tagline);
  insertSetting.run('currency', config.store.currency);
  insertSetting.run('currency_symbol', config.store.currencySymbol);
  insertSetting.run('support_whatsapp', config.store.whatsapp);
  insertSetting.run('support_discord', config.store.discord);
  insertSetting.run('support_tiktok', config.store.tiktok);
  insertSetting.run('default_margin_percent', String(config.admin.defaultMarginPercent));
  if (config.store.logoUrl) {
    insertSetting.run('logo_url', config.store.logoUrl);
  }

  // Initialize Default Payment Methods (Vodafone Cash, InstaPay, Bank Transfer)
  const checkMethods = db.prepare(`SELECT COUNT(*) as count FROM payment_methods`).get();
  if (checkMethods.count === 0) {
    const insertPm = db.prepare(`
      INSERT INTO payment_methods (id, name, name_ar, type, account_number, account_name, instructions, instructions_ar, logo_icon, sort_order, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);

    insertPm.run(
      'pm_instapay',
      'InstaPay (Egypt)',
      'إنستاباي (InstaPay)',
      'INSTAPAY',
      'Gamingstore@instapay',
      'Gaming Digital Commerce',
      'Transfer the exact amount to our InstaPay IPA address. Take a screenshot of the receipt and upload it below.',
      'قم بتحويل المبلغ المطلوب بدقة إلى عنوان إنستاباي الموضح، ثم التقط صورة أو سكرين شوت لإيصال التحويل وارفقها بالأسفل.',
      '⚡',
      1
    );

    insertPm.run(
      'pm_vodafone_cash',
      'Vodafone Cash / Mobile Wallet',
      'فودافون كاش ومحافظ المحمول',
      'WALLET',
      '01012345678',
      'Gaming Store Wallet',
      'Send the exact order amount to our Vodafone Cash number. Save the transfer confirmation SMS or screenshot and upload it.',
      'قم بتحويل قيمة الطلب إلى رقم فودافون كاش الموضح، ثم ارفع صورة رسالة تأكيد التحويل لتأكيد طلبك فورا.',
      '📱',
      2
    );

    insertPm.run(
      'pm_bank_transfer',
      'Bank Transfer (CIB / NBE)',
      'تحويل بنكي مباشر',
      'BANK',
      'EG12000000123456789012345',
      'Gaming Digital Commerce LLC',
      'Direct IBAN transfer. Please upload deposit slip or banking app transfer receipt.',
      'تحويل بنكي مباشر عبر الآيبان (IBAN). يرجى إرفاق إشعار التحويل البنكي.',
      '🏛️',
      3
    );
  }

  // Purge legacy password-based admin accounts to enforce Discord OAuth2 exclusivity
  try {
    db.prepare(`DELETE FROM reseller_users WHERE id = 'usr_owner_001'`).run();
  } catch { }

  // Zero-Disk and Zero-DB Order Policy: Purge any stored order rows from previous runs
  try {
    db.exec(`DELETE FROM reseller_order_items; DELETE FROM reseller_orders;`);
  } catch { }
}

// Automatically initialize tables on import
initDatabase();

/**
 * Authoritative Data Access Layer (dbHelper)
 */
export const dbHelper = {
  // -------------------------------------------------------------
  // Categories & Margins
  // -------------------------------------------------------------
  upsertCategory(cat, resellerId = 'default') {
    const rawId = String(cat.id || cat.supplier_category_id || 'cat_' + Date.now());
    const supplierCatId = String(cat.supplier_category_id || cat.id || rawId);
    const slug = String(cat.slug || cat.id || cat.supplier_category_id || (cat.name ? cat.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') : 'general'));

    const stmt = db.prepare(`
      INSERT OR REPLACE INTO reseller_categories (
        id, reseller_id, supplier_category_id, parent_id, name, name_ar,
        slug, description, cover_image, sort_order, status, synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);
    stmt.run(
      rawId,
      String(resellerId),
      supplierCatId,
      cat.parent_id ? String(cat.parent_id) : null,
      String(cat.name || 'Category'),
      cat.name_ar ? String(cat.name_ar) : null,
      slug,
      String(cat.description || ''),
      cat.cover_image ? String(cat.cover_image) : null,
      Number(cat.sort_order || 0),
      String(cat.status || 'active')
    );
  },

  getCategories(resellerId = 'default', nonEmptyOnly = false, includeHidden = false) {
    let sql = `
      SELECT * FROM (
        SELECT c.*, COALESCE(c.is_hidden, 0) as is_hidden, m.margin_percent, m.margin_fixed, m.is_active as margin_active,
          (
            SELECT COUNT(*) 
            FROM reseller_products p 
            WHERE p.status = 'active' 
              AND (p.is_hidden IS NULL OR p.is_hidden = 0)
              AND (
                p.category_id = c.id 
                OR p.category_id = c.supplier_category_id 
                OR p.category_id = c.slug 
                OR p.category_id = c.name
                OR p.category_id IN (
                  SELECT sub.id FROM reseller_categories sub 
                  WHERE sub.parent_id = c.id OR sub.parent_id = c.supplier_category_id OR sub.parent_id = c.slug
                )
                OR p.category_id IN (
                  SELECT sub.supplier_category_id FROM reseller_categories sub 
                  WHERE sub.parent_id = c.id OR sub.parent_id = c.supplier_category_id OR sub.parent_id = c.slug
                )
                OR p.category_id IN (
                  SELECT sub.slug FROM reseller_categories sub 
                  WHERE sub.parent_id = c.id OR sub.parent_id = c.supplier_category_id OR sub.parent_id = c.slug
                )
              )
          ) as product_count
        FROM reseller_categories c
        LEFT JOIN category_margins m ON (c.supplier_category_id = m.category_id OR c.id = m.category_id)
        WHERE c.reseller_id = ? AND c.status = 'active'
      )
    `;

    const conditions = [];
    if (!includeHidden) {
      conditions.push(`(is_hidden IS NULL OR is_hidden = 0)`);
    }

    if (nonEmptyOnly) {
      conditions.push(`product_count > 0`);
    }

    if (conditions.length > 0) {
      sql += ` WHERE ` + conditions.join(' AND ');
    }

    sql += ` ORDER BY sort_order ASC, name ASC`;
    const stmt = db.prepare(sql);
    return stmt.all(resellerId);
  },

  getCategoryBySlugOrId(slugOrId, resellerId = 'default') {
    const stmt = db.prepare(`
      SELECT * FROM reseller_categories 
      WHERE reseller_id = ? AND (slug = ? OR supplier_category_id = ? OR id = ?)
    `);
    return stmt.get(resellerId, slugOrId, slugOrId, slugOrId);
  },

  getCategoryTree(resellerId = 'default', nonEmptyOnly = true) {
    const all = this.getCategories(resellerId, false);
    const map = {};
    const roots = [];

    all.forEach(c => {
      map[c.supplier_category_id || c.id] = { ...c, children: [] };
    });

    all.forEach(c => {
      const node = map[c.supplier_category_id || c.id];
      if (c.parent_id && map[c.parent_id]) {
        map[c.parent_id].children.push(node);
      } else {
        roots.push(node);
      }
    });

    if (nonEmptyOnly) {
      const filterTree = (nodes) => {
        return nodes.filter(node => {
          if (node.children && node.children.length > 0) {
            node.children = filterTree(node.children);
          }
          const hasChildren = node.children && node.children.length > 0;
          const hasProducts = (node.product_count || 0) > 0;
          return hasProducts || hasChildren;
        });
      };
      return filterTree(roots);
    }

    return roots;
  },

  getCategoryMargins() {
    const cats = this.getCategories('default', false);
    const margins = db.prepare(`SELECT * FROM category_margins`).all();
    const marginMap = {};
    margins.forEach(m => { marginMap[m.category_id] = m; });

    return cats.map(cat => ({
      category_id: cat.supplier_category_id || cat.id,
      name: cat.name,
      name_ar: cat.name_ar,
      slug: cat.slug,
      parent_id: cat.parent_id,
      margin_percent: marginMap[cat.supplier_category_id || cat.id]?.margin_percent ?? config.admin.defaultMarginPercent,
      margin_fixed: marginMap[cat.supplier_category_id || cat.id]?.margin_fixed ?? 0,
      is_active: marginMap[cat.supplier_category_id || cat.id]?.is_active !== 0
    }));
  },

  saveCategoryMargin(categoryId, marginPercent, marginFixed = 0, isActive = 1) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO category_margins (category_id, margin_percent, margin_fixed, is_active, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `);
    stmt.run(categoryId, Number(marginPercent), Number(marginFixed), isActive ? 1 : 0);
  },

  getEffectiveMarginForCategory(categoryId) {
    if (!categoryId) return config.admin.defaultMarginPercent;

    const row = db.prepare(`
      SELECT m.margin_percent, m.margin_fixed, m.is_active, c.parent_id 
      FROM category_margins m 
      LEFT JOIN reseller_categories c ON (m.category_id = c.id OR m.category_id = c.supplier_category_id)
      WHERE m.category_id = ?
    `).get(categoryId);

    if (row && row.is_active) {
      return row.margin_percent;
    }

    // Check parent category if this was a subcategory
    if (row && row.parent_id) {
      const parentRow = db.prepare(`SELECT margin_percent, is_active FROM category_margins WHERE category_id = ?`).get(row.parent_id);
      if (parentRow && parentRow.is_active) {
        return parentRow.margin_percent;
      }
    }

    return config.admin.defaultMarginPercent;
  },

  // -------------------------------------------------------------
  // Products & Purchasable Items
  // -------------------------------------------------------------
  upsertProduct(p, resellerId = 'default') {
    let catId = p.category_id;
    if (!catId && p.category) catId = p.category;
    if (typeof catId === 'object' && catId !== null) {
      catId = catId.id || catId.slug || catId.name;
    }
    catId = String(catId || 'general');

    const stmt = db.prepare(`
      INSERT OR REPLACE INTO reseller_products (
        id, reseller_id, supplier_product_id, category_id, name, name_ar,
        slug, description, description_ar, images_json, option_groups_json,
        custom_fields_json, has_variants, price_base, currency, stock_available, stock_quantity,
        status, sort_order, supplier_updated_at, synced_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now')
      )
    `);

    stmt.run(
      String(p.id),
      String(resellerId),
      String(p.supplier_product_id || p.id),
      catId,
      String(p.name || 'Product'),
      p.name_ar ? String(p.name_ar) : null,
      String(p.slug || p.id),
      String(p.description || ''),
      p.description_ar ? String(p.description_ar) : null,
      JSON.stringify(p.images || []),
      JSON.stringify(p.option_groups || []),
      JSON.stringify(p.custom_fields || []),
      p.has_variants ? 1 : 0,
      Number(p.price_base || 0),
      String(p.currency || 'EGP'),
      p.stock_available ? 1 : 0,
      Number(p.stock_quantity ?? 50),
      String(p.status || 'active'),
      Number(p.sort_order || 0),
      p.supplier_updated_at ? String(p.supplier_updated_at) : null
    );

    if (Array.isArray(p.items)) {
      p.items.forEach(it => this.upsertItem(it, p.id, resellerId));
    }
  },

  upsertItem(it, productId, resellerId = 'default') {
    const basePrice = Number(it.base_price || 0);
    const isPriced = basePrice > 0;
    const isAvailable = isPriced && Boolean(it.is_available);
    const stockStatus = isAvailable ? 'IN_STOCK' : 'OUT_OF_STOCK';

    const stmt = db.prepare(`
      INSERT OR REPLACE INTO reseller_items (
        id, reseller_id, supplier_item_id, product_id, name, edition_label,
        sku, selection_json, base_price, currency, stock_status,
        stock_quantity, is_available, status, synced_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now')
      )
    `);

    stmt.run(
      String(it.id),
      String(resellerId),
      String(it.supplier_item_id || it.id),
      String(productId),
      String(it.name || it.edition_label || 'Standard Option'),
      it.edition_label ? String(it.edition_label) : null,
      it.sku ? String(it.sku) : null,
      JSON.stringify(it.selection || {}),
      basePrice,
      String(it.currency || 'EGP'),
      stockStatus,
      Number(it.stock_quantity ?? 50),
      isAvailable ? 1 : 0,
      String(it.status || 'active')
    );
  },

  getProducts({ category, search, inStockOnly, sort = 'newest', limit = 50, offset = 0, resellerId = 'default', includeHidden = false } = {}) {
    let query = `SELECT * FROM reseller_products WHERE reseller_id = ? AND status = 'active'`;
    const params = [resellerId];

    if (!includeHidden) {
      query += ` AND (is_hidden IS NULL OR is_hidden = 0)`;
      query += ` AND (
        category_id NOT IN (SELECT supplier_category_id FROM reseller_categories WHERE is_hidden = 1)
        AND category_id NOT IN (SELECT id FROM reseller_categories WHERE is_hidden = 1)
        AND category_id NOT IN (SELECT slug FROM reseller_categories WHERE is_hidden = 1)
      )`;
    }

    if (category && category !== 'all') {
      query += ` AND (
        category_id = ? 
        OR category_id IN (SELECT id FROM reseller_categories WHERE slug = ? OR supplier_category_id = ? OR parent_id = ? OR id = ?)
        OR category_id IN (SELECT supplier_category_id FROM reseller_categories WHERE slug = ? OR supplier_category_id = ? OR parent_id = ? OR id = ?)
        OR category_id IN (SELECT slug FROM reseller_categories WHERE slug = ? OR supplier_category_id = ? OR parent_id = ? OR id = ?)
      )`;
      params.push(
        category,
        category, category, category, category,
        category, category, category, category,
        category, category, category, category
      );
    }

    if (search && search.trim()) {
      query += ` AND (name LIKE ? OR description LIKE ? OR name_ar LIKE ?)`;
      const term = `%${search.trim()}%`;
      params.push(term, term, term);
    }

    if (inStockOnly) {
      query += ` AND stock_available = 1`;
    }

    if (sort === 'price_asc') {
      query += ` ORDER BY price_base ASC`;
    } else if (sort === 'price_desc') {
      query += ` ORDER BY price_base DESC`;
    } else {
      query += ` ORDER BY sort_order ASC, created_at DESC`;
    }

    query += ` LIMIT ? OFFSET ?`;
    params.push(Number(limit), Number(offset));

    const stmt = db.prepare(query);
    const rows = stmt.all(...params);

    return rows.map(r => this.hydrateProduct(r));
  },

  getProductByIdOrSlug(idOrSlug, resellerId = 'default', includeHidden = false) {
    let sql = `
      SELECT * FROM reseller_products 
      WHERE reseller_id = ? AND (id = ? OR supplier_product_id = ? OR slug = ?)
    `;
    if (!includeHidden) {
      sql += ` AND (is_hidden IS NULL OR is_hidden = 0)`;
    }
    const stmt = db.prepare(sql);
    const row = stmt.get(resellerId, idOrSlug, idOrSlug, idOrSlug);
    if (!row) return null;
    return this.hydrateProduct(row);
  },

  toggleProductVisibility(productId, isHidden = null, resellerId = 'default') {
    const prod = this.getProductByIdOrSlug(productId, resellerId, true);
    if (!prod) return null;
    const newHidden = isHidden !== null ? (isHidden ? 1 : 0) : (prod.is_hidden ? 0 : 1);
    const stmt = db.prepare(`UPDATE reseller_products SET is_hidden = ? WHERE id = ? OR supplier_product_id = ? OR slug = ?`);
    stmt.run(newHidden, prod.id, prod.supplier_product_id || prod.id, prod.slug);
    return { id: prod.id, name: prod.name, is_hidden: Boolean(newHidden) };
  },

  toggleCategoryVisibility(categoryId, isHidden = null, resellerId = 'default') {
    const cat = this.getCategoryBySlugOrId(categoryId, resellerId);
    if (!cat) return null;
    const currentHidden = Boolean(cat.is_hidden);
    const newHidden = isHidden !== null ? (isHidden ? 1 : 0) : (currentHidden ? 0 : 1);
    const stmt = db.prepare(`UPDATE reseller_categories SET is_hidden = ? WHERE id = ? OR supplier_category_id = ? OR slug = ?`);
    stmt.run(newHidden, cat.id, cat.supplier_category_id || cat.id, cat.slug);
    return { id: cat.id, slug: cat.slug, name: cat.name, is_hidden: Boolean(newHidden) };
  },

  getHiddenCatalogOverrides(resellerId = 'default') {
    const hiddenProds = db.prepare(`SELECT id, supplier_product_id, slug FROM reseller_products WHERE is_hidden = 1 AND reseller_id = ?`).all(resellerId);
    const hiddenCats = db.prepare(`SELECT id, supplier_category_id, slug FROM reseller_categories WHERE is_hidden = 1 AND reseller_id = ?`).all(resellerId);
    return {
      hiddenProductIds: hiddenProds.map(p => p.supplier_product_id || p.id),
      hiddenCategoryIds: hiddenCats.map(c => c.supplier_category_id || c.slug || c.id)
    };
  },

  applyCatalogOverrides({ hiddenProductIds = [], hiddenCategoryIds = [] } = {}) {
    if (Array.isArray(hiddenProductIds) && hiddenProductIds.length > 0) {
      const stmt = db.prepare(`UPDATE reseller_products SET is_hidden = 1 WHERE id = ? OR supplier_product_id = ? OR slug = ?`);
      hiddenProductIds.forEach(id => stmt.run(String(id), String(id), String(id)));
    }
    if (Array.isArray(hiddenCategoryIds) && hiddenCategoryIds.length > 0) {
      const stmt = db.prepare(`UPDATE reseller_categories SET is_hidden = 1 WHERE id = ? OR supplier_category_id = ? OR slug = ?`);
      hiddenCategoryIds.forEach(id => stmt.run(String(id), String(id), String(id)));
    }
  },

  resolveVariantDisplayName(variant, optionGroups = []) {
    const selection = variant.selection || {};
    const selKeys = Object.keys(selection);

    if (selKeys.length === 0) {
      const rawEd = variant.edition_label || variant.name || '';
      if (!rawEd || /^(Standard|Standard Edition|Standard License)$/i.test(rawEd.trim())) {
        return 'النسخة القياسية';
      }
      return rawEd.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s{2,}/g, ' ').trim() || rawEd;
    }

    const labels = [];
    if (Array.isArray(optionGroups) && optionGroups.length > 0) {
      for (const [key, val] of Object.entries(selection)) {
        if (!val) continue;
        const group = optionGroups.find(g => g.id === key);
        let choiceLabel = null;
        if (group && Array.isArray(group.choices)) {
          const choice = group.choices.find(c => String(c.id).trim().toLowerCase() === String(val).trim().toLowerCase());
          if (choice) {
            choiceLabel = (typeof choice.label === 'object' ? (choice.label.ar || choice.label.en) : choice.label) || choice.name;
          }
        }
        if (!choiceLabel) {
          choiceLabel = String(val);
        }

        let cleanChoice = String(choiceLabel).trim()
          .replace(/^1\s*EA$/i, '1 شهر')
          .replace(/^1\s*yr$/i, '1 سنة')
          .replace(/^mo\s*1$/i, '1 شهر')
          .replace(/^1\s*mo$/i, '1 شهر')
          .replace(/^ea-1$/i, '1 شهر')
          .replace(/^1-yr$/i, '1 سنة')
          .replace(/^mo-1$/i, '1 شهر');

        // Ignore generic 'main' section labels that are just containers
        if (/^(main|الأساسي)$/i.test(cleanChoice)) continue;

        // Clean up common English identifiers
        if (cleanChoice.toLowerCase() === 'playstation') cleanChoice = 'PlayStation';
        if (cleanChoice.toLowerCase() === 'xbox') cleanChoice = 'Xbox';
        if (cleanChoice.toLowerCase() === 'pc') cleanChoice = 'PC';
        if (cleanChoice.toLowerCase() === 'acc') cleanChoice = 'حساب';
        if (cleanChoice.toLowerCase() === 'gift') cleanChoice = 'هدية';
        if (cleanChoice.toLowerCase() === 'offline') cleanChoice = 'أوفلاين';
        if (cleanChoice.toLowerCase() === 'primary') cleanChoice = 'أساسي';
        if (cleanChoice.toLowerCase() === 'secondary') cleanChoice = 'ثانوي';

        labels.push(cleanChoice);
      }
    }

    // Fallback if optionGroups parsing yielded nothing from selection
    if (labels.length === 0) {
      for (const [k, v] of Object.entries(selection)) {
        if (!v) continue;
        let formatted = String(v).trim()
          .replace(/[-_]+/g, ' ')
          .replace(/([a-z])([A-Z])/g, '$1 $2')
          .replace(/\bv (\d+)/i, '$1 V-Bucks')
          .replace(/\bcoin (\d+)/i, '$1 Coins')
          .replace(/\b(\d+) yr\b/i, '$1 Year')
          .replace(/\b(\d+) mo\b/i, '$1 Month')
          .replace(/\bmo (\d+)/i, '$1 Month')
          .replace(/\bea 1\b/i, '1 Month')
          .replace(/\bacc\b/i, 'حساب')
          .replace(/\bgift\b/i, 'هدية')
          .replace(/\boffline\b/i, 'أوفلاين')
          .replace(/\bprimary\b/i, 'أساسي')
          .replace(/\bsecondary\b/i, 'ثانوي')
          .trim();
        if (formatted && !/^(main|الأساسي)$/i.test(formatted)) {
          labels.push(formatted);
        }
      }
    }

    // Filter redundancies:
    // 1. If we have 'PS4' or 'PS5' along with 'بلايستيشن' or 'PlayStation', drop 'بلايستيشن'/'PlayStation'
    const hasPsSub = labels.some(l => /^PS[45]/i.test(l));
    let filtered = labels;
    if (hasPsSub) {
      filtered = filtered.filter(l => !/^(بلايستيشن|playstation)$/i.test(l));
    }

    // 2. If a later label already contains the whole earlier label (e.g. '39 Silver' contains 'Silver'), drop the earlier label
    filtered = filtered.filter((label, idx) => {
      const norm = label.toLowerCase().trim();
      if (norm.length < 2) return true;
      for (let j = 0; j < filtered.length; j++) {
        if (j !== idx) {
          const other = filtered[j].toLowerCase().trim();
          if (other.length > norm.length && other.includes(norm)) {
            return false;
          }
        }
      }
      return true;
    });

    // 3. Drop duplicate consecutive words or exact duplicates
    const unique = [];
    for (const item of filtered) {
      if (!unique.some(u => u.toLowerCase() === item.toLowerCase())) {
        unique.push(item);
      }
    }

    if (unique.length > 0) {
      return unique.join(' - ');
    }

    const rawEd = variant.edition_label || variant.name || 'النسخة القياسية';
    return rawEd.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s{2,}/g, ' ').trim() || rawEd;
  },

  hydrateProduct(row) {
    const marginPercent = this.getEffectiveMarginForCategory(row.category_id);
    const multiplier = 1 + (marginPercent / 100);
    const optionGroups = JSON.parse(row.option_groups_json || '[]');

    const itemsStmt = db.prepare(`
      SELECT * FROM reseller_items 
      WHERE product_id = ? AND status = 'active'
      ORDER BY (base_price > 0) DESC, base_price ASC, id ASC
    `);

    const items = itemsStmt.all(row.id).map(it => {
      const customerPrice = Math.round((it.base_price * multiplier) * 100) / 100;
      const isPriced = it.base_price > 0 && customerPrice > 0;
      const isAvailable = isPriced && Boolean(it.is_available);
      const selection = JSON.parse(it.selection_json || '{}');
      const resolvedName = this.resolveVariantDisplayName({ ...it, selection }, optionGroups);

      return {
        id: it.id,
        supplier_item_id: it.supplier_item_id,
        product_id: it.product_id,
        name: resolvedName,
        edition_label: resolvedName,
        display_name: resolvedName,
        sku: it.sku,
        selection,
        price: customerPrice,
        base_price: it.base_price,
        currency: it.currency,
        stock_status: isAvailable ? 'IN_STOCK' : 'OUT_OF_STOCK',
        stock_quantity: isAvailable ? it.stock_quantity : 0,
        is_available: isAvailable,
        status: it.status
      };
    });

    const availableItems = items.filter(it => it.is_available && it.price > 0);
    const startingPrice = availableItems.length > 0
      ? availableItems[0].price
      : (items.length > 0 ? items[0].price : Math.round((row.price_base * multiplier) * 100) / 100);

    const isProductAvailable = availableItems.length > 0 && Boolean(row.stock_available);

    return {
      id: row.id,
      supplier_product_id: row.supplier_product_id,
      category_id: row.category_id,
      category: row.category_id,
      name: row.name,
      name_ar: row.name_ar,
      slug: row.slug,
      description: row.description,
      description_ar: row.description_ar,
      images: JSON.parse(row.images_json || '[]'),
      option_groups: optionGroups,
      custom_fields: JSON.parse(row.custom_fields_json || '[]'),
      has_variants: Boolean(row.has_variants),
      price: startingPrice,
      currency: row.currency,
      stock_quantity: isProductAvailable ? row.stock_quantity : 0,
      is_available: isProductAvailable,
      is_hidden: Boolean(row.is_hidden),
      items,
      variants: items,
      status: row.status,
      supplier_updated_at: row.supplier_updated_at,
      synced_at: row.synced_at
    };
  },

  getItemById(itemId, resellerId = 'default') {
    const stmt = db.prepare(`
      SELECT i.*, p.category_id, p.name as product_name, p.slug as product_slug, p.option_groups_json
      FROM reseller_items i
      JOIN reseller_products p ON i.product_id = p.id
      WHERE i.reseller_id = ? AND (i.id = ? OR i.supplier_item_id = ?)
    `);
    const row = stmt.get(resellerId, itemId, itemId);
    if (!row) return null;

    const marginPercent = this.getEffectiveMarginForCategory(row.category_id);
    const multiplier = 1 + (marginPercent / 100);
    const customerPrice = Math.round((row.base_price * multiplier) * 100) / 100;
    const isPriced = row.base_price > 0 && customerPrice > 0;
    const isAvailable = isPriced && Boolean(row.is_available);
    const selection = JSON.parse(row.selection_json || '{}');
    const optionGroups = JSON.parse(row.option_groups_json || '[]');
    const resolvedName = this.resolveVariantDisplayName({ ...row, selection }, optionGroups);

    return {
      id: row.id,
      supplier_item_id: row.supplier_item_id,
      product_id: row.product_id,
      product_name: row.product_name,
      product_slug: row.product_slug,
      category_id: row.category_id,
      name: resolvedName,
      edition_label: resolvedName,
      display_name: resolvedName,
      sku: row.sku,
      selection,
      base_price: row.base_price,
      price: customerPrice,
      currency: row.currency,
      stock_status: isAvailable ? 'IN_STOCK' : 'OUT_OF_STOCK',
      stock_quantity: isAvailable ? row.stock_quantity : 0,
      is_available: isAvailable,
      status: row.status
    };
  },

  // -------------------------------------------------------------
  // Payment Methods
  // -------------------------------------------------------------
  getPaymentMethods(activeOnly = false) {
    let query = `SELECT * FROM payment_methods`;
    if (activeOnly) query += ` WHERE is_active = 1`;
    query += ` ORDER BY sort_order ASC, name ASC`;
    return db.prepare(query).all();
  },

  getPaymentMethodById(id) {
    return db.prepare(`SELECT * FROM payment_methods WHERE id = ?`).get(id);
  },

  upsertPaymentMethod(pm) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO payment_methods (
        id, name, name_ar, type, account_number, account_name,
        instructions, instructions_ar, logo_icon, sort_order, is_active, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);
    stmt.run(
      pm.id || `pm_${crypto.randomUUID().slice(0, 8)}`,
      pm.name,
      pm.name_ar || pm.name,
      pm.type || 'WALLET',
      pm.account_number,
      pm.account_name || null,
      pm.instructions || '',
      pm.instructions_ar || pm.instructions || '',
      pm.logo_icon || '💳',
      Number(pm.sort_order || 0),
      pm.is_active ? 1 : 0
    );
  },

  deletePaymentMethod(id) {
    db.prepare(`DELETE FROM payment_methods WHERE id = ?`).run(id);
  },

  // -------------------------------------------------------------
  // Ephemeral In-Memory Orders (Zero Website Database Storage)
  // Orders are dispatched exclusively to Discord Webhook
  // -------------------------------------------------------------
  createOrder(orderData) {
    const orderId = orderData.id || `ord_${crypto.randomUUID()}`;
    const orderItems = (orderData.items || []).map((it, idx) => {
      const price = Number(it.price || it.unit_customer_price || 0);
      const cost = Number(it.unit_supplier_cost || it.base_price || 0);
      const qty = Number(it.quantity || 1);
      return {
        id: it.id || `ord_item_${orderId}_${idx}`,
        order_id: orderId,
        reseller_id: orderData.reseller_id || 'default',
        product_id: it.product_id || it.item_id || 'unknown',
        item_id: it.item_id || it.id || 'unknown',
        supplier_item_id: it.supplier_item_id || it.item_id || it.id || 'unknown',
        item_name: it.item_name || it.name || 'Purchasable Item',
        variant_label: it.variant_label || it.edition_label || it.name || null,
        quantity: qty,
        unit_supplier_cost: cost,
        unit_customer_price: price,
        total_price: price * qty
      };
    });

    const orderObj = {
      id: orderId,
      reseller_id: orderData.reseller_id || 'default',
      reseller_order_id: orderData.reseller_order_id,
      supplier_order_id: orderData.supplier_order_id || null,
      external_order_id: orderData.external_order_id,
      order_number: orderData.reseller_order_id,
      idempotency_key: orderData.idempotency_key,
      customer_name: orderData.customer_name,
      customer_email: orderData.customer_email,
      customer_phone: orderData.customer_phone,
      customer_data: orderData.customer_data || orderData.custom_fields || {},
      customer_notes: orderData.customer_notes || orderData.notes || null,
      items: orderItems,
      subtotal: orderData.subtotal,
      tax: orderData.tax || 0,
      shipping_fee: orderData.shipping_fee || 0,
      total: orderData.total,
      currency: orderData.currency || 'EGP',
      supplier_cost: orderData.supplier_cost || 0,
      reseller_profit: orderData.reseller_profit || 0,
      payment_method_id: orderData.payment_method_id || null,
      payment_method_name: orderData.payment_method_name || null,
      payment_reference: orderData.payment_reference || null,
      payment_proof_submitted: false,
      payment_proof_sent_to_discord: false,
      payment_proof_sent_at: null,
      discord_event_id: null,
      discord_delivery_status: 'pending',
      payment_status: orderData.payment_status || 'pending',
      supplier_status: orderData.supplier_status || 'pending',
      local_status: orderData.local_status || 'pending',
      tracking_token: orderData.tracking_token,
      timeline: orderData.timeline || [
        { status: 'order_created', timestamp: new Date().toISOString(), note: 'Order registered awaiting payment' }
      ],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    ephemeralOrders.set(orderId, orderObj);
    ephemeralOrders.set(orderObj.reseller_order_id, orderObj);
    if (orderObj.tracking_token) ephemeralOrders.set(orderObj.tracking_token, orderObj);
    if (orderObj.external_order_id) ephemeralOrders.set(orderObj.external_order_id, orderObj);

    return orderObj;
  },

  getOrderById(idOrOrderNum) {
    if (!idOrOrderNum) return null;
    const str = String(idOrOrderNum);
    if (ephemeralOrders.has(str)) return ephemeralOrders.get(str);
    for (const ord of ephemeralOrders.values()) {
      if (
        ord.id === str ||
        ord.reseller_order_id === str ||
        ord.external_order_id === str ||
        ord.supplier_order_id === str ||
        ord.tracking_token === str
      ) {
        return ord;
      }
    }
    return null;
  },

  getOrderByExternalOrIdemp(externalId, idempKey) {
    for (const ord of ephemeralOrders.values()) {
      if ((externalId && ord.external_order_id === externalId) || (idempKey && ord.idempotency_key === idempKey)) {
        return ord;
      }
    }
    return null;
  },

  submitPaymentProof(orderId, { payment_method_id, payment_method_name, reference, supplier_order_id, supplier_status, sent_to_discord = 0, discord_event_id = null, sent_at = null, delivery_status = 'pending' }) {
    const existing = this.getOrderById(orderId);
    if (!existing) return null;

    if (supplier_order_id) existing.supplier_order_id = supplier_order_id;
    if (supplier_status) existing.supplier_status = supplier_status;
    existing.payment_method_id = payment_method_id || existing.payment_method_id;
    existing.payment_method_name = payment_method_name || existing.payment_method_name;
    existing.payment_reference = reference || existing.payment_reference;
    existing.payment_proof_submitted = true;
    existing.payment_proof_sent_to_discord = Boolean(sent_to_discord);
    existing.payment_proof_sent_at = sent_at || (sent_to_discord ? new Date().toISOString() : null);
    existing.discord_event_id = discord_event_id || existing.discord_event_id;
    existing.discord_delivery_status = delivery_status || (sent_to_discord ? 'delivered' : 'pending');
    existing.payment_status = 'payment_submitted';
    existing.local_status = 'payment_submitted';
    existing.updated_at = new Date().toISOString();

    existing.timeline = existing.timeline || [];
    existing.timeline.push({
      status: 'payment_submitted',
      timestamp: new Date().toISOString(),
      note: `Payment proof received and dispatched to Discord via ${payment_method_name || 'selected method'}`
    });

    return existing;
  },

  updateDiscordWebhookStatus(orderId, { sent_to_discord, discord_event_id, sent_at, delivery_status }) {
    const existing = this.getOrderById(orderId);
    if (!existing) return null;

    existing.payment_proof_sent_to_discord = Boolean(sent_to_discord);
    existing.payment_proof_sent_at = sent_at || existing.payment_proof_sent_at;
    existing.discord_event_id = discord_event_id || existing.discord_event_id;
    existing.discord_delivery_status = delivery_status || (sent_to_discord ? 'delivered' : 'failed');
    existing.updated_at = new Date().toISOString();

    return existing;
  },

  approvePayment(orderId, { note } = {}) {
    const existing = this.getOrderById(orderId);
    if (!existing) return null;

    existing.payment_status = 'paid';
    existing.local_status = 'paid';
    existing.timeline = existing.timeline || [];
    existing.timeline.push({
      status: 'payment_approved',
      timestamp: new Date().toISOString(),
      note: note || 'Payment verified and approved by admin'
    });
    existing.updated_at = new Date().toISOString();

    return existing;
  },

  rejectPayment(orderId, { reason } = {}) {
    const existing = this.getOrderById(orderId);
    if (!existing) return null;

    existing.payment_status = 'rejected';
    existing.rejection_reason = reason || 'Invalid payment receipt';
    existing.timeline = existing.timeline || [];
    existing.timeline.push({
      status: 'payment_rejected',
      timestamp: new Date().toISOString(),
      note: `Payment rejected: ${reason || 'Receipt unreadable or invalid'}`
    });
    existing.updated_at = new Date().toISOString();

    return existing;
  },

  updateOrderStatus(orderId, { supplier_status, local_status, supplier_order_id, tracking_number, carrier, note }) {
    const existing = this.getOrderById(orderId);
    if (!existing) return null;

    if (supplier_status) existing.supplier_status = supplier_status;
    if (local_status) existing.local_status = local_status;
    if (supplier_order_id) existing.supplier_order_id = supplier_order_id;
    if (tracking_number) existing.tracking_number = tracking_number;
    if (carrier) existing.carrier = carrier;

    existing.timeline = existing.timeline || [];
    if (supplier_status || local_status) {
      existing.timeline.push({
        status: local_status || supplier_status,
        supplier_status,
        timestamp: new Date().toISOString(),
        note: note || `Status updated to ${local_status || supplier_status}`
      });
    }
    existing.updated_at = new Date().toISOString();

    return existing;
  },

  getOrders() {
    // Orders are not stored on the website - dispatched directly to Discord Webhook
    return [];
  },

  // -------------------------------------------------------------
  // RBAC & Authentication
  // -------------------------------------------------------------
  getUserByDiscordId(discordId) {
    if (!discordId) return null;
    const stmt = db.prepare(`SELECT * FROM reseller_users WHERE discord_id = ?`);
    const user = stmt.get(discordId);
    if (!user) return null;
    return {
      ...user,
      permissions: JSON.parse(user.permissions_json || '[]')
    };
  },

  upsertDiscordAdmin({ discordId, username, globalName, avatar }) {
    const avatarUrl = avatar ? `https://cdn.discordapp.com/avatars/${discordId}/${avatar}.png` : '';
    const displayName = globalName || username || 'Admin';
    const email = `${(username || discordId).toLowerCase()}@discord.admin`;
    const ownerPerms = JSON.stringify([
      'view_orders', 'manage_orders', 'view_payments', 'approve_payments',
      'manage_products', 'manage_pricing', 'manage_payment_methods',
      'manage_webhooks', 'manage_users', 'view_analytics', 'manage_settings', '*'
    ]);

    const existing = db.prepare(`SELECT * FROM reseller_users WHERE discord_id = ?`).get(discordId);
    if (existing) {
      db.prepare(`
        UPDATE reseller_users 
        SET name = ?, avatar_url = ?, role = 'OWNER', permissions_json = ?, status = 'active', last_login_at = datetime('now')
        WHERE id = ?
      `).run(displayName, avatarUrl, ownerPerms, existing.id);
      return this.getUserById(existing.id);
    }

    const id = `usr_discord_${discordId}`;
    // Clean up any conflicting record with this id or email
    try { db.prepare(`DELETE FROM reseller_users WHERE id = ? OR email = ?`).run(id, email); } catch { }

    db.prepare(`
      INSERT INTO reseller_users (id, reseller_id, name, email, password_hash, discord_id, avatar_url, role, permissions_json, status, last_login_at)
      VALUES (?, 'default', ?, ?, '', ?, ?, 'OWNER', ?, 'active', datetime('now'))
    `).run(id, displayName, email, discordId, avatarUrl, ownerPerms);

    return this.getUserById(id);
  },

  getUserByEmail(email) {
    const stmt = db.prepare(`SELECT * FROM reseller_users WHERE email = ?`);
    const user = stmt.get(email);
    if (!user) return null;
    return {
      ...user,
      permissions: JSON.parse(user.permissions_json || '[]')
    };
  },

  getUserById(id) {
    const stmt = db.prepare(`SELECT * FROM reseller_users WHERE id = ?`);
    const user = stmt.get(id);
    if (!user) return null;
    return {
      ...user,
      permissions: JSON.parse(user.permissions_json || '[]')
    };
  },

  getUsers(resellerId = 'default') {
    const stmt = db.prepare(`SELECT id, reseller_id, name, email, role, status, created_at, last_login_at FROM reseller_users WHERE reseller_id = ? ORDER BY created_at DESC`);
    return stmt.all(resellerId);
  },

  createUser({ name, email, password_hash, role = 'VIEWER', permissions = [], resellerId = 'default' }) {
    const stmt = db.prepare(`
      INSERT INTO reseller_users (id, reseller_id, name, email, password_hash, role, permissions_json, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
    `);
    const id = `usr_${crypto.randomUUID()}`;
    stmt.run(id, resellerId, name, email, password_hash, role, JSON.stringify(permissions));
    return this.getUserByEmail(email);
  },

  updateUserRole(userId, role, permissions = []) {
    const stmt = db.prepare(`UPDATE reseller_users SET role = ?, permissions_json = ? WHERE id = ?`);
    stmt.run(role, JSON.stringify(permissions), userId);
  },

  toggleUserStatus(userId, status) {
    db.prepare(`UPDATE reseller_users SET status = ? WHERE id = ?`).run(status, userId);
  },

  createSession(userId, days = 7) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    db.prepare(`INSERT INTO user_sessions (session_token, user_id, expires_at) VALUES (?, ?, ?)`).run(token, userId, expiresAt);
    return token;
  },

  getUserBySession(token) {
    if (!token) return null;
    const session = db.prepare(`SELECT * FROM user_sessions WHERE session_token = ? AND expires_at > datetime('now')`).get(token);
    if (!session) return null;
    return this.getUserById(session.user_id);
  },

  deleteSession(token) {
    if (token) db.prepare(`DELETE FROM user_sessions WHERE session_token = ?`).run(token);
  },

  // -------------------------------------------------------------
  // Telemetry, Metrics & Logs
  // -------------------------------------------------------------
  getOverviewMetrics(resellerId = 'default') {
    const revenueRow = db.prepare(`SELECT COALESCE(SUM(total), 0) as rev, COALESCE(SUM(reseller_profit), 0) as prof FROM reseller_orders WHERE reseller_id = ? AND payment_status = 'paid'`).get(resellerId);
    const totalOrdersRow = db.prepare(`SELECT COUNT(*) as cnt FROM reseller_orders WHERE reseller_id = ?`).get(resellerId);
    const pendingPayRow = db.prepare(`SELECT COUNT(*) as cnt FROM reseller_orders WHERE reseller_id = ? AND payment_status = 'payment_submitted'`).get(resellerId);
    const paidOrdersRow = db.prepare(`SELECT COUNT(*) as cnt FROM reseller_orders WHERE reseller_id = ? AND payment_status = 'paid'`).get(resellerId);
    const completedRow = db.prepare(`SELECT COUNT(*) as cnt FROM reseller_orders WHERE reseller_id = ? AND local_status = 'completed'`).get(resellerId);
    const oosRow = db.prepare(`SELECT COUNT(*) as cnt FROM reseller_products WHERE reseller_id = ? AND stock_available = 0`).get(resellerId);
    const totalProductsRow = db.prepare(`SELECT COUNT(*) as cnt FROM reseller_products WHERE reseller_id = ? AND status = 'active'`).get(resellerId);
    const totalCategoriesRow = db.prepare(`SELECT COUNT(*) as cnt FROM reseller_categories WHERE reseller_id = ? AND status = 'active'`).get(resellerId);
    const todayOrdersRow = db.prepare(`SELECT COUNT(*) as cnt FROM reseller_orders WHERE reseller_id = ? AND date(created_at) = date('now')`).get(resellerId);

    return {
      revenue: revenueRow.rev,
      profit: revenueRow.prof,
      totalOrders: totalOrdersRow.cnt,
      todayOrders: todayOrdersRow.cnt,
      pendingPayments: pendingPayRow.cnt,
      paidOrders: paidOrdersRow.cnt,
      completedOrders: completedRow.cnt,
      outOfStockProducts: oosRow.cnt,
      totalProducts: totalProductsRow.cnt,
      totalCategories: totalCategoriesRow.cnt
    };
  },

  logApiCall(log) {
    const stmt = db.prepare(`
      INSERT INTO api_request_logs (
        id, request_id, reseller_id, method, endpoint, status_code,
        duration_ms, is_error, error_details, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);
    stmt.run(
      log.id || crypto.randomUUID(),
      log.request_id || `req_${Date.now()}`,
      log.reseller_id || 'default',
      log.method,
      log.endpoint,
      log.status_code,
      log.duration_ms,
      log.is_error ? 1 : 0,
      log.error_details || null
    );
  },

  getApiLogs(limit = 100, resellerId = 'default') {
    const stmt = db.prepare(`SELECT * FROM api_request_logs WHERE reseller_id = ? ORDER BY created_at DESC LIMIT ?`);
    return stmt.all(resellerId, limit);
  },

  logSync(sync) {
    const stmt = db.prepare(`
      INSERT INTO sync_logs (
        id, reseller_id, sync_type, items_synced, items_updated,
        items_disabled, duration_ms, status, error_message, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);
    stmt.run(
      sync.id || crypto.randomUUID(),
      sync.reseller_id || 'default',
      sync.sync_type,
      sync.items_synced || 0,
      sync.items_updated || 0,
      sync.items_disabled || 0,
      sync.duration_ms,
      sync.status,
      sync.error_message || null
    );
  },

  getSyncLogs(limit = 50, resellerId = 'default') {
    const stmt = db.prepare(`SELECT * FROM sync_logs WHERE reseller_id = ? ORDER BY timestamp DESC LIMIT ?`);
    return stmt.all(resellerId, limit);
  },

  logWebhook(wh) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO webhook_events (
        id, event_id, event_type, order_id, supplier_order_id, payload_json, direction, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);
    stmt.run(
      wh.id || crypto.randomUUID(),
      wh.event_id,
      wh.event_type,
      wh.order_id || null,
      wh.supplier_order_id || null,
      typeof wh.payload === 'string' ? wh.payload : JSON.stringify(wh.payload || {}),
      wh.direction || 'INCOMING',
      wh.status || 'processed'
    );
  },

  getWebhookLogs(limit = 50) {
    return db.prepare(`SELECT * FROM webhook_events ORDER BY created_at DESC LIMIT ?`).all(limit);
  },

  isWebhookProcessed(eventId) {
    const stmt = db.prepare(`SELECT id FROM webhook_events WHERE event_id = ?`);
    return Boolean(stmt.get(eventId));
  },

  getStoreSettings() {
    const rows = db.prepare(`SELECT key, value FROM store_settings`).all();
    const settings = {};
    rows.forEach(r => { settings[r.key] = r.value; });
    return settings;
  },

  saveStoreSettings(settings) {
    const stmt = db.prepare(`INSERT OR REPLACE INTO store_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))`);
    for (const [k, v] of Object.entries(settings)) {
      if (v !== undefined && v !== null) {
        stmt.run(k, String(v));
      }
    }
  },

  cleanDatabaseItemLabels() {
    try {
      const prods = db.prepare(`SELECT id, option_groups_json FROM reseller_products`).all();
      const updateStmt = db.prepare(`UPDATE reseller_items SET name = ?, edition_label = ? WHERE id = ?`);
      for (const p of prods) {
        const optionGroups = JSON.parse(p.option_groups_json || '[]');
        const items = db.prepare(`SELECT * FROM reseller_items WHERE product_id = ?`).all(p.id);
        for (const it of items) {
          const selection = JSON.parse(it.selection_json || '{}');
          const resolved = this.resolveVariantDisplayName({ ...it, selection }, optionGroups);
          updateStmt.run(resolved, resolved, it.id);
        }
      }
    } catch (e) {
      console.warn('[DB] Item labels cleanup notice:', e.message);
    }
  }
};

// Automatically clean and normalize any stored items on startup
dbHelper.cleanDatabaseItemLabels();
