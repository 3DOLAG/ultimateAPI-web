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
    const customerPrice = Math.round((rawCost * multiplier) * 100) / 100;
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
      // Find item in DB to guarantee base supplier cost authority
      const dbItem = dbHelper.getItemById(item.item_id || item.id || item.product_id);
      const baseCost = dbItem ? dbItem.base_price : Number(item.base_price || item.unit_supplier_cost || item.price || 0);
      const categoryId = item.category_id || dbItem?.category_id;

      const pricing = this.calculatePrice(baseCost, categoryId);
      const quantity = Math.max(1, parseInt(item.quantity || 1, 10));
      const lineCustomerTotal = Math.round((pricing.customer_price * quantity) * 100) / 100;
      const lineSupplierTotal = Math.round((pricing.supplier_cost * quantity) * 100) / 100;

      supplierCostTotal += lineSupplierTotal;
      customerSubtotal += lineCustomerTotal;

      calculatedItems.push({
        product_id: item.product_id || dbItem?.product_id,
        item_id: item.item_id || item.id || dbItem?.id,
        supplier_item_id: item.supplier_item_id || dbItem?.supplier_item_id || item.item_id,
        name: item.name || dbItem?.name || 'Purchasable Item',
        variant_label: item.variant_label || dbItem?.edition_label || null,
        quantity,
        unit_supplier_cost: pricing.supplier_cost,
        unit_customer_price: pricing.customer_price,
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
