import express from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { getDatabase } from '../database.js';
import {
  commentById,
  commentsForTask,
  newId,
  nowIso,
  projectById,
  projectByIdForMember,
  taskById,
  usersForProject,
} from '../data.js';
import { createNotifications } from '../services/notifications.js';
import { emitToProject } from '../services/realtime.js';

const router = express.Router();
router.use(requireAuth);

function accessibleTask(taskId, userId) {
  const task = taskById(taskId);
  if (!task || !projectByIdForMember(task.project, userId)) return null;
  return task;
}

async function notifyMentionedMembers({ text, task, comment, actor }) {
  const mentionEmails = [...new Set(
    text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)?.map((email) => email.toLowerCase()) || [],
  )];
  if (!mentionEmails.length) return;

  const mentioned = usersForProject(task.project).filter((member) =>
    mentionEmails.includes(member.email.toLowerCase()) && member._id !== actor._id);
  await createNotifications(mentioned.map((member) => ({
    recipient: member._id,
    actor: actor._id,
    project: task.project,
    task: task._id,
    type: 'comment-mention',
    message: `${actor.name} mentioned you on a task.`,
    dedupeKey: `mention:${comment._id}:${member._id}:${comment.updatedAt}`,
  })));
}

router.get('/tasks/:taskId/comments', asyncHandler(async (req, res) => {
  if (!accessibleTask(req.params.taskId, req.user._id)) {
    return res.status(404).json({ message: 'Task not found.' });
  }
  res.json({ comments: commentsForTask(req.params.taskId) });
}));

router.post('/tasks/:taskId/comments', asyncHandler(async (req, res) => {
  const text = typeof req.body.text === 'string' ? req.body.text.trim() : '';
  if (!text || text.length > 2000) {
    return res.status(400).json({ message: 'Comment text must contain between 1 and 2,000 characters.' });
  }
  const task = accessibleTask(req.params.taskId, req.user._id);
  if (!task) return res.status(404).json({ message: 'Task not found.' });

  const id = newId();
  const now = nowIso();
  getDatabase().prepare(`
    INSERT INTO comments (id, text, task_id, author_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, text, task._id, req.user._id, now, now);
  const comment = commentById(id);
  emitToProject(task.project, 'comment:created', {
    projectId: task.project,
    taskId: task._id,
    comment,
  });
  try {
    await notifyMentionedMembers({ text, task, comment, actor: req.user });
  } catch (error) {
    console.error('Failed to notify mentioned project members:', error);
  }
  res.status(201).json({ comment });
}));

router.patch('/comments/:commentId', asyncHandler(async (req, res) => {
  const text = typeof req.body.text === 'string' ? req.body.text.trim() : '';
  if (!text || text.length > 2000) {
    return res.status(400).json({ message: 'Comment text must contain between 1 and 2,000 characters.' });
  }
  const existing = commentById(req.params.commentId);
  if (!existing || !accessibleTask(existing.task, req.user._id)) {
    return res.status(404).json({ message: 'Comment not found.' });
  }
  if (existing.author._id !== req.user._id) {
    return res.status(403).json({ message: 'You can only edit your own comments.' });
  }
  getDatabase().prepare('UPDATE comments SET text = ?, updated_at = ? WHERE id = ?')
    .run(text, nowIso(), existing._id);
  const comment = commentById(existing._id);
  const task = taskById(existing.task);
  emitToProject(task.project, 'comment:updated', {
    projectId: task.project,
    taskId: task._id,
    comment,
  });
  try {
    await notifyMentionedMembers({ text, task, comment, actor: req.user });
  } catch (error) {
    console.error('Failed to notify mentioned project members:', error);
  }
  res.json({ comment });
}));

router.delete('/comments/:commentId', asyncHandler(async (req, res) => {
  const comment = commentById(req.params.commentId);
  if (!comment) return res.status(404).json({ message: 'Comment not found.' });
  const task = accessibleTask(comment.task, req.user._id);
  if (!task) return res.status(404).json({ message: 'Comment not found.' });
  const project = projectById(task.project);
  if (!project) return res.status(404).json({ message: 'Comment not found.' });
  if (comment.author._id !== req.user._id && project.owner.id !== req.user.id) {
    return res.status(403).json({ message: 'You cannot delete this comment.' });
  }
  getDatabase().prepare('DELETE FROM comments WHERE id = ?').run(comment._id);
  emitToProject(project._id, 'comment:deleted', {
    projectId: project._id,
    taskId: task._id,
    commentId: comment._id,
  });
  res.status(204).end();
}));

export default router;
