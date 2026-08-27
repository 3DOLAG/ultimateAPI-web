import { dbHelper } from '../db.js';
import { pricingEngine } from './pricingEngine.js';

export class StockValidatorService {
  /**
   * Stage 1: Validate individual item availability when customer selects it
   */
  async validateItem(itemId) {
    const localItem = dbHelper.getItemById(itemId);
    if (!localItem) {
      return {
        valid: false,
        error: 'ITEM_NOT_FOUND',
        message: 'The requested product option does not exist.'
      };
    }

    const pricing = pricingEngine.calculatePrice(localItem.base_price, localItem.category_id);
    const isPriced = pricing.supplier_cost > 0 && pricing.customer_price > 0;
    const isAvailable = isPriced && Boolean(localItem.is_available);

    return {
      valid: isAvailable,
      item_id: localItem.id,
      product_id: localItem.product_id,
      product_name: localItem.product_name,
      variant_label: localItem.edition_label || localItem.name,
      stock_status: isAvailable ? 'IN_STOCK' : 'OUT_OF_STOCK',
      stock_quantity: isAvailable ? localItem.stock_quantity : 0,
      supplier_cost: pricing.supplier_cost,
      customer_price: pricing.customer_price,
      currency: pricing.currency
    };
  }

  /**
   * Stage 2 & Stage 3: Immediate atomic validation prior to order creation
   */
  async validateCartOrItem(items = []) {
    const validatedItems = [];
    let allInStock = true;

    for (const item of items) {
      const check = await this.validateItem(item.item_id || item.id || item.product_id);
      
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
