import express from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { getDatabase } from '../database.js';

const router = express.Router();
router.use(requireAuth);

router.get('/', asyncHandler(async (req, res) => {
  const users = getDatabase().prepare(`
    SELECT id AS _id, id, name, email
    FROM users WHERE id != ?
    ORDER BY name COLLATE NOCASE
    LIMIT 100
  `).all(req.user._id);
  res.json({ users });
}));

export default router;
