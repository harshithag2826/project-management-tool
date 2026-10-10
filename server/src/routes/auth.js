import bcrypt from 'bcryptjs';
import express from 'express';
import jwt from 'jsonwebtoken';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { getDatabase } from '../database.js';
import { newId, nowIso, userByEmail } from '../data.js';

const router = express.Router();

function createToken(user) {
  return jwt.sign({ sub: user.id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

function presentUser(user) {
  return { id: user.id, name: user.name, email: user.email };
}

router.post('/register', asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ message: 'Enter your name.' });
  }
  if (name.trim().length > 80) {
    return res.status(400).json({ message: 'Your name must be 80 characters or fewer.' });
  }
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.trim().length > 254) {
    return res.status(400).json({ message: 'Enter a valid email address.' });
  }
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ message: 'Use a password with at least 8 characters.' });
  }
  if (Buffer.byteLength(password, 'utf8') > 72) {
    return res.status(400).json({ message: 'Password must be 72 bytes or fewer.' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  try {
    if (userByEmail(normalizedEmail)) {
      return res.status(409).json({
        message: 'That email address is already registered.',
        error: 'An account with this email already exists.',
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const userId = newId();
    const now = nowIso();
    getDatabase().prepare(`
      INSERT INTO users (id, name, email, password_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, name.trim(), normalizedEmail, passwordHash, now, now);
    const user = { id: userId, name: name.trim(), email: normalizedEmail };
    const token = createToken(user);
    res.status(201).json({ token, user: presentUser(user) });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({
        message: 'That email address is already registered.',
        error: 'An account with this email already exists.',
      });
    }
    console.error('Registration failed unexpectedly:', error);
    return res.status(500).json({ message: 'Registration failed. Check the backend logs for details.' });
  }
}));

router.post('/login', asyncHandler(async (req, res) => {
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !password) {
    return res.status(400).json({ message: 'Enter a valid email address and password.' });
  }
  if (Buffer.byteLength(password, 'utf8') > 72) {
    return res.status(400).json({ message: 'Password must be 72 bytes or fewer.' });
  }
  const user = userByEmail(email);
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ message: 'Email or password is incorrect.' });
  }
  res.json({ token: createToken(user), user: presentUser(user) });
}));

router.get('/me', requireAuth, (req, res) => res.json({ user: presentUser(req.user) }));

export default router;
