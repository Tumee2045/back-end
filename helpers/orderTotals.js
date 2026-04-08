// helpers/orderTotals.js
import mongoose from 'mongoose';
import productModel from '../models/productModel.js';

const MAX_ORDER_QUANTITY = 99;

/**
 * Convert major units (e.g., 49.99) to minor (e.g., 4999)
 * Exported for controllers that need Stripe minor units.
 */
export const toMinor = (n) => Math.round(Number(n) * 100);

const extractItemId = (item) => {
  const candidate = item?._id ?? item?.itemId ?? item?.productId;
  return typeof candidate === 'string' ? candidate.trim() : '';
};

/**
 * Compute trusted totals from DB prices and return order-safe product snapshots.
 * Signature kept: computeTotals(items, delivery = 10)
 *
 * @param {Array<{_id?:string, itemId?:string, productId?:string, quantity:number}>} items
 * @param {number} delivery   Delivery in MAJOR units (e.g., 10 means $10.00)
 * @returns {Promise<{
 *   subtotal:number,
 *   delivery:number,
 *   total:number,
 *   lines:Array,
 *   orderItems:Array,
 *   missingItemIds:Array<string>,
 *   invalidItemIds:Array<string>
 * }>}
 */
export async function computeTotals(items, delivery = 10) {
  const normalizedDelivery = Number(delivery || 0);

  if (!Array.isArray(items) || items.length === 0) {
    return {
      subtotal: 0,
      delivery: normalizedDelivery,
      total: normalizedDelivery,
      lines: [],
      orderItems: [],
      missingItemIds: [],
      invalidItemIds: [],
    };
  }

  const mergedItems = new Map();
  const invalidItemIds = [];

  for (const item of items) {
    const itemId = extractItemId(item);
    const quantity = Number(item?.quantity);

    if (!itemId || !mongoose.Types.ObjectId.isValid(itemId)) {
      invalidItemIds.push(itemId || '(missing)');
      continue;
    }

    if (!Number.isInteger(quantity) || quantity < 1) {
      invalidItemIds.push(itemId);
      continue;
    }

    const currentQuantity = mergedItems.get(itemId) || 0;
    mergedItems.set(itemId, Math.min(MAX_ORDER_QUANTITY, currentQuantity + quantity));
  }

  const normalized = [...mergedItems.entries()].map(([_id, quantity]) => ({ _id, quantity }));
  if (normalized.length === 0) {
    return {
      subtotal: 0,
      delivery: normalizedDelivery,
      total: normalizedDelivery,
      lines: [],
      orderItems: [],
      missingItemIds: [],
      invalidItemIds,
    };
  }

  const ids = normalized.map((item) => item._id);
  const dbProducts = await productModel
    .find({ _id: { $in: ids } })
    .select('_id price name brand image');

  const productMap = new Map(
    dbProducts.map((product) => [
      product._id.toString(),
      {
        _id: product._id.toString(),
        name: product.name,
        brand: product.brand,
        image: Array.isArray(product.image) ? product.image : [],
        price: Number(product.price) || 0,
      },
    ])
  );

  const missingItemIds = [];
  const orderItems = [];
  const lines = [];
  let subtotal = 0;

  for (const item of normalized) {
    const product = productMap.get(item._id);
    if (!product) {
      missingItemIds.push(item._id);
      continue;
    }

    const lineTotal = product.price * item.quantity;
    subtotal += lineTotal;

    orderItems.push({
      _id: product._id,
      name: product.name,
      brand: product.brand,
      image: product.image,
      price: product.price,
      quantity: item.quantity,
    });

    lines.push({
      _id: product._id,
      name: product.name,
      quantity: item.quantity,
      unitPrice: product.price,
      lineTotal,
      found: true,
    });
  }

  return {
    subtotal,
    delivery: normalizedDelivery,
    total: subtotal + normalizedDelivery,
    lines,
    orderItems,
    missingItemIds,
    invalidItemIds,
  };
}
