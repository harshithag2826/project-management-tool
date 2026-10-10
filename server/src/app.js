import cors from 'cors';
import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { isDatabaseReady } from './database.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import projectRoutes from './routes/projects.js';
import taskRoutes from './routes/tasks.js';
import commentRoutes from './routes/comments.js';
import notificationRoutes from './routes/notifications.js';
import dashboardRoutes from './routes/dashboard.js';
import { notFound, errorHandler } from './middleware/errors.js';
import { getClientOrigins } from './config.js';

const app = express();
const clientBuildPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');

app.use(helmet());
app.use(cors({
  origin: getClientOrigins(),
  credentials: false,
}));
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  if (req.body === null || Array.isArray(req.body) ||
      (req.body !== undefined && typeof req.body !== 'object')) {
    return res.status(400).json({ message: 'Request body must be a JSON object.' });
  }
  if (req.body === undefined) req.body = {};
  next();
});
app.use('/api/auth', rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
}), authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/notifications', notificationRoutes);
app.get('/api/health', (_req, res) => {
  const databaseReady = isDatabaseReady();
  res.status(databaseReady ? 200 : 503).json({
    status: databaseReady ? 'ok' : 'unavailable',
    database: databaseReady ? 'connected' : 'disconnected',
  });
});
app.use('/api', commentRoutes);
app.use(express.static(clientBuildPath, { index: false, maxAge: '1y', immutable: true }));
app.get('/', (_req, res, next) => {
  if (!existsSync(path.join(clientBuildPath, 'index.html'))) return next();
  res.sendFile(path.join(clientBuildPath, 'index.html'));
});
app.use(notFound);
app.use(errorHandler);

export default app;
