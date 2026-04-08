// routes/orderRoute.js
import express from 'express';
import {
  placeOrder,
  placeOrderStripe,
  allOrders,
  userOrders,
  updateStatus,
  confirmPayment,
  verifySession,
} from '../controllers/orderController.js';
import adminAuth from '../middleware/adminAuth.js';
import authUser from '../middleware/auth.js';

const orderRouter = express.Router();

// Admin features
orderRouter.post('/list', adminAuth, allOrders);
orderRouter.post('/status', adminAuth, updateStatus);

// Stripe-only payment flow
orderRouter.post('/stripe', authUser, placeOrderStripe);
orderRouter.post('/place', authUser, placeOrder);

// User features
orderRouter.post('/userorders', authUser, userOrders);

orderRouter.post('/verify-session', authUser, verifySession);
orderRouter.post('/confirm-payment', authUser, confirmPayment);

export default orderRouter;
