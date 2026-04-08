import jwt from 'jsonwebtoken';

const authUser = (req, res, next) => {
  try {
    const authHeader = (req.headers.authorization || '').trim();

    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Authorization header missing or invalid.',
      });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.userId = decoded.id;
    next();
  } catch (error) {
    console.error('JWT verification error:', error.message);
    res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
};

export default authUser;
