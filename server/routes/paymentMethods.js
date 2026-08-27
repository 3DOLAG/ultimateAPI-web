import express from 'express';
import { dbHelper } from '../db.js';

export const paymentMethodsRouter = express.Router();

/**
 * GET /api/payment-methods
 * Returns active payment methods for customer checkout/payment screen
 */
paymentMethodsRouter.get('/', (req, res) => {
  try {
    const methods = dbHelper.getPaymentMethods(true);
    res.json({
      success: true,
      data: methods
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
