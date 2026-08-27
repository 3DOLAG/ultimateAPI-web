import { config } from '../config.js';
import { dbHelper } from '../db.js';
import crypto from 'crypto';

export class SupplierApiClient {
  constructor() {
    this.baseUrl = config.supplier.apiUrl.replace(/\/$/, '');
    this.apiKey = config.supplier.apiKey;
    this.apiSecret = config.supplier.apiSecret;
    this.timeout = config.supplier.timeoutMs;
  }

  getHeaders(customHeaders = {}) {
    const basicAuth = Buffer.from(`${this.apiKey}:${this.apiSecret}`).toString('base64');
    return {
      'Authorization': `Basic ${basicAuth}`,
      'X-Reseller-Key': this.apiKey,
      'X-Reseller-Secret': this.apiSecret,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'AURA-Reseller-Platform/2.0',
      ...customHeaders
    };
  }

  async request(endpoint, options = {}, retries = 2) {
    const url = `${this.baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
    const method = options.method || 'GET';
    const requestId = `req_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const startTime = Date.now();

    const headers = this.getHeaders(options.headers || {});
    const fetchOptions = {
      method,
      headers,
      signal: AbortSignal.timeout(this.timeout)
    };

    if (options.body) {
      fetchOptions.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    }

    try {
      const response = await fetch(url, fetchOptions);
      const durationMs = Date.now() - startTime;
      const responseText = await response.text();

      let data;
      try {
        data = JSON.parse(responseText);
      } catch {
        data = { raw: responseText };
      }

      // Log API Request
      dbHelper.logApiCall({
        request_id: requestId,
        method,
        endpoint,
        status_code: response.status,
        duration_ms: durationMs,
        is_error: !response.ok,
        error_details: !response.ok ? JSON.stringify(data).slice(0, 500) : null
      });

      if (!response.ok) {
        if (response.status >= 500 && retries > 0) {
          const delay = 1000 * (3 - retries);
          await new Promise(r => setTimeout(r, delay));
          return this.request(endpoint, options, retries - 1);
        }

        const errorMsg = data?.error?.message || data?.message || `Supplier API error HTTP ${response.status}`;
        const err = new Error(errorMsg);
        err.status = response.status;
        err.data = data;
        throw err;
      }

      return data;
    } catch (err) {
      const durationMs = Date.now() - startTime;
      if (err.name === 'TimeoutError' || err.code === 'ECONNRESET') {
        if (retries > 0) {
          await new Promise(r => setTimeout(r, 1000));
          return this.request(endpoint, options, retries - 1);
        }
      }

      dbHelper.logApiCall({
        request_id: requestId,
        method,
        endpoint,
        status_code: err.status || 500,
        duration_ms: durationMs,
        is_error: 1,
        error_details: err.message
      });

      throw err;
    }
  }

  // -------------------------------------------------------------
  // Catalog & Inventory Endpoints
  // -------------------------------------------------------------
  async getCategories() {
    return this.request('/categories');
  }

  async getProducts(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/products${query ? `?${query}` : ''}`);
  }

  async getProduct(productId) {
    return this.request(`/products/${productId}`);
  }

  async getItemAvailability(itemId) {
    return this.request(`/items/${itemId}/availability`);
  }

  async getSyncDelta(updatedSince = null) {
    const query = updatedSince ? `?updated_since=${encodeURIComponent(updatedSince)}` : '';
    return this.request(`/sync${query}`);
  }

  // -------------------------------------------------------------
  // Order Fulfillment Endpoints
  // -------------------------------------------------------------
  async createOrder({ external_order_id, idempotency_key, customer, items, custom_fields = {}, notes = '', shipping_address = {} }) {
    const customData = custom_fields || customer?.custom_fields || {};
    
    const formattedItems = (items || []).map(it => ({
      product_id: it.product_id || it.supplier_product_id || it.item_id,
      item_id: it.supplier_item_id || it.item_id || it.product_id,
      quantity: it.quantity || 1,
      custom_fields: it.custom_fields || customData,
      ...customData
    }));

    const formattedCustomer = {
      name: customer?.name,
      email: customer?.email,
      phone: customer?.phone,
      notes: notes || customer?.notes || '',
      custom_fields: customData,
      ...customData
    };

    return this.request('/orders', {
      method: 'POST',
      headers: {
        'Idempotency-Key': idempotency_key || `idemp_${Date.now()}`
      },
      body: {
        external_order_id,
        customer: formattedCustomer,
        items: formattedItems,
        custom_fields: customData,
        notes: notes || customer?.notes || '',
        shipping_address: shipping_address || {}
      }
    });
  }

  async getOrderStatus(supplierOrderId) {
    return this.request(`/orders/${supplierOrderId}/status`);
  }

  async trackOrder(orderId) {
    return this.request(`/orders/track/${orderId}`);
  }

  async checkHealth() {
    try {
      const startTime = Date.now();
      const res = await this.getCategories();
      return {
        healthy: Boolean(res && (res.data || res.success)),
        latencyMs: Date.now() - startTime
      };
    } catch {
      return { healthy: false, latencyMs: 0 };
    }
  }
}

export const supplierApi = new SupplierApiClient();
