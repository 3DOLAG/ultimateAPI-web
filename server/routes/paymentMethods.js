import express from 'express';
import { dbHelper } from '../db.js';
import { blobService } from '../services/blobService.js';

export const paymentMethodsRouter = express.Router();

/**
 * GET /api/payment-methods
 * Returns active payment methods for customer checkout/payment screen
 */
paymentMethodsRouter.get(['/', '/api/payment-methods'], async (req, res) => {
  try {
    try {
      const blobMethods = await blobService.loadPaymentMethods();
      if (blobMethods && Array.isArray(blobMethods) && blobMethods.length > 0) {
        for (const m of blobMethods) {
          dbHelper.upsertPaymentMethod(m);
        }
      }
    } catch {}

    const methods = dbHelper.getPaymentMethods(true);
    res.json({
      success: true,
      data: methods
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
