import mongoose from 'mongoose';
import productModel from '../models/productModel.js';
import userModel from '../models/userModel.js';

const MAX_CART_QUANTITY = 99;

const normalizeItemId = (itemId) => (typeof itemId === 'string' ? itemId.trim() : '');

const normalizeQuantity = (quantity) => {
  const parsed = Number(quantity);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_CART_QUANTITY) {
    return null;
  }

  return parsed;
};

const ensureRealProduct = async (itemId) => {
  if (!itemId || !mongoose.Types.ObjectId.isValid(itemId)) {
    return false;
  }

  const product = await productModel.exists({ _id: itemId });
  return Boolean(product);
};

const addToCart = async (req, res) => {
  try {
    const userId = req.userId;
    const itemId = normalizeItemId(req.body?.itemId);

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    if (!itemId) {
      return res.status(400).json({ success: false, message: 'Invalid or missing itemId' });
    }

    if (!(await ensureRealProduct(itemId))) {
      return res.status(400).json({ success: false, message: 'Product not found' });
    }

    const user = await userModel.findById(userId).select('cartData');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const currentQuantity = Number(user.cartData?.[itemId]) || 0;
    if (currentQuantity >= MAX_CART_QUANTITY) {
      return res.status(400).json({
        success: false,
        message: `Maximum quantity is ${MAX_CART_QUANTITY} for one item`,
      });
    }

    await userModel.updateOne(
      { _id: userId },
      { $set: { [`cartData.${itemId}`]: currentQuantity + 1 } }
    );

    return res.json({ success: true, message: 'Added to cart' });
  } catch (error) {
    console.error('addToCart error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

const updateCart = async (req, res) => {
  try {
    const userId = req.userId;
    const itemId = normalizeItemId(req.body?.itemId);
    const quantity = normalizeQuantity(req.body?.quantity);

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    if (!itemId) {
      return res.status(400).json({ success: false, message: 'Invalid or missing itemId' });
    }

    if (quantity === null) {
      return res.status(400).json({
        success: false,
        message: `Quantity must be an integer between 0 and ${MAX_CART_QUANTITY}`,
      });
    }

    const user = await userModel.findById(userId).select('_id');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (quantity > 0 && !(await ensureRealProduct(itemId))) {
      return res.status(400).json({ success: false, message: 'Product not found' });
    }

    if (quantity === 0) {
      await userModel.updateOne(
        { _id: userId },
        { $unset: { [`cartData.${itemId}`]: '' } }
      );
    } else {
      await userModel.updateOne(
        { _id: userId },
        { $set: { [`cartData.${itemId}`]: quantity } }
      );
    }

    return res.json({ success: true, message: 'Cart updated' });
  } catch (error) {
    console.error('updateCart error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

const getUserCart = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const user = await userModel.findById(userId).select('cartData');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const cartData = Object.entries(user.cartData || {}).reduce((nextCart, [itemId, quantity]) => {
      const normalizedQuantity = normalizeQuantity(quantity);
      if (mongoose.Types.ObjectId.isValid(itemId) && normalizedQuantity && normalizedQuantity > 0) {
        nextCart[itemId] = normalizedQuantity;
      }
      return nextCart;
    }, {});

    return res.json({ success: true, cartData });
  } catch (error) {
    console.error('getUserCart error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export { addToCart, updateCart, getUserCart };
