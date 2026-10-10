import { getDatabase } from '../database.js';
import { newId, nowIso, notificationById, taskById } from '../data.js';
import { emitToUser } from './realtime.js';

export async function createNotifications(items) {
  const db = getDatabase();
  const insert = db.prepare(`
    INSERT INTO notifications (
      id, recipient_id, actor_id, project_id, task_id, type, message,
      dedupe_key, read_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
  `);
  for (const item of items) {
    const now = nowIso();
    const id = newId();
    try {
      insert.run(
        id,
        item.recipient?._id || item.recipient,
        item.actor?._id || item.actor || null,
        item.project?._id || item.project || null,
        item.task?._id || item.task || null,
        item.type,
        item.message,
        item.dedupeKey || null,
        now,
        now,
      );
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') continue;
      throw error;
    }
    emitToUser(item.recipient?._id || item.recipient, 'notification:new', notificationById(id));
  }
}

export async function sendAssignmentNotification({ recipient, actor, project, task }) {
  const recipientId = recipient?._id || recipient;
  const actorId = actor?._id || actor;
  if (recipientId.toString() === actorId.toString()) return;
  await createNotifications([{
    recipient: recipientId,
    actor: actorId,
    project: project?._id || project,
    task: task._id,
    type: 'task-assigned',
    message: `You were assigned to "${task.title}".`,
    dedupeKey: `assignment:${task._id}:${recipientId}:${task.updatedAt || Date.now()}`,
  }]);
}

export async function sendDeadlineReminders(now = new Date()) {
  const end = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const dueTasks = getDatabase().prepare(`
    SELECT id FROM tasks
    WHERE assigned_to IS NOT NULL
      AND status != 'done'
      AND due_date > ?
      AND due_date <= ?
  `).all(now.toISOString(), end).map(({ id }) => taskById(id));

  await createNotifications(dueTasks.map((task) => ({
    recipient: task.assignedTo._id,
    project: task.project,
    task: task._id,
    type: 'deadline-approaching',
    message: `"${task.title}" is due within 24 hours.`,
    dedupeKey: `deadline:${task._id}:${task.assignedTo._id}:${task.dueDate}`,
  })));
  return dueTasks.length;
}

export function startDeadlineReminderScheduler() {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await sendDeadlineReminders();
    } catch (error) {
      console.error('Failed to create deadline notifications:', error);
    } finally {
      running = false;
    }
  };

  void run();
  const timer = setInterval(run, 60 * 60 * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
