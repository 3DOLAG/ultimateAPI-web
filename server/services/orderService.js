import { dbHelper } from '../db.js';
import { stockValidator } from './stockValidator.js';
import { supplierApi } from './supplierApi.js';
import { discordWebhook } from './discordWebhook.js';
import crypto from 'crypto';

export class OrderService {
  /**
   * Process Customer Checkout & Create Initial Pending Order
   */
  async processCheckout({ customer, items, shipping_address = {}, idempotency_key = null, external_order_id = null, resellerId = 'default' }) {
    if (!customer?.name || !customer?.email || !customer?.phone) {
      const err = new Error('Customer full name, email, and phone number are required.');
      err.status = 400;
      throw err;
    }

    if (!Array.isArray(items) || items.length === 0) {
      const err = new Error('Your order must contain at least one valid product item.');
      err.status = 400;
      throw err;
    }

    // 1. Generate unique order IDs
    const randSuffix = Math.floor(10000 + Math.random() * 90000);
    const resellerOrderId = `RSL-${randSuffix}`;
    const externalId = external_order_id || `MYSHOP-${randSuffix}`;
    const idempKey = idempotency_key || `idemp_${Date.now()}_${randSuffix}`;

    // 2. Idempotency Check
    const existingOrder = dbHelper.getOrderByExternalOrIdemp(externalId, idempKey, resellerId);
    if (existingOrder) {
      console.log(`[OrderService] ⚡ Replaying existing order for idempotency key: ${idempKey} (Order: ${existingOrder.reseller_order_id})`);
      return {
        order: existingOrder,
        is_replay: true
      };
    }

    // 3. Stage 3 Real-Time Stock & Authoritative Price Validation
    console.log(`[OrderService] 🛡️ Performing Stage 3 Real-Time Stock & Price Validation...`);
    const totals = await stockValidator.validateCartOrItem(items);

    if (!totals || Number(totals.total) <= 0) {
      const err = new Error('تعذر معالجة الطلب: سعر المنتج أو الباقة غير متاح حالياً (المجموع 0 جنيه). يرجى اختيار خيار متوفر.');
      err.code = 'INVALID_TOTAL_PRICE';
      err.status = 400;
      throw err;
    }

    const trackingToken = `trk_${crypto.randomBytes(16).toString('hex')}`;
    const internalId = `ord_${crypto.randomUUID()}`;

    // 4. Do not dispatch to Supplier API at initial checkout
    // The order is dispatched to the Supplier API ONLY when the customer submits the payment proof from the payment page!
    const supplierOrderId = null;
    const supplierStatus = 'pending';

    // 5. Store Local Order Record
    const orderRecord = dbHelper.createOrder({
      id: internalId,
      reseller_id: resellerId,
      reseller_order_id: resellerOrderId,
      supplier_order_id: supplierOrderId,
      external_order_id: externalId,
      idempotency_key: idempKey,
      customer_name: customer.name,
      customer_email: customer.email,
      customer_phone: customer.phone,
      customer_data: customer.custom_fields || customer.extra_data || {},
      customer_notes: customer.notes || null,
      subtotal: totals.subtotal,
      tax: totals.tax,
      shipping_fee: totals.shipping_fee,
      total: totals.total,
      currency: totals.currency,
      supplier_cost: totals.supplier_cost_total,
      reseller_profit: totals.total_profit,
      payment_status: 'pending',
      supplier_status: supplierStatus,
      local_status: 'pending',
      tracking_token: trackingToken,
      items: totals.items,
      timeline: [
        { status: 'order_created', timestamp: new Date().toISOString(), note: 'Order created, awaiting payment method selection and transfer' }
      ]
    });

    // 6. Record Outgoing Webhook Event
    this.emitOrderWebhook('order.created', orderRecord);

    return {
      order: orderRecord,
      is_replay: false
    };
  }

