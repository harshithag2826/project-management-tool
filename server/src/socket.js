import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { getDatabase } from './database.js';
import { isValidId, userById } from './data.js';
import { getClientOrigins } from './config.js';

export function createSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: getClientOrigins(),
      methods: ['GET', 'POST'],
    },
  });

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (typeof token !== 'string' || !token) {
      return next(new Error('Authentication required.'));
    }

    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
      if (typeof payload !== 'object' || typeof payload.sub !== 'string' ||
          !isValidId(payload.sub)) {
        return next(new Error('Invalid authentication token.'));
      }

      const user = userById(payload.sub);
      if (!user) return next(new Error('Account not found.'));
      socket.data.userId = user.id;
      socket.data.tokenExpiresAt = payload.exp ? payload.exp * 1000 : null;
      next();
    } catch (error) {
      if (error instanceof Error && error.name !== 'JsonWebTokenError' &&
          error.name !== 'TokenExpiredError' && error.name !== 'NotBeforeError') {
        return next(error);
      }
      next(new Error('Invalid or expired authentication token.'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(`user:${socket.data.userId}`);
    const expiresIn = socket.data.tokenExpiresAt
      ? socket.data.tokenExpiresAt - Date.now()
      : null;
    if (expiresIn !== null) {
      if (expiresIn <= 0) {
        socket.disconnect(true);
        return;
      }
      const expiryTimer = setTimeout(() => socket.disconnect(true), expiresIn);
      expiryTimer.unref();
      socket.on('disconnect', () => clearTimeout(expiryTimer));
    }

    socket.on('project:join', async (projectId, acknowledge) => {
      const reply = typeof acknowledge === 'function' ? acknowledge : () => {};
      if (!isValidId(projectId)) {
        reply({ error: 'Invalid project.' });
        return;
      }

      try {
        const isMember = getDatabase().prepare(`
          SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?
        `).get(projectId, socket.data.userId);
        if (!isMember) {
          reply({ error: 'You do not have access to this project.' });
          return;
        }
        await socket.join(`project:${projectId}`);
        reply({ ok: true });
      } catch (error) {
        reply({ error: 'Unable to join this project.' });
        console.error('Project room authorization failed:', error);
      }
    });

    socket.on('project:leave', (projectId) => {
      if (isValidId(projectId)) {
        void socket.leave(`project:${projectId}`);
      }
    });
  });

  return io;
}
