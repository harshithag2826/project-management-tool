import express from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { getDatabase } from '../database.js';
import { isValidId, newId, notificationsForUser, nowIso, notificationById } from '../data.js';

const router = express.Router();
router.use(requireAuth);

router.get('/', asyncHandler(async (req, res) => {
  const db = getDatabase();
  const notifications = notificationsForUser(req.user._id);
  const { unreadCount } = db.prepare(`
    SELECT COUNT(*) AS unreadCount FROM notifications
    WHERE recipient_id = ? AND read_at IS NULL
  `).get(req.user._id);
  res.json({ notifications, unreadCount });
}));

router.patch('/read-all', asyncHandler(async (req, res) => {
  getDatabase().prepare(`
    UPDATE notifications SET read_at = ?, updated_at = ?
    WHERE recipient_id = ? AND read_at IS NULL
  `).run(nowIso(), nowIso(), req.user._id);
  res.json({ message: 'All notifications marked as read.' });
}));

router.patch('/:notificationId/read', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.notificationId)) {
    return res.status(404).json({ message: 'Notification not found.' });
  }
  const db = getDatabase();
  const notification = db.prepare(`
    SELECT id FROM notifications WHERE id = ? AND recipient_id = ?
  `).get(req.params.notificationId, req.user._id);
  if (!notification) return res.status(404).json({ message: 'Notification not found.' });
  const now = nowIso();
  db.prepare(`
    UPDATE notifications SET read_at = COALESCE(read_at, ?), updated_at = ?
    WHERE id = ? AND recipient_id = ?
  `).run(now, now, notification.id, req.user._id);
  res.json({ notification: notificationById(notification.id) });
}));

export default router;