  /**
   * Submit Payment Proof Screenshot / Receipt (Zero-Disk Storage)
   */
  async submitPaymentProof(orderId, { payment_method_id, payment_method_name, fileBuffer, originalName, mimeType, reference }) {
    const order = dbHelper.getOrderById(orderId);
    if (!order) {
      const err = new Error(`Order not found for ID ${orderId}`);
      err.status = 404;
      throw err;
    }

    if (!fileBuffer || fileBuffer.length === 0) {
      const err = new Error('Please attach an image receipt or transfer screenshot.');
      err.status = 400;
      throw err;
    }

    // 1. Dispatch Order to Authoritative Supplier API ONLY NOW upon payment proof submission!
    if (!order.supplier_order_id || order.supplier_order_id.startsWith('SUP-PENDING')) {
      try {
        console.log(`[OrderService] 🚀 Dispatching order to Authoritative Supplier API upon Payment Proof submission (External: ${order.external_order_id})...`);
        const supplierRes = await supplierApi.createOrder({
          external_order_id: order.external_order_id,
          idempotency_key: order.idempotency_key,
          customer: {
            name: order.customer_name,
            email: order.customer_email,
            phone: order.customer_phone,
            custom_fields: order.customer_data || {},
            notes: order.customer_notes || ''
          },
          items: order.items || [],
          custom_fields: order.customer_data || {},
          notes: order.customer_notes || '',
          shipping_address: order.shipping_address || null
        });

        const supplierData = supplierRes?.data || supplierRes || {};
        order.supplier_order_id = supplierData.order_id || supplierData.id || supplierData.supplier_order_id || `SUP-${order.reseller_order_id}`;
        order.supplier_status = supplierData.status || 'pending';
        console.log(`[OrderService] ✅ Order registered with Supplier: ${order.supplier_order_id} (Reseller: ${order.reseller_order_id})`);
      } catch (suppErr) {
        console.warn(`[OrderService] ⚠️ Supplier dispatch notice: ${suppErr.message}. Local order recorded.`);
        order.supplier_order_id = order.supplier_order_id || `SUP-${order.reseller_order_id}`;
      }
    }

    // 2. Dispatch in-memory image buffer directly to Discord Webhook with retries
    let discordResult;
    try {
      discordResult = await discordWebhook.sendOrderPaymentProof(
        order,
        fileBuffer,
        originalName || 'payment_proof.jpg',
        mimeType || 'image/jpeg',
        { reference }
      );
    } catch (discErr) {
      // Record failure metadata in order record for admin awareness
      dbHelper.updateDiscordWebhookStatus(order.id, {
        sent_to_discord: 0,
        discord_event_id: `evt_ORD_${order.reseller_order_id}_PAYMENT_PROOF`,
        sent_at: null,
        delivery_status: 'failed'
      });

      const err = new Error(`Could not deliver payment proof to Discord: ${discErr.message}. Please try again.`);
      err.status = 502;
      throw err;
    }

    // 3. Persist metadata in the database
    const updated = dbHelper.submitPaymentProof(order.id, {
      payment_method_id,
      payment_method_name,
      reference,
      supplier_order_id: order.supplier_order_id,
      supplier_status: order.supplier_status,
      sent_to_discord: discordResult.success ? 1 : 0,
      discord_event_id: discordResult.eventId,
      sent_at: discordResult.deliveredAt,
      delivery_status: discordResult.success ? 'delivered' : 'failed'
    });

    // 4. Emit local internal webhook event
    this.emitOrderWebhook('order.payment_submitted', updated);

    return updated;
  }

  /**
   * Admin Approve Payment
   */
  async approvePayment(orderId, { note } = {}) {
    const order = dbHelper.getOrderById(orderId);
    if (!order) {
      const err = new Error(`Order not found for ID ${orderId}`);
      err.status = 404;
      throw err;
    }

    const updated = dbHelper.approvePayment(order.id, { note });
    this.emitOrderWebhook('order.paid', updated);
    return updated;
  }

