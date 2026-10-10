import express from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { getDatabase } from '../database.js';
import {
  newId,
  nowIso,
  projectById,
  projectByIdForMember,
  projectsForUser,
  taskById,
  userByEmail,
} from '../data.js';

const router = express.Router();
router.use(requireAuth);

router.get('/', asyncHandler(async (req, res) => {
  res.json({ projects: projectsForUser(req.user._id) });
}));

router.post('/', asyncHandler(async (req, res) => {
  const { name, description = '' } = req.body;
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ message: 'A project name is required.' });
  }
  if (name.trim().length > 100) {
    return res.status(400).json({ message: 'Project name must be 100 characters or fewer.' });
  }
  if (typeof description !== 'string' || description.length > 500) {
    return res.status(400).json({ message: 'Project description must be 500 characters or fewer.' });
  }

  const id = newId();
  const now = nowIso();
  const db = getDatabase();
  db.transaction(() => {
    db.prepare(`
      INSERT INTO projects (id, name, description, owner_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, name.trim(), description.trim(), req.user._id, now, now);
    db.prepare('INSERT INTO project_members (project_id, user_id) VALUES (?, ?)').run(id, req.user._id);
  })();
  res.status(201).json({ project: projectById(id) });
}));

router.get('/:projectId', asyncHandler(async (req, res) => {
  const project = projectByIdForMember(req.params.projectId, req.user._id);
  if (!project) return res.status(404).json({ message: 'Project not found.' });
  if (req.query.includeTasks === 'false') return res.json({ project });

  const tasks = getDatabase().prepare(`
    SELECT id FROM tasks WHERE project_id = ? ORDER BY created_at DESC
  `).all(project._id).map(({ id }) => taskById(id));
  res.json({ project, tasks });
}));

router.patch('/:projectId', asyncHandler(async (req, res) => {
  const project = projectByIdForMember(req.params.projectId, req.user._id);
  if (!project) return res.status(404).json({ message: 'Project not found.' });
  if (project.owner.id !== req.user.id) {
    return res.status(403).json({ message: 'Only the project owner can update project details.' });
  }

  let { name, description } = project;
  if ('name' in req.body) {
    if (typeof req.body.name !== 'string' || !req.body.name.trim() || req.body.name.trim().length > 100) {
      return res.status(400).json({ message: 'Project name must contain between 1 and 100 characters.' });
    }
    name = req.body.name.trim();
  }
  if ('description' in req.body) {
    if (typeof req.body.description !== 'string' || req.body.description.length > 500) {
      return res.status(400).json({ message: 'Project description must be 500 characters or fewer.' });
    }
    description = req.body.description.trim();
  }
  getDatabase().prepare(`
    UPDATE projects SET name = ?, description = ?, updated_at = ? WHERE id = ?
  `).run(name, description, nowIso(), project._id);
  res.json({ project: projectById(project._id) });
}));

router.delete('/:projectId', asyncHandler(async (req, res) => {
  const project = projectByIdForMember(req.params.projectId, req.user._id);
  if (!project) return res.status(404).json({ message: 'Project not found.' });
  if (project.owner.id !== req.user.id) {
    return res.status(403).json({ message: 'Only the project owner can delete this project.' });
  }
  getDatabase().prepare('DELETE FROM projects WHERE id = ?').run(project._id);
  res.status(204).end();
}));

router.post('/:projectId/members', asyncHandler(async (req, res) => {
  const project = projectByIdForMember(req.params.projectId, req.user._id);
  if (!project) return res.status(404).json({ message: 'Project not found.' });
  if (project.owner.id !== req.user.id) {
    return res.status(403).json({ message: 'Only the project owner can invite members.' });
  }
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const member = userByEmail(email);
  if (!member) return res.status(404).json({ message: 'No account was found for that email.' });
  getDatabase().prepare(`
    INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)
  `).run(project._id, member._id);
  getDatabase().prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(nowIso(), project._id);
  res.json({ project: projectById(project._id) });
}));

export default router;
