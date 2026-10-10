import '../../server/src/loadEnvironment.js';
import { initializeDatabase } from '../../server/src/database.js';
import { validateEnvironment } from '../../server/src/config.js';
import { sendDeadlineReminders } from '../../server/src/services/notifications.js';

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ message: 'Unauthorized.' });
  }

  try {
    validateEnvironment();
    initializeDatabase();
    const remindersCreated = await sendDeadlineReminders();
    return res.status(200).json({ remindersCreated });
  } catch (error) {
    console.error(`Deadline reminder job failed: ${error.message}`);
    return res.status(503).json({ message: 'The deadline reminder job is unavailable.' });
  }
}