  /**
   * Admin Reject Payment
   */
  async rejectPayment(orderId, { reason } = {}) {
    const order = dbHelper.getOrderById(orderId);
    if (!order) {
      const err = new Error(`Order not found for ID ${orderId}`);
      err.status = 404;
      throw err;
    }

    const updated = dbHelper.rejectPayment(order.id, { reason });
    this.emitOrderWebhook('order.payment_rejected', updated);
    return updated;
  }

  /**
   * Live Order Tracking
   */
  async getLiveOrderTracking(queryId, verificationEmail = null) {
    const order = dbHelper.getOrderById(queryId);
    if (!order) {
      const err = new Error(`No order found matching identifier "${queryId}". Please verify your order number.`);
      err.status = 404;
      throw err;
    }

    if (verificationEmail) {
      const cleanEmail = verificationEmail.trim().toLowerCase();
      if (order.customer_email.toLowerCase() !== cleanEmail) {
        const err = new Error('Email verification failed for this order.');
        err.status = 403;
        throw err;
      }
    }

    // Refresh status from Supplier API if supplier order ID exists and order is active
    let supplierLiveStatus = order.supplier_status;
    if (order.supplier_order_id && !order.supplier_order_id.startsWith('SUP-PENDING') && order.local_status !== 'completed' && order.local_status !== 'cancelled') {
      try {
        const suppStatusRes = await supplierApi.getOrderStatus(order.supplier_order_id);
        if (suppStatusRes?.data?.status) {
          supplierLiveStatus = suppStatusRes.data.status;
          if (supplierLiveStatus !== order.supplier_status) {
            dbHelper.updateOrderStatus(order.id, {
              supplier_status: supplierLiveStatus,
              local_status: supplierLiveStatus === 'fulfilled' ? 'completed' : order.local_status
            });
          }
        }
      } catch {}
    }

    let statusStep = 1;
    if (order.payment_status === 'payment_submitted') statusStep = 2;
    if (order.payment_status === 'paid') statusStep = 3;
    if (supplierLiveStatus === 'processing' || order.local_status === 'processing') statusStep = 4;
    if (supplierLiveStatus === 'fulfilled' || supplierLiveStatus === 'completed' || order.local_status === 'completed') statusStep = 5;

    return {
      id: order.id,
      reseller_order_id: order.reseller_order_id,
      supplier_order_id: order.supplier_order_id,
      external_order_id: order.external_order_id,
      customer_name: order.customer_name,
      customer_email: order.customer_email,
      customer_phone: order.customer_phone,
      items: order.items,
      total: order.total,
      currency: order.currency,
      payment_method_name: order.payment_method_name,
      payment_status: order.payment_status,
      rejection_reason: order.rejection_reason,
      supplier_status: supplierLiveStatus,
      local_status: order.local_status,
      tracking_number: order.tracking_number,
      carrier: order.carrier,
      status_step: statusStep,
      timeline: order.timeline,
      created_at: order.created_at,
      updated_at: order.updated_at
    };
  }

  /**
   * Log & Emit Order Webhook Event
   */
  emitOrderWebhook(eventType, order) {
    const payload = {
      event: eventType,
      event_id: `evt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      order_id: order.reseller_order_id,
      supplier_order_id: order.supplier_order_id,
      reseller_order_id: order.reseller_order_id,
      external_order_id: order.external_order_id,
      customer: {
        name: order.customer_name,
        email: order.customer_email,
        phone: order.customer_phone
      },
      items: order.items,
      amount: order.total,
      currency: order.currency,
      payment_method: order.payment_method_name,
      payment_status: order.payment_status,
      order_status: order.local_status,
      payment_proof_reference: order.payment_reference,
      created_at: order.created_at,
      timestamp: Math.floor(Date.now() / 1000)
    };

    dbHelper.logWebhook({
      id: crypto.randomUUID(),
      event_id: payload.event_id,
      event_type: eventType,
      order_id: order.reseller_order_id,
      supplier_order_id: order.supplier_order_id,
      payload,
      direction: 'OUTGOING',
      status: 'delivered'
    });
  }
}

export const orderService = new OrderService();
