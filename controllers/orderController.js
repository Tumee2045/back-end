import validator from 'validator';
import { stripe } from '../config/stripe.js';
import orderModel from '../models/orderModel.js';
import userModel from '../models/userModel.js';
import { computeTotals, toMinor } from '../helpers/orderTotals.js';
import { finalizePaidOrder } from '../helpers/orders.js';

const CURRENCY = (process.env.CURRENCY || 'usd').toLowerCase();
const DELIVERY_FEE = Number(process.env.DELIVERY_FEE || 10);
const DEV_FRONTEND_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
];
const REQUIRED_ADDRESS_FIELDS = [
  'firstName',
  'lastName',
  'email',
  'street',
  'city',
  'state',
  'zipcode',
  'country',
  'phone',
];

const resolveFrontendBaseUrl = (req) => {
  const configuredOrigins = [
    process.env.FRONTEND_URL,
    process.env.FRONTEND_URL_ALT,
    ...DEV_FRONTEND_ORIGINS,
  ]
    .filter(Boolean)
    .flatMap((candidate) => {
      try {
        return [new URL(candidate).origin];
      } catch {
        return [];
      }
    });

  const requestOrigin = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : '';
  if (requestOrigin && configuredOrigins.includes(requestOrigin)) {
    return requestOrigin;
  }

  for (const candidate of configuredOrigins) {
    try {
      return new URL(candidate).origin;
    } catch {
      // Try the next configured frontend URL.
    }
  }

  return null;
};

const getMissingAddressFields = (address) => {
  if (!address || typeof address !== 'object') {
    return [...REQUIRED_ADDRESS_FIELDS];
  }

  return REQUIRED_ADDRESS_FIELDS.filter((field) => {
    const value = address[field];
    return typeof value !== 'string' || value.trim() === '';
  });
};

const getCustomerEmail = (...candidates) => {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') {
      continue;
    }

    const normalized = candidate.trim().toLowerCase();
    if (validator.isEmail(normalized)) {
      return normalized;
    }
  }

  return undefined;
};

const buildCheckoutLineItems = (orderItems) => {
  const productLineItems = orderItems.map((item) => ({
    price_data: {
      currency: CURRENCY,
      unit_amount: toMinor(item.price),
      product_data: {
        name: item.name,
        images: Array.isArray(item.image) ? item.image.filter(Boolean).slice(0, 1) : [],
      },
    },
    quantity: item.quantity,
  }));

  if (DELIVERY_FEE > 0) {
    productLineItems.push({
      price_data: {
        currency: CURRENCY,
        unit_amount: toMinor(DELIVERY_FEE),
        product_data: {
          name: 'Delivery',
        },
      },
      quantity: 1,
    });
  }

  return productLineItems;
};

const buildFinalizeExtra = ({
  checkoutSessionId,
  currency = CURRENCY,
  paymentIntentId,
  paymentStatus = 'succeeded',
  receiptEmail,
  source,
}) => ({
  provider: 'stripe',
  paymentIntentId,
  paymentStatus,
  currency,
  receiptEmail,
  meta: {
    checkoutSessionId,
    source,
  },
});

const placeOrder = async (_req, res) =>
  res
    .status(410)
    .json({ success: false, message: 'Cash on Delivery is disabled. Use Stripe.' });

