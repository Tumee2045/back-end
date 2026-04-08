// server.js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
dotenv.config();

import connectDB from './config/mongodb.js';
import connectCloudinary from './config/cloudinary.js';

// Routers
import userRouter from './routes/userRoute.js';
import productRouter from './routes/productRoute.js';
import cartRouter from './routes/cartRoute.js';
import orderRouter from './routes/orderRoute.js';
import { stripeWebhook } from './controllers/orderController.js';

import rateLimit from 'express-rate-limit';

const app = express();
const port = process.env.PORT || 4000;

// --- Connect external services
connectDB();
connectCloudinary();

// --- Rate limiting (auth endpoints)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' },
});
app.use('/api/user', authLimiter);

// --- Stripe Webhook (⚠️ must be BEFORE express.json)
app.post(
  '/api/order/webhook',
  express.raw({ type: 'application/json' }),
  stripeWebhook
);

// --- Normal middleware (after webhook)
const allowedOrigins = [
  process.env.FRONTEND_URL,
  process.env.FRONTEND_URL_ALT,
  'http://localhost:5173',   // Vite dev (FE)
  'http://127.0.0.1:5173',
  'http://localhost:5174',   // Vite dev (admin)
  'http://127.0.0.1:5174',
].filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // allow Postman / curl
      return allowedOrigins.includes(origin)
        ? cb(null, true)
        : cb(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Optional: handle CORS errors gracefully
app.use((err, _req, res, next) => {
  if (err?.message === 'Not allowed by CORS') {
    return res.status(403).json({ success: false, message: 'CORS: origin not allowed' });
  }
  return next(err);
});

// Parse JSON (for everything except webhook)
app.use(express.json());

// --- API routes
app.use('/api/user', userRouter);
app.use('/api/product', productRouter);
app.use('/api/cart', cartRouter);
app.use('/api/order', orderRouter);

// --- Health check
app.get('/', (_req, res) => {
  res.send('API Working');
});

// --- Global error handler
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, message: 'Server error' });
});

// --- Start server
app.listen(port, () => {
  console.log(`🚀 Server started on PORT: ${port}`);
});
