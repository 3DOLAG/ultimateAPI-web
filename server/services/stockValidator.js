import { dbHelper } from '../db.js';
import { pricingEngine } from './pricingEngine.js';
import { syncEngine } from './syncEngine.js';

export class StockValidatorService {
  /**
   * Stage 1: Validate individual item availability when customer selects it
   */
  async validateItem(itemId, fallbackItem = {}) {
    let localItem = dbHelper.getItemById(itemId);
    
    // Auto-sync if catalog is not cached in local memory
    if (!localItem) {
      try {
        await syncEngine.runFullSync();
        localItem = dbHelper.getItemById(itemId);
      } catch (e) {
        console.warn('[StockValidator] Auto-sync notice:', e.message);
      }
    }

    // Check by product ID / slug if item ID wasn't found directly
    if (!localItem && fallbackItem.product_id) {
      localItem = dbHelper.getItemById(fallbackItem.product_id);
    }

    if (!localItem) {
      const prod = dbHelper.getProductByIdOrSlug(itemId || fallbackItem.product_id || fallbackItem.product_slug);
      if (prod) {
        const pricing = pricingEngine.calculatePrice(prod.price_base || fallbackItem.price || 0, prod.category_id);
        const customerPrice = pricing.customer_price > 0 ? pricing.customer_price : Number(fallbackItem.price || 0);
        const isAvailable = customerPrice > 0 && Boolean(prod.is_available);
        return {
          valid: isAvailable,
          item_id: prod.id,
          product_id: prod.id,
          product_name: prod.name,
          variant_label: fallbackItem.name || prod.name,
          stock_status: isAvailable ? 'IN_STOCK' : 'OUT_OF_STOCK',
          stock_quantity: isAvailable ? (prod.stock_quantity || 50) : 0,
          supplier_cost: pricing.supplier_cost || (customerPrice * 0.85),
          customer_price: customerPrice,
          currency: pricing.currency || fallbackItem.currency || 'EGP'
        };
      }

      // If item price was passed from the active storefront catalog
      if (fallbackItem && (Number(fallbackItem.price) > 0 || Number(fallbackItem.customer_price) > 0)) {
        const itemPrice = Number(fallbackItem.price || fallbackItem.customer_price);
        const pricing = pricingEngine.calculatePrice(itemPrice * 0.85, fallbackItem.category_id);
        const isAvailable = itemPrice > 0 && fallbackItem.is_available !== false;
        return {
          valid: isAvailable,
          item_id: itemId || fallbackItem.item_id || 'item_default',
          product_id: fallbackItem.product_id || 'prod_default',
          product_name: fallbackItem.product_name || fallbackItem.name || 'Digital Item',
          variant_label: fallbackItem.edition_label || fallbackItem.name || 'Standard',
          stock_status: isAvailable ? 'IN_STOCK' : 'OUT_OF_STOCK',
          stock_quantity: isAvailable ? 99 : 0,
          supplier_cost: pricing.supplier_cost || (itemPrice * 0.85),
          customer_price: itemPrice,
          currency: fallbackItem.currency || 'EGP'
        };
      }

      return {
        valid: false,
        error: 'ITEM_NOT_FOUND',
        message: 'The requested product option does not exist or is not available for purchase.'
      };
    }

    let baseCost = Number(localItem.base_price || 0);
    if (baseCost <= 0 && Number(fallbackItem.price) > 0) {
      baseCost = Number(fallbackItem.price) * 0.85;
    }
    const pricing = pricingEngine.calculatePrice(baseCost, localItem.category_id);
    const customerPrice = pricing.customer_price > 0 ? pricing.customer_price : Number(localItem.price || fallbackItem.price || 0);
    const isPriced = customerPrice > 0;
    const isAvailable = isPriced && Boolean(localItem.is_available);

    return {
      valid: isAvailable,
      item_id: localItem.id,
      product_id: localItem.product_id,
      product_name: localItem.product_name || fallbackItem.product_name,
      variant_label: localItem.edition_label || localItem.name || fallbackItem.name,
      stock_status: isAvailable ? 'IN_STOCK' : 'OUT_OF_STOCK',
      stock_quantity: isAvailable ? (localItem.stock_quantity || 50) : 0,
      supplier_cost: pricing.supplier_cost || (customerPrice * 0.85),
      customer_price: customerPrice,
      currency: pricing.currency || fallbackItem.currency || 'EGP'
    };
  }

  /**
   * Stage 2 & Stage 3: Immediate atomic validation prior to order creation
   */
  async validateCartOrItem(items = []) {
    const validatedItems = [];
    let allInStock = true;

    for (const item of items) {
      const check = await this.validateItem(item.item_id || item.id || item.product_id, item);
      
      if (!check.valid) {
        allInStock = false;
      }

      validatedItems.push({
        ...item,
        ...check,
        quantity: Math.max(1, parseInt(item.quantity || 1, 10))
      });
    }

    if (!allInStock) {
      const unavailable = validatedItems.filter(i => !i.valid).map(i => i.product_name || i.name).join(', ');
      const err = new Error(`Order placement rejected: The following item is currently out of stock: ${unavailable}`);
      err.code = 'OUT_OF_STOCK';
      err.status = 400;
      err.unavailableItems = validatedItems.filter(i => !i.valid);
      throw err;
    }

    return pricingEngine.calculateOrderTotals(validatedItems);
  }
}

export const stockValidator = new StockValidatorService();
