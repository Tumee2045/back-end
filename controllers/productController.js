import { v2 as cloudinary } from "cloudinary";
import productModel from "../models/productModel.js";
import fs from 'fs/promises';

// ---------- Add product (brand-first; accepts legacy category as fallback)
const addProduct = async (req, res) => {
  const localPaths = [];
  try {
    // Accept brand primarily; but if brand is absent and category is present (legacy),
    // use category as brand (lowercased) for a smooth migration.
    let {
      name,
      description,
      price,
      brand,             // NEW
      category,          // legacy fallback
      // subcategory,     // removed
      bestseller
    } = req.body;

    if (!brand && category) {
      brand = String(category).toLowerCase();
    }

    if (!name || !price || !brand) {
      return res.status(400).json({
        success: false,
        message: 'name, price, and brand are required'
      });
    }

    const image1 = req.files?.image1?.[0];
    const image2 = req.files?.image2?.[0];
    const image3 = req.files?.image3?.[0];
    const image4 = req.files?.image4?.[0];

    const images = [image1, image2, image3, image4].filter(Boolean);
    images.forEach(f => f?.path && localPaths.push(f.path));

    let imagesUrl = [];
    if (images.length) {
      imagesUrl = await Promise.all(
        images.map(async (item) => {
          const result = await cloudinary.uploader.upload(item.path, { resource_type: 'image' });
          return result.secure_url;
        })
      );
    }

    const productData = {
      name,
      description,
      brand: String(brand).toLowerCase(),
      price: Number(price),
      // subcategory removed
      bestseller: String(bestseller) === 'true',
      image: imagesUrl,
      date: Date.now(),
    };

    const product = new productModel(productData);
    await product.save();

    return res.json({ success: true, message: 'Product Added' });
  } catch (error) {
    console.error('addProduct error:', error);
    return res.status(500).json({ success: false, message: error.message });
  } finally {
    // cleanup temp files regardless of outcome
    await Promise.all(
      localPaths.map(async (p) => { try { await fs.unlink(p); } catch { /* ignore */ } })
    );
  }
};

// ---------- List products (supports ?brand=ledger and legacy ?category=Men)
const listProduct = async (req, res) => {
  try {
    const { brand, category, q, bestseller, minPrice, maxPrice } = req.query;

    const filter = {};

    // brand first; if legacy category passed, use it as brand
    const brandValue = brand || category;
    if (brandValue) filter.brand = String(brandValue).toLowerCase();

    if (q) filter.name = { $regex: q, $options: 'i' };
    if (bestseller === 'true') filter.bestseller = true;
    if (minPrice || maxPrice) {
      filter.price = {};
      if (minPrice) filter.price.$gte = Number(minPrice);
      if (maxPrice) filter.price.$lte = Number(maxPrice);
    }

    const products = await productModel.find(filter);
    return res.json({ success: true, products });
  } catch (error) {
    console.error("listProduct error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ---------- Helper: derive Cloudinary public_id from secure_url
function derivePublicIdFromUrl(url) {
  try {
    const u = new URL(url);
    if (!u.hostname.endsWith('res.cloudinary.com')) return null;

    const parts = u.pathname.split('/').filter(Boolean);
    const uploadIdx = parts.findIndex(p => p === 'upload');
    if (uploadIdx === -1) return null;

    const rest = parts.slice(uploadIdx + 1);
    const restNoVersion = rest[0] && /^v\d+$/.test(rest[0]) ? rest.slice(1) : rest;
    if (restNoVersion.length === 0) return null;

    const filePath = restNoVersion.join('/');
    const dot = filePath.lastIndexOf('.');
    return dot > 0 ? filePath.slice(0, dot) : filePath;
  } catch {
    return null;
  }
}

// ---------- Remove product (with best-effort Cloudinary cleanup)
const removeProduct = async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) {
      return res.status(400).json({ success: false, message: "Product id is required" });
    }

    const product = await productModel.findById(id).select('image');
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    const imgs = Array.isArray(product.image) ? product.image : [];
    await Promise.all(
      imgs.map(async (url) => {
        const publicId = derivePublicIdFromUrl(url);
        if (!publicId) return;
        try { await cloudinary.uploader.destroy(publicId, { resource_type: 'image' }); }
        catch { /* ignore */ }
      })
    );

    await productModel.findByIdAndDelete(id);
    return res.json({ success: true, message: "Product Removed" });
  } catch (error) {
    console.error("removeProduct error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ---------- Single product
const singleProduct = async (req, res) => {
  try {
    const { productId } = req.body;
    if (!productId) return res.status(400).json({ success: false, message: "productId is required" });

    const product = await productModel.findById(productId);
    if (!product) return res.status(404).json({ success: false, message: "Product not found" });

    return res.json({ success: true, product });
  } catch (error) {
    console.error("singleProduct error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export { listProduct, addProduct, removeProduct, singleProduct };