const placeOrderStripe = async (req, res) => {
  let orderDoc;

  try {
    const userId = req.userId;
    const { items, address, receiptEmail } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'No items provided' });
    }

    if (items.length > 50) {
      return res.status(400).json({ success: false, message: 'Too many items' });
    }

    const missingAddressFields = getMissingAddressFields(address);
    if (missingAddressFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Missing address fields: ${missingAddressFields.join(', ')}`,
      });
    }

    const user = await userModel.findById(userId).select('_id email');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const {
      total,
      orderItems,
      missingItemIds,
      invalidItemIds,
    } = await computeTotals(items, DELIVERY_FEE);

    if (invalidItemIds.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Invalid cart items: ${invalidItemIds.join(', ')}`,
      });
    }

    if (missingItemIds.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Products no longer available: ${missingItemIds.join(', ')}`,
      });
    }

    if (orderItems.length === 0) {
      return res.status(400).json({ success: false, message: 'No valid items provided' });
    }

    const frontendBaseUrl = resolveFrontendBaseUrl(req);
    if (!frontendBaseUrl) {
      return res.status(500).json({
        success: false,
        message: 'Frontend URL is not configured for Stripe redirects',
      });
    }

    const customerEmail = getCustomerEmail(receiptEmail, address?.email, user.email);

    orderDoc = await orderModel.create({
      userId,
      items: orderItems,
      amount: total,
      address,
      status: 'Order Placed',
      paymentMethod: 'Stripe',
      payment: false,
      paymentInfo: {
        provider: 'stripe',
        paymentStatus: 'pending',
        receiptEmail: customerEmail,
        currency: CURRENCY,
      },
      date: Date.now(),
    });

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: buildCheckoutLineItems(orderItems),
      success_url: `${frontendBaseUrl}/verify?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendBaseUrl}/verify?canceled=true`,
      customer_email: customerEmail,
      metadata: {
        orderId: orderDoc._id.toString(),
        userId: userId?.toString() || '',
      },
      payment_intent_data: {
        metadata: {
          orderId: orderDoc._id.toString(),
          userId: userId?.toString() || '',
        },
      },
    });

    orderDoc.paymentInfo = {
      ...(orderDoc.paymentInfo?.toObject?.() || orderDoc.paymentInfo || {}),
      provider: 'stripe',
      paymentStatus: 'pending',
      receiptEmail: customerEmail,
      currency: CURRENCY,
      meta: {
        checkoutSessionId: session.id,
        source: 'checkout-session',
      },
    };
    await orderDoc.save();

    return res.json({
      success: true,
      orderId: orderDoc._id.toString(),
      session_id: session.id,
      session_url: session.url,
    });
  } catch (error) {
    if (orderDoc?._id) {
      try {
        await orderModel.findByIdAndDelete(orderDoc._id);
      } catch {
        // Leave the failed pending order in place if cleanup also fails.
      }
    }

    console.error('placeOrderStripe error:', error);
    return res.status(500).json({ success: false, message: 'Stripe error, please try again.' });
  }
};

const allOrders = async (_req, res) => {
  try {
    const orders = await orderModel.find({}).sort({ date: -1 });
    return res.json({ success: true, orders });
  } catch (error) {
    console.error('allOrders error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load orders' });
  }
};

const userOrders = async (req, res) => {
  try {
    const orders = await orderModel.find({ userId: req.userId }).sort({ date: -1 });
    return res.json({ success: true, orders });
  } catch (error) {
    console.error('userOrders error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load your orders' });
  }
};

const ALLOWED_STATUSES = [
  'Order Placed',
  'Processing',
  'Paid',
  'Shipped',
  'Delivered',
  'Cancelled',
];

const updateStatus = async (req, res) => {
  try {
    const { orderId, status } = req.body;
    if (!orderId || !status) {
      return res.status(400).json({ success: false, message: 'orderId and status are required' });
    }

    if (!ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status value' });
    }

    const updatedOrder = await orderModel.findByIdAndUpdate(orderId, { status }, { new: true });
    if (!updatedOrder) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    return res.json({ success: true, message: 'Status Updated' });
  } catch (error) {
    console.error('updateStatus error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update order status' });
  }
};

const confirmPayment = async (req, res) => {
  try {
    const { orderId, paymentIntentId } = req.body;
    if (!orderId || !paymentIntentId) {
      return res
        .status(400)
        .json({ success: false, message: 'orderId and paymentIntentId are required' });
    }

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (paymentIntent.status !== 'succeeded') {
      return res.json({
        success: false,
        message: `PaymentIntent status: ${paymentIntent.status}`,
      });
    }

    if (paymentIntent.metadata?.orderId && paymentIntent.metadata.orderId !== orderId) {
      return res.status(400).json({ success: false, message: 'Payment does not match this order' });
    }

    if (
      paymentIntent.metadata?.userId
      && req.userId
      && paymentIntent.metadata.userId !== String(req.userId)
    ) {
      return res.status(403).json({ success: false, message: 'Payment does not belong to this user' });
    }

    const result = await finalizePaidOrder(
      orderId,
      req.userId,
      buildFinalizeExtra({
        paymentIntentId: paymentIntent.id,
        paymentStatus: paymentIntent.status,
        currency: paymentIntent.currency,
        receiptEmail: getCustomerEmail(paymentIntent.receipt_email),
        source: 'confirm-payment',
      })
    );

    if (!result.ok) {
      return res.status(400).json({ success: false, message: `Finalize failed: ${result.reason}` });
    }

    return res.json({ success: true, message: 'Payment confirmed' });
  } catch (error) {
    console.error('confirmPayment error:', error);
    return res.status(500).json({ success: false, message: 'Error confirming payment' });
  }
};

const verifySession = async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ success: false, message: 'sessionId is required' });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['payment_intent'],
    });

    const orderId = session.metadata?.orderId;
    if (!orderId) {
      return res.status(400).json({ success: false, message: 'Session is missing order metadata' });
    }

    if (session.metadata?.userId && session.metadata.userId !== String(req.userId)) {
      return res.status(403).json({ success: false, message: 'Session does not belong to this user' });
    }

    if (session.payment_status !== 'paid') {
      return res.status(400).json({
        success: false,
        message: `Checkout session status: ${session.payment_status}`,
      });
    }

    const paymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id;

    const result = await finalizePaidOrder(
      orderId,
      req.userId,
      buildFinalizeExtra({
        checkoutSessionId: session.id,
        paymentIntentId,
        paymentStatus: session.payment_status,
        currency: session.currency,
        receiptEmail: getCustomerEmail(session.customer_details?.email, session.customer_email),
        source: 'verify-session',
      })
    );

    if (!result.ok) {
      return res.status(400).json({ success: false, message: `Finalize failed: ${result.reason}` });
    }

    return res.json({ success: true, message: 'Payment confirmed' });
  } catch (error) {
    console.error('verifySession error:', error);
    return res.status(500).json({ success: false, message: 'Error verifying session' });
  }
};

const stripeWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const whSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!whSecret) {
    return res.status(500).send('Webhook secret not configured');
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, whSecret);
  } catch (error) {
    console.error('Webhook signature verification failed.', error.message);
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const orderId = session.metadata?.orderId;
        const userId = session.metadata?.userId;

        if (orderId && session.payment_status === 'paid') {
          await finalizePaidOrder(
            orderId,
            userId,
            buildFinalizeExtra({
              checkoutSessionId: session.id,
              paymentIntentId:
                typeof session.payment_intent === 'string'
                  ? session.payment_intent
                  : undefined,
              paymentStatus: session.payment_status,
              currency: session.currency,
              receiptEmail: getCustomerEmail(session.customer_details?.email, session.customer_email),
              source: 'webhook-checkout-session',
            })
          );
        }
        break;
      }

      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object;
        const orderId = paymentIntent.metadata?.orderId;
        const userId = paymentIntent.metadata?.userId;

        if (orderId) {
          await finalizePaidOrder(
            orderId,
            userId,
            buildFinalizeExtra({
              paymentIntentId: paymentIntent.id,
              paymentStatus: paymentIntent.status,
              currency: paymentIntent.currency,
              receiptEmail: getCustomerEmail(paymentIntent.receipt_email),
              source: 'webhook-payment-intent',
            })
          );
        }
        break;
      }

      default:
        break;
    }

    return res.json({ received: true });
  } catch (error) {
    console.error('stripeWebhook handler error:', error);
    return res.status(500).send('Webhook handler error');
  }
};

export {
  placeOrder,
  placeOrderStripe,
  allOrders,
  userOrders,
  updateStatus,
  confirmPayment,
  verifySession,
  stripeWebhook,
};
