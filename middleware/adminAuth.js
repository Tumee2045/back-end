import jwt from 'jsonwebtoken';

const adminAuth = (req, res, next) => {
  try {
    const authHeader = (req.headers.authorization || '').trim();
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Access denied. Admins only.' });
    }

    req.admin = { role: 'admin' };
    return next();
  } catch (error) {
    console.error('Admin auth error:', error.message);
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
};

export default adminAuth;
