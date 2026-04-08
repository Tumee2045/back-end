// models/orderModel.js
import mongoose from 'mongoose';

const paymentInfoSchema = new mongoose.Schema(
  {
    provider: { type: String, default: 'stripe' },   // 'stripe', 'paypal', etc.
    paymentIntentId: { type: String },
    paymentStatus: { type: String },                 // 'processing','succeeded','failed',...
    receiptEmail: { type: String },
    currency: {
      type: String,
      lowercase: true,
      default: (process.env.CURRENCY || 'usd').toLowerCase(),
    },
    meta: { type: mongoose.Schema.Types.Mixed },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'user', required: true },
    items:  { type: Array,  required: true },          // [{ _id, quantity, ... }]
    amount: { type: Number, required: true },          // major units (e.g., 49.99)
    address:{ type: Object, required: true },

    status: {
      type: String,
      required: true,
      default: 'Order Placed',
      enum: ['Order Placed', 'Processing', 'Paid', 'Shipped', 'Delivered', 'Cancelled'],
    },

    paymentMethod: { type: String, required: true, default: 'stripe' },
    payment: { type: Boolean, required: true, default: false },

    paymentInfo: paymentInfoSchema,

    date: { type: Number, required: true },
  },
  { timestamps: true }
);

orderSchema.index({ userId: 1, date: -1 });
orderSchema.index({ status: 1 });
orderSchema.index({ 'paymentInfo.paymentIntentId': 1 }, { sparse: true });

const orderModel = mongoose.models.order || mongoose.model('order', orderSchema);
export default orderModel;
