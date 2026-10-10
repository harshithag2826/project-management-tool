import jwt from 'jsonwebtoken';
import { asyncHandler } from './asyncHandler.js';
import { isValidId, userById } from '../data.js';

export const requireAuth = asyncHandler(async (req, res, next) => {
  const match = /^Bearer ([^\s]+)$/i.exec(req.get('authorization') || '');
  if (!match) {
    return res.status(401).json({ message: 'Sign in to continue.' });
  }

  let payload;
  try {
    payload = jwt.verify(match[1], process.env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    return res.status(401).json({ message: 'Your session is invalid or expired.' });
  }

  if (typeof payload !== 'object' || typeof payload.sub !== 'string' ||
      !isValidId(payload.sub)) {
    return res.status(401).json({ message: 'Your session is invalid or expired.' });
  }
  const user = userById(payload.sub);
  if (!user) return res.status(401).json({ message: 'Your account no longer exists.' });
  req.user = user;
  next();
});
