import express from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { getDatabase } from '../database.js';
import { newId, nowIso, projectByIdForMember, taskById } from '../data.js';
import { emitToProject } from '../services/realtime.js';
import { sendAssignmentNotification } from '../services/notifications.js';

const router = express.Router();
router.use(requireAuth);
const statuses = new Set(['todo', 'in-progress', 'done']);
const priorities = new Set(['low', 'medium', 'high']);

function parseDueDate(value) {
  if (value === null || value === '' || value === undefined) return null;
  if (typeof value !== 'string') {
    const error = new Error('Enter a valid due date.');
    error.status = 400;
    throw error;
  }
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(dateOnly ? `${value}T12:00:00.000Z` : value);
  if (Number.isNaN(date.getTime()) || (dateOnly && date.toISOString().slice(0, 10) !== value)) {
    const error = new Error('Enter a valid due date.');
    error.status = 400;
    throw error;
  }
  return date.toISOString();
}

router.get('/', asyncHandler(async (req, res) => {
  const projectId = req.query.projectId;
  if (typeof projectId !== 'string' || !projectId) {
    return res.status(400).json({ message: 'A project ID is required.' });
  }
  const project = projectByIdForMember(projectId, req.user._id);
  if (!project) return res.status(404).json({ message: 'Project not found.' });
  const tasks = getDatabase().prepare(`
    SELECT id FROM tasks WHERE project_id = ? ORDER BY created_at DESC
  `).all(project._id).map(({ id }) => taskById(id));
  res.json({ tasks });
}));

router.post('/', asyncHandler(async (req, res) => {
  const { title, projectId } = req.body;
  if (typeof title !== 'string' || !title.trim() || !projectId) {
    return res.status(400).json({ message: 'A task title and project are required.' });
  }
  if (title.trim().length > 160) {
    return res.status(400).json({ message: 'Task title must be 160 characters or fewer.' });
  }
  if (req.body.description !== undefined &&
      (typeof req.body.description !== 'string' || req.body.description.length > 2000)) {
    return res.status(400).json({ message: 'Task description must be 2,000 characters or fewer.' });
  }
  if (req.body.priority !== undefined && !priorities.has(req.body.priority)) {
    return res.status(400).json({ message: 'Choose a valid task priority.' });
  }
  if (req.body.status !== undefined && !statuses.has(req.body.status)) {
    return res.status(400).json({ message: 'Choose a valid task status.' });
  }
  const project = projectByIdForMember(projectId, req.user._id);
  if (!project) return res.status(404).json({ message: 'Project not found.' });
  let assignedTo = null;
  if (req.body.assignedTo && project.members.some((member) => member._id === req.body.assignedTo)) {
    assignedTo = req.body.assignedTo;
  } else if (req.body.assignedTo) {
    return res.status(400).json({ message: 'Assignee must be a member of this project.' });
  }

  const id = newId();
  const now = nowIso();
  getDatabase().prepare(`
    INSERT INTO tasks (
      id, title, description, status, priority, due_date,
      project_id, assigned_to, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    title.trim(),
    typeof req.body.description === 'string' ? req.body.description.trim() : '',
    req.body.status || 'todo',
    req.body.priority || 'medium',
    parseDueDate(req.body.dueDate),
    project._id,
    assignedTo,
    req.user._id,
    now,
    now,
  );
  const task = taskById(id);
  emitToProject(task.project, 'task:created', { projectId: task.project, task });
  if (task.assignedTo) {
    try {
      await sendAssignmentNotification({
        recipient: task.assignedTo._id,
        actor: req.user._id,
        project: task.project,
        task,
      });
    } catch (error) {
      console.error('Failed to notify the new task assignee:', error);
    }
  }
  res.status(201).json({ task });
}));

router.patch('/:taskId', asyncHandler(async (req, res) => {
  const task = taskById(req.params.taskId);
  if (!task) return res.status(404).json({ message: 'Task not found.' });
  const project = projectByIdForMember(task.project, req.user._id);
  if (!project) return res.status(404).json({ message: 'Task not found.' });
  const previousAssignee = task.assignedTo?._id || '';

  let { title, description, status, priority, dueDate } = task;
  let assignedTo = previousAssignee || null;
  if ('title' in req.body) {
    if (typeof req.body.title !== 'string' || !req.body.title.trim() || req.body.title.trim().length > 160) {
      return res.status(400).json({ message: 'Task title must contain between 1 and 160 characters.' });
    }
    title = req.body.title.trim();
  }
  if ('description' in req.body) {
    if (typeof req.body.description !== 'string' || req.body.description.length > 2000) {
      return res.status(400).json({ message: 'Task description must be 2,000 characters or fewer.' });
    }
    description = req.body.description.trim();
  }
  if ('priority' in req.body) {
    if (!priorities.has(req.body.priority)) return res.status(400).json({ message: 'Choose a valid task priority.' });
    priority = req.body.priority;
  }
  if ('status' in req.body) {
    if (!statuses.has(req.body.status)) return res.status(400).json({ message: 'Choose a valid task status.' });
    status = req.body.status;
  }
  if ('dueDate' in req.body) dueDate = parseDueDate(req.body.dueDate);
  if ('assignedTo' in req.body) {
    if (req.body.assignedTo === null || req.body.assignedTo === '') {
      assignedTo = null;
    } else if (project.members.some((member) => member._id === req.body.assignedTo)) {
      assignedTo = req.body.assignedTo;
    } else {
      return res.status(400).json({ message: 'Assignee must be a member of this project.' });
    }
  }

  getDatabase().prepare(`
    UPDATE tasks
    SET title = ?, description = ?, status = ?, priority = ?, due_date = ?,
        assigned_to = ?, updated_at = ?
    WHERE id = ?
  `).run(title, description, status, priority, dueDate, assignedTo, nowIso(), task._id);
  const updatedTask = taskById(task._id);
  emitToProject(updatedTask.project, 'task:updated', { projectId: updatedTask.project, task: updatedTask });
  if (assignedTo && assignedTo !== previousAssignee) {
    try {
      await sendAssignmentNotification({
        recipient: assignedTo,
        actor: req.user._id,
        project: updatedTask.project,
        task: updatedTask,
      });
    } catch (error) {
      console.error('Failed to notify the new task assignee:', error);
    }
  }
  res.json({ task: updatedTask });
}));

router.delete('/:taskId', asyncHandler(async (req, res) => {
  const task = taskById(req.params.taskId);
  if (!task) return res.status(404).json({ message: 'Task not found.' });
  if (!projectByIdForMember(task.project, req.user._id)) {
    return res.status(404).json({ message: 'Task not found.' });
  }
  getDatabase().prepare('DELETE FROM tasks WHERE id = ?').run(task._id);
  emitToProject(task.project, 'task:deleted', {
    projectId: task.project,
    taskId: task._id,
  });
  res.status(204).end();
}));

export default router;
