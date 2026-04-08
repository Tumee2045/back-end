// config/stripe.js
import Stripe from "stripe";
import dotenv from "dotenv";
dotenv.config();

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("⚠️ STRIPE_SECRET_KEY is missing in .env");
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20", // Pin API version for stability
  maxNetworkRetries: 2,     // Retry transient network errors
  timeout: 20000,           // 20s request timeout 
});
