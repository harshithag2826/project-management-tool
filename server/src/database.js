import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultDatabasePath = path.join(serverDirectory, 'data', 'teamboard.sqlite');
let database;

export function getDatabase() {
  if (database) return database;

  const configuredPath = process.env.DB_PATH || defaultDatabasePath;
  const databasePath = configuredPath === ':memory:'
    ? configuredPath
    : path.resolve(serverDirectory, configuredPath);
  if (databasePath !== ':memory:') mkdirSync(path.dirname(databasePath), { recursive: true });

  database = new Database(databasePath);
  database.pragma('foreign_keys = ON');
  database.pragma('journal_mode = WAL');
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
      email TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(email) <= 254),
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
      description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 500),
      owner_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS project_members (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (project_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
      description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
      status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in-progress', 'done')),
      priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
      due_date TEXT,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      assigned_to TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tasks_project_created ON tasks(project_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 2000),
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      author_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS comments_task_created ON comments(task_id, created_at);
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      type TEXT NOT NULL CHECK (type IN ('task-assigned', 'comment-mention', 'deadline-approaching')),
      message TEXT NOT NULL CHECK (length(message) <= 300),
      dedupe_key TEXT UNIQUE,
      read_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS notifications_recipient_read_created
      ON notifications(recipient_id, read_at, created_at DESC);
  `);
  return database;
}

export function initializeDatabase() {
  getDatabase();
}

export function isDatabaseReady() {
  return Boolean(database?.open);
}

export function closeDatabase() {
  if (!database) return;
  database.close();
  database = undefined;
}
