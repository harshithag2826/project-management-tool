import './loadEnvironment.js';
import { createServer } from 'node:http';
import app from './app.js';
import { createSocketServer } from './socket.js';
import { setRealtimeServer } from './services/realtime.js';
import { startDeadlineReminderScheduler } from './services/notifications.js';
import { closeDatabase, initializeDatabase } from './database.js';
import { validateEnvironment } from './config.js';

async function startServer() {
  const port = validateEnvironment();

  initializeDatabase();
  const httpServer = createServer(app);
  const io = createSocketServer(httpServer);
  setRealtimeServer(io);
  const stopDeadlineReminderScheduler = startDeadlineReminderScheduler();

  httpServer.listen(port, () => {
    console.log(`TeamBoard API listening on port ${port}`);
  });

  const shutdown = async () => {
    stopDeadlineReminderScheduler();
    io.close(async () => {
      closeDatabase();
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

startServer().catch((error) => {
  console.error(`TeamBoard API startup failed: ${error.message}`);
  process.exitCode = 1;
});
