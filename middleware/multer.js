import multer from 'multer';
import path from 'path';
import fs from 'fs';

const uploadPath = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadPath)) {
  fs.mkdirSync(uploadPath, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadPath),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    // Accept common image MIME types; extension fallback kept
    const allowedExt = /(\.jpe?g|\.png|\.webp)$/i.test(file.originalname);
    const allowedMime = /^image\/(jpeg|png|webp)$/.test(file.mimetype);
    (allowedExt && allowedMime) ? cb(null, true) : cb(new Error('Only image files are allowed'));
  },
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

export default upload;
