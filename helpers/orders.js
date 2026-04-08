// helpers/orders.js
import orderModel from '../models/orderModel.js';
import userModel from '../models/userModel.js';

/**
 * Idempotently finalize an order after the PSP (e.g., Stripe) confirms payment.
 * Backward-compatible signature: (orderId, userId, extra?)
 *
 * @param {string} orderId
 * @param {string} [userId]         Optional: assert ownership
 * @param {object} [extra]          Optional: { provider, paymentIntentId, paymentStatus, currency, receiptEmail, meta }
 * @returns {Promise<{ok:boolean, reason?:string}>}
 */
export const finalizePaidOrder = async (orderId, userId, extra = {}) => {
  const order = await orderModel.findById(orderId);
  if (!order) return { ok: false, reason: 'order_not_found' };

  // Optional ownership check for client-triggered calls
  if (userId && String(order.userId) !== String(userId)) {
    return { ok: false, reason: 'unauthorized' };
  }

  // If already paid, be idempotent
  if (order.payment === true || order.status === 'Paid') {
    return { ok: true };
  }

  // Update order payment fields
  order.payment = true;
  order.status = 'Paid';

  // Keep existing paymentMethod for compatibility, but allow override
  if (extra.provider) {
    order.paymentMethod = extra.provider;
  }

  // Provider-agnostic payment info (schema supports future providers)
  order.paymentInfo = {
    provider: extra.provider || order.paymentInfo?.provider || 'stripe',
    paymentIntentId: extra.paymentIntentId || order.paymentInfo?.paymentIntentId,
    paymentStatus: extra.paymentStatus || 'succeeded',
    receiptEmail: extra.receiptEmail || order.paymentInfo?.receiptEmail,
    currency: (extra.currency || order.paymentInfo?.currency || (process.env.CURRENCY || 'usd')).toLowerCase(),
    meta: extra.meta ?? order.paymentInfo?.meta,
  };

  await order.save();

  // Clear user cart (best-effort)
  try {
    await userModel.findByIdAndUpdate(order.userId, { cartData: {} });
  } catch {
    // ignore cart clear failure
  }

  return { ok: true };
};
