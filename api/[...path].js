import '../server/src/loadEnvironment.js';
import app from '../server/src/app.js';
import { initializeDatabase } from '../server/src/database.js';
import { validateEnvironment } from '../server/src/config.js';

export default async function handler(req, res) {
  try {
    validateEnvironment();
    initializeDatabase();
    return app(req, res);
  } catch (error) {
    console.error(`TeamBoard API could not initialize SQLite: ${error.message}`);
    return res.status(503).json({
      message: 'The API is unavailable. Check its SQLite database path and JWT environment variables.',
    });
  }
}
