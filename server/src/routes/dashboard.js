import express from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { getDatabase } from '../database.js';
import { notificationsForUser, projectsForUser, taskById } from '../data.js';

const router = express.Router();
router.use(requireAuth);

router.get('/', asyncHandler(async (req, res) => {
  const projects = projectsForUser(req.user._id);
  if (!projects.length) {
    return res.json({
      projects: [],
      stats: { totalProjects: 0, totalTasks: 0, todo: 0, inProgress: 0, done: 0, overdue: 0 },
      recentActivity: [],
    });
  }

  const db = getDatabase();
  const projectIds = projects.map((project) => project._id);
  const placeholders = projectIds.map(() => '?').join(', ');
  const taskStats = db.prepare(`
    SELECT
      project_id AS _id,
      COUNT(*) AS total,
      SUM(status = 'todo') AS todo,
      SUM(status = 'in-progress') AS inProgress,
      SUM(status = 'done') AS done,
      SUM(status != 'done' AND due_date IS NOT NULL AND due_date < ?) AS overdue
    FROM tasks
    WHERE project_id IN (${placeholders})
    GROUP BY project_id
  `).all(new Date().toISOString(), ...projectIds);
  const statsByProject = new Map(taskStats.map((item) => [item._id, item]));
  const projectsWithStats = projects.map((project) => ({
    ...project,
    taskStats: statsByProject.get(project._id) || {
      total: 0, todo: 0, inProgress: 0, done: 0, overdue: 0,
    },
  }));
  const taskRows = db.prepare(`
    SELECT id FROM tasks WHERE project_id IN (${placeholders})
    ORDER BY updated_at DESC LIMIT 100
  `).all(...projectIds);
  const taskItems = taskRows.map(({ id }) => taskById(id));
  const notificationItems = notificationsForUser(req.user._id, 8);
  const commentRows = db.prepare(`
    SELECT c.id, c.text, c.created_at, c.task_id, c.author_id, t.title AS task_title, t.project_id
    FROM comments c
    JOIN tasks t ON t.id = c.task_id
    WHERE t.project_id IN (${placeholders})
    ORDER BY c.created_at DESC
    LIMIT 12
  `).all(...projectIds);
  const projectNames = new Map(projects.map((project) => [project._id, project.name]));

  const taskActivity = taskItems.slice(0, 8).map((task) => ({
    id: `task:${task._id}`,
    type: task.createdAt === task.updatedAt ? 'task-created' : 'task-updated',
    createdAt: task.updatedAt,
    projectName: projectNames.get(task.project) || 'Project',
    taskTitle: task.title,
    message: task.createdAt === task.updatedAt ? 'New task created' : 'Task updated',
    actorName: null,
    projectId: task.project,
    taskId: task._id,
  }));
  const commentActivity = commentRows.map((comment) => ({
    id: `comment:${comment.id}`,
    type: 'comment',
    createdAt: comment.created_at,
    projectName: projectNames.get(comment.project_id) || 'Project',
    taskTitle: comment.task_title,
    message: comment.text,
    actorName: db.prepare('SELECT name FROM users WHERE id = ?').get(comment.author_id)?.name || 'A teammate',
    projectId: comment.project_id,
    taskId: comment.task_id,
  }));
  const notificationActivity = notificationItems.map((notification) => ({
    id: `notification:${notification._id}`,
    type: notification.type,
    createdAt: notification.createdAt,
    projectName: notification.project?.name || 'Project',
    taskTitle: notification.task?.title || 'Task',
    message: notification.message,
    actorName: notification.actor?.name || null,
    projectId: notification.project?._id || null,
    taskId: notification.task?._id || null,
  }));
  const stats = taskStats.reduce((total, item) => ({
    totalProjects: projects.length,
    totalTasks: total.totalTasks + item.total,
    todo: total.todo + item.todo,
    inProgress: total.inProgress + item.inProgress,
    done: total.done + item.done,
    overdue: total.overdue + item.overdue,
  }), { totalProjects: projects.length, totalTasks: 0, todo: 0, inProgress: 0, done: 0, overdue: 0 });

  res.json({
    projects: projectsWithStats,
    stats,
    recentActivity: [...commentActivity, ...notificationActivity, ...taskActivity]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 8),
  });
}));

export default router;
