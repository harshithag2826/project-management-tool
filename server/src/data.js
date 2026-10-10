import { randomUUID } from 'node:crypto';
import { getDatabase } from './database.js';

export const newId = () => randomUUID();
export const nowIso = () => new Date().toISOString();

export function isValidId(value) {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function userById(id) {
  const row = getDatabase().prepare('SELECT * FROM users WHERE id = ?').get(id);
  return row ? {
    _id: row.id,
    id: row.id,
    name: row.name,
    email: row.email,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } : null;
}

export function userByEmail(email) {
  const row = getDatabase().prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(email);
  return row ? userById(row.id) : null;
}

export function usersForProject(projectId) {
  return getDatabase().prepare(`
    SELECT u.id, u.name, u.email
    FROM users u
    JOIN project_members pm ON pm.user_id = u.id
    WHERE pm.project_id = ?
    ORDER BY u.name COLLATE NOCASE, u.id
  `).all(projectId).map((row) => ({ _id: row.id, id: row.id, name: row.name, email: row.email }));
}

export function publicUserById(id, nameOnly = false) {
  if (!id) return null;
  const columns = nameOnly ? 'id, name' : 'id, name, email';
  const row = getDatabase().prepare(`SELECT ${columns} FROM users WHERE id = ?`).get(id);
  if (!row) return null;
  return nameOnly
    ? { _id: row.id, name: row.name }
    : { _id: row.id, id: row.id, name: row.name, email: row.email };
}

function projectFromRow(row) {
  if (!row) return null;
  return {
    _id: row.id,
    name: row.name,
    description: row.description,
    owner: publicUserById(row.owner_id),
    members: usersForProject(row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function projectById(id) {
  const row = getDatabase().prepare('SELECT * FROM projects WHERE id = ?').get(id);
  return projectFromRow(row);
}

export function projectByIdForMember(id, userId) {
  const row = getDatabase().prepare(`
    SELECT p.* FROM projects p
    JOIN project_members pm ON pm.project_id = p.id
    WHERE p.id = ? AND pm.user_id = ?
  `).get(id, userId);
  return projectFromRow(row);
}

export function projectsForUser(userId) {
  return getDatabase().prepare(`
    SELECT p.* FROM projects p
    JOIN project_members pm ON pm.project_id = p.id
    WHERE pm.user_id = ?
    ORDER BY p.updated_at DESC
  `).all(userId).map(projectFromRow);
}

export function taskById(id) {
  const row = getDatabase().prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!row) return null;
  return {
    _id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    dueDate: row.due_date,
    project: row.project_id,
    assignedTo: publicUserById(row.assigned_to),
    createdBy: publicUserById(row.created_by),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function tasksForProject(projectId) {
  return getDatabase().prepare(`
    SELECT id FROM tasks WHERE project_id = ? ORDER BY created_at DESC
  `).all(projectId).map(({ id }) => taskById(id));
}

export function commentById(id) {
  const row = getDatabase().prepare('SELECT * FROM comments WHERE id = ?').get(id);
  if (!row) return null;
  return {
    _id: row.id,
    text: row.text,
    task: row.task_id,
    author: publicUserById(row.author_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function commentsForTask(taskId) {
  return getDatabase().prepare(`
    SELECT id FROM comments WHERE task_id = ? ORDER BY created_at, id
  `).all(taskId).map(({ id }) => commentById(id));
}

export function notificationById(id) {
  const row = getDatabase().prepare('SELECT * FROM notifications WHERE id = ?').get(id);
  if (!row) return null;
  const project = row.project_id
    ? getDatabase().prepare('SELECT id, name FROM projects WHERE id = ?').get(row.project_id)
    : null;
  const task = row.task_id
    ? getDatabase().prepare('SELECT id, title FROM tasks WHERE id = ?').get(row.task_id)
    : null;
  return {
    _id: row.id,
    recipient: row.recipient_id,
    actor: publicUserById(row.actor_id, true),
    project: project ? { _id: project.id, name: project.name } : null,
    task: task ? { _id: task.id, title: task.title } : null,
    type: row.type,
    message: row.message,
    dedupeKey: row.dedupe_key,
    readAt: row.read_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function notificationsForUser(userId, limit = 50) {
  return getDatabase().prepare(`
    SELECT id FROM notifications
    WHERE recipient_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(userId, limit).map(({ id }) => notificationById(id));
}
