import express from 'express';
import crypto from 'crypto';
import { dbHelper } from '../db.js';
import { config } from '../config.js';

export const webhooksRouter = express.Router();

/**
 * POST /api/v1/webhooks/supplier
 */
webhooksRouter.post('/supplier', express.raw({ type: 'application/json' }), (req, res) => {
  const rawBody = Buffer.isBuffer(req.body)
    ? req.body.toString('utf8')
    : (req.rawBody ? req.rawBody.toString('utf8') : (typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {})));

  const signature = req.headers['x-supplier-signature'];
  const timestamp = req.headers['x-supplier-timestamp'];
  const headerEventId = req.headers['x-event-id'];

  console.log(`[Webhook Receiver] 📥 Incoming supplier webhook event`);

  // 1. Validate signature & timestamp headers
  if (!signature || !timestamp) {
    console.warn(`[Webhook Receiver] ❌ Missing signature or timestamp headers`);
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing x-supplier-signature or x-supplier-timestamp header'
    });
  }

  // 2. Prevent replay attacks via timestamp drift (tolerance: 300 seconds / 5 mins)
  const currentTime = Math.floor(Date.now() / 1000);
  const requestTime = parseInt(timestamp, 10);
  if (isNaN(requestTime) || Math.abs(currentTime - requestTime) > 300) {
    console.warn(`[Webhook Receiver] ❌ Webhook timestamp rejected: drift is ${Math.abs(currentTime - requestTime)}s`);
    return res.status(400).json({
      error: 'Invalid timestamp',
      message: 'Webhook timestamp is outside tolerance window'
    });
  }

  // 3. Verify HMAC-SHA256 Signature
  const expectedSignaturePayload = `${timestamp}.${rawBody}`;
  const computedSignature = crypto
    .createHmac('sha256', config.supplier.webhookSecret)
    .update(expectedSignaturePayload)
    .digest('hex');

  const sigBuf = Buffer.from(signature, 'hex');
  const computedBuf = Buffer.from(computedSignature, 'hex');
  const isValidSignature = sigBuf.length === computedBuf.length && crypto.timingSafeEqual(sigBuf, computedBuf);

  if (!isValidSignature) {
    console.warn(`[Webhook Receiver] ❌ Invalid HMAC signature`);
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid webhook signature'
    });
  }

  // 4. Parse payload
  let payload;
  try {
    payload = typeof req.body === 'object' && !Buffer.isBuffer(req.body) ? req.body : JSON.parse(rawBody);
  } catch (parseErr) {
    return res.status(400).json({ error: 'Bad Request', message: 'Invalid JSON payload' });
  }

  const eventId = payload.event_id || headerEventId || `evt_${crypto.randomUUID()}`;
  const eventType = payload.event_type || payload.event;
  const supplierOrderId = payload.supplier_order_id || payload.order_id || payload.data?.id || payload.data?.order_id;
  const externalOrderId = payload.external_order_id || payload.data?.external_order_id;

  // 5. Replay Guard
  if (dbHelper.isWebhookProcessed(eventId)) {
    console.log(`[Webhook Receiver] ⚡ Duplicate webhook event ${eventId} ignored`);
    return res.status(200).json({ status: 'success', message: 'Event already processed' });
  }

  // 6. Map Supplier Event to Local Order Status
  let localStatus = null;
  let supplierStatus = payload.status || 'unknown';
  let trackingNumber = payload.tracking_number || payload.data?.tracking_number;
  let carrier = payload.carrier || payload.data?.carrier;

  switch (eventType) {
    case 'order.created':
      supplierStatus = 'received';
      break;
    case 'order.processing':
      supplierStatus = 'processing';
      localStatus = 'processing';
      break;
    case 'order.fulfilled':
    case 'order.completed':
      supplierStatus = 'fulfilled';
      localStatus = 'completed';
      break;
    case 'order.cancelled':
      supplierStatus = 'cancelled';
      localStatus = 'cancelled';
      break;
    case 'order.failed':
      supplierStatus = 'failed';
      localStatus = 'failed';
      break;
  }

  try {
    const targetId = supplierOrderId || externalOrderId || payload.reseller_order_id;
    const order = targetId ? dbHelper.getOrderById(targetId) : null;

    if (order && (localStatus || supplierStatus)) {
      dbHelper.updateOrderStatus(order.id, {
        supplier_status: supplierStatus,
        local_status: localStatus || order.local_status,
        supplier_order_id: supplierOrderId || order.supplier_order_id,
        tracking_number: trackingNumber || order.tracking_number,
        carrier: carrier || order.carrier,
        note: `Supplier webhook: ${eventType} (${supplierStatus})`
      });
      console.log(`[Webhook Receiver] 🔄 Order ${order.reseller_order_id} updated to '${localStatus || supplierStatus}'`);
    }

    dbHelper.logWebhook({
      id: crypto.randomUUID(),
      event_id: eventId,
      event_type: eventType || 'unknown',
      supplier_order_id: supplierOrderId,
      payload,
      direction: 'INCOMING',
      status: 'processed'
    });

    return res.status(200).json({
      status: 'success',
      event_id: eventId,
      message: 'Webhook processed'
    });
  } catch (err) {
    console.error(`[Webhook Receiver] ❌ Error processing event:`, err.message);
    return res.status(500).json({ error: 'Internal processing error', message: err.message });
  }
});
