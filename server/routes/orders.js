import express from 'express';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import { orderService } from '../services/orderService.js';
import { dbHelper } from '../db.js';
import { config } from '../config.js';

export const ordersRouter = express.Router();

// Ephemeral In-Memory Multer configuration (Zero permanent disk storage)
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp/i;
    const extName = allowed.test(path.extname(file.originalname).toLowerCase());
    const mimeType = allowed.test(file.mimetype);
    if (extName && mimeType) {
      return cb(null, true);
    }
    cb(new Error('Only image files (JPG, PNG, WEBP) are permitted for payment proof receipts.'));
  }
});

/**
 * POST /api/orders/checkout
 */
ordersRouter.post('/checkout', async (req, res) => {
  try {
    const { customer, items, shipping_address, external_order_id } = req.body;
    const idempotencyKey = req.headers['idempotency-key'] || req.body.idempotency_key;

    const result = await orderService.processCheckout({
      customer,
      items,
      shipping_address,
      idempotency_key: idempotencyKey,
      external_order_id,
      resellerId: req.resellerId || 'default'
    });

    const statusCode = result.is_replay ? 200 : 201;
    res.status(statusCode).json({
      success: true,
      message: result.is_replay ? 'Existing order retrieved' : 'Order successfully initialized. Please complete payment transfer.',
      data: result.order
    });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({
      success: false,
      error: {
        code: err.code || 'CHECKOUT_FAILED',
        message: err.message,
        details: err.unavailableItems || null
      }
    });
  }
});

/**
 * GET /api/orders/:id
 */
ordersRouter.get('/:id', (req, res) => {
  try {
    const orderId = req.params.id;
    const order = dbHelper.getOrderById(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        error: { code: 'ORDER_NOT_FOUND', message: 'Order not found' }
      });
    }

    res.json({
      success: true,
      data: order
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/orders/:id/payment-proof
 * Ephemeral processing: image is dispatched to Discord in-memory and discarded.
 */
ordersRouter.post('/:id/payment-proof', upload.single('proof_image'), async (req, res) => {
  try {
    const orderId = req.params.id;
    const { payment_method_id, payment_method_name, reference } = req.body;

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_FILE', message: 'Please attach an image receipt or transfer screenshot.' }
      });
    }

    const updatedOrder = await orderService.submitPaymentProof(orderId, {
      payment_method_id,
      payment_method_name,
      fileBuffer: req.file.buffer,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      reference: reference || null
    });

    res.json({
      success: true,
      message: 'Payment proof received and sent to Discord for review. Your order will be processed shortly.',
      data: updatedOrder
    });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({
      success: false,
      error: { code: 'PROOF_UPLOAD_FAILED', message: err.message }
    });
  }
});

/**
 * GET /api/orders/track/:id
 */
ordersRouter.get('/track/:id', async (req, res) => {
  try {
    const orderId = req.params.id;
    const email = req.query.email || req.headers['x-verify-email'];

    const trackingData = await orderService.getLiveOrderTracking(orderId, email);
    res.json({
      success: true,
      data: trackingData
    });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({
      success: false,
      error: { code: 'TRACKING_ERROR', message: err.message }
    });
  }
});
