import { dbHelper } from '../db.js';
import { config } from '../config.js';

export class PricingEngineService {
  /**
   * Calculate authoritative customer price and profit margin for any product or item
   */
  calculatePrice(basePrice, categoryId) {
    const rawCost = Number(basePrice) || 0;
    const marginPercent = dbHelper.getEffectiveMarginForCategory(categoryId);
    const multiplier = 1 + (marginPercent / 100);
    const customerPrice = rawCost > 0 ? Math.round((rawCost * multiplier) * 100) / 100 : 0;
    const profit = Math.round((customerPrice - rawCost) * 100) / 100;

    return {
      supplier_cost: rawCost,
      margin_percent: marginPercent,
      customer_price: customerPrice,
      profit: profit,
      currency: config.store.currency
    };
  }

  /**
   * Calculate prices for an array of cart/order items
   */
  calculateOrderTotals(items = []) {
    let supplierCostTotal = 0;
    let customerSubtotal = 0;
    const calculatedItems = [];

    for (const item of items) {
      // 1. Resolve item and product from DB
      const dbItem = dbHelper.getItemById(item.item_id || item.id || item.supplier_item_id);
      const dbProd = dbHelper.getProductByIdOrSlug(item.product_id || item.product_slug || item.item_id || item.id);
      
      const categoryId = item.category_id || dbItem?.category_id || dbProd?.category_id;
      const marginPercent = dbHelper.getEffectiveMarginForCategory(categoryId);
      const multiplier = 1 + (marginPercent / 100);

      // 2. Resolve known customer price and base cost
      const clientPrice = Number(item.customer_price ?? item.unit_customer_price ?? item.price ?? 0);
      const itemBase = Number(dbItem?.base_price ?? dbProd?.price_base ?? item.supplier_cost ?? item.unit_supplier_cost ?? item.base_price ?? 0);

      let customerPrice = 0;
      let supplierCost = 0;

      if (itemBase > 0) {
        supplierCost = itemBase;
        customerPrice = Math.round((itemBase * multiplier) * 100) / 100;
      } else if (clientPrice > 0) {
        // Fallback when base cost in DB is 0 but storefront item has a valid price
        customerPrice = clientPrice;
        supplierCost = Math.round((clientPrice / multiplier) * 100) / 100;
      }

      // If client provided a specific higher price from custom variant, honor it
      if (clientPrice > 0 && customerPrice <= 0) {
        customerPrice = clientPrice;
        supplierCost = Math.round((clientPrice * 0.85) * 100) / 100;
      }

      const quantity = Math.max(1, parseInt(item.quantity || 1, 10));
      const lineCustomerTotal = Math.round((customerPrice * quantity) * 100) / 100;
      const lineSupplierTotal = Math.round((supplierCost * quantity) * 100) / 100;

      supplierCostTotal += lineSupplierTotal;
      customerSubtotal += lineCustomerTotal;

      calculatedItems.push({
        product_id: item.product_id || dbItem?.product_id || dbProd?.id || 'unknown',
        item_id: item.item_id || item.id || dbItem?.id || dbProd?.id || 'unknown',
        supplier_item_id: item.supplier_item_id || dbItem?.supplier_item_id || item.item_id,
        name: item.product_name || item.name || dbItem?.name || dbProd?.name || 'Purchasable Item',
        item_name: item.item_name || item.name || dbItem?.name || dbProd?.name || 'Purchasable Item',
        variant_label: item.variant_label || item.edition_label || dbItem?.edition_label || null,
        quantity,
        unit_supplier_cost: supplierCost,
        unit_customer_price: customerPrice,
        price: customerPrice,
        total_price: lineCustomerTotal,
        profit: Math.round((lineCustomerTotal - lineSupplierTotal) * 100) / 100
      });
    }

    const subtotal = Math.round(customerSubtotal * 100) / 100;
    const tax = 0;
    const shippingFee = 0;
    const total = Math.round((subtotal + tax + shippingFee) * 100) / 100;
    const totalProfit = Math.round((total - supplierCostTotal) * 100) / 100;

    return {
      items: calculatedItems,
      supplier_cost_total: Math.round(supplierCostTotal * 100) / 100,
      subtotal,
      tax,
      shipping_fee: shippingFee,
      total,
      total_profit: totalProfit,
      currency: config.store.currency
    };
  }
}

export const pricingEngine = new PricingEngineService();
