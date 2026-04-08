import mongoose from "mongoose";

const productSchema = new mongoose.Schema({
  name        : { type: String, required: true },
  description : { type: String, required: true },
  price       : { type: Number, required: true },
  image       : { type: [String], required: true },

  // NEW: replace category/subcategory with brand
  brand       : {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    enum: [
      'ledger', 'trezor', 'keystone', 'bitbox', 'gridplus', 'ellipal', 'secalot', 'safepal'
      // add or remove as needed
    ]
  },

  bestseller  : { type: Boolean, default: false },
  date        : { type: Number, required: true },
});

// helpful indexes
productSchema.index({ brand: 1 });
productSchema.index({ name: 'text', description: 'text' });

const productModel = mongoose.models.product || mongoose.model("product", productSchema);
export default productModel;
