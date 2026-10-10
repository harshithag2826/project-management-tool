# TeamBoard

TeamBoard is a collaborative project board built with React, Express, SQLite, and Socket.IO. It includes JWT sign-in, shared projects, member invitations, draggable Kanban cards, assignees, due dates, task conversations, notifications, and real-time updates.

## Requirements

- Node.js 20 or newer
- npm 10 or newer
- SQLite (stored locally by the backend)

## Get started

1. Copy `server/.env.example` to `server/.env`. Set `JWT_SECRET` to a unique random value of at least 32 characters and keep `PORT=4000`. `DB_PATH` defaults to `./data/teamboard.sqlite`, relative to the `server` directory. The backend creates the SQLite database and parent directory on startup.
2. Install dependencies from the repository root with `npm install`.
3. Start the API (including Socket.IO) and Vite development server with `npm run dev`.
4. Open the URL printed by Vite (normally `http://localhost:5173`). Vite proxies `/api` and Socket.IO requests to the Express server at `http://localhost:4000`. Leave `VITE_API_URL` empty for local development; set it only when the API is hosted on a different origin.

SQLite requires a persistent writable filesystem. Serverless platforms such as Vercel use ephemeral, isolated function filesystems, so this SQLite configuration is for local development or a single backend host with a persistent disk. Do not deploy this API to Vercel Functions expecting durable, shared project data. For a persistent single-host deployment, set `DB_PATH` to a durable location and configure `JWT_SECRET`; a persistent Socket.IO host is also required for live updates.

Socket.IO and the in-process reminder scheduler remain enabled for local development. On Vercel, REST APIs and the scheduled reminder endpoint run as serverless functions; live push updates require a separate persistent Socket.IO host.

## Tests

Run `npm test` from the repository root for backend integration tests. They use an in-memory SQLite database and cover authentication, project/task/comment/notification CRUD, authorization, request validation, and Socket.IO collaboration. Tests do not use or modify your local database file.

## API

All endpoints except registration, login, and health checks require `Authorization: Bearer <token>`.

Registration requires a name, valid email, and password of 8–72 UTF-8 bytes. Passwords are hashed with bcrypt before storage. Login returns a signed JWT and the public user profile; the client keeps both in browser local storage, verifies restored sessions with `/api/auth/me`, and clears the session on logout or when the API rejects an expired/invalid token. The JWT lifetime defaults to seven days and can be changed with `JWT_EXPIRES_IN`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/register` | Register and receive a JWT |
| `POST` | `/api/auth/login` | Sign in and receive a JWT |
| `GET` | `/api/auth/me` | Get the signed-in user |
| `GET` | `/api/users` | List users available for project invitations |
| `GET` | `/api/dashboard` | Get your projects, task statistics, and recent activity |
| `GET`, `POST` | `/api/projects` | List accessible projects or create one |
| `GET`, `PATCH`, `DELETE` | `/api/projects/:projectId` | Get a project (includes tasks unless `?includeTasks=false`), update details, or delete project and tasks/comments (owner only) |
| `POST` | `/api/projects/:projectId/members` | Add an existing user by email (owner only) |
| `GET`, `POST` | `/api/tasks` | List project tasks with `?projectId=...` or create a task with priority (`low`, `medium`, `high`), deadline, and assignee |
| `PATCH`, `DELETE` | `/api/tasks/:taskId` | Update or delete a task |
| `GET`, `POST` | `/api/tasks/:taskId/comments` | List or add comments (project members only) |
| `PATCH`, `DELETE` | `/api/comments/:commentId` | Edit your comment or delete your comment (project owner can also delete) |
| `GET` | `/api/notifications` | List your notifications and unread count |
| `PATCH` | `/api/notifications/read-all` | Mark all of your notifications as read |
| `PATCH` | `/api/notifications/:notificationId/read` | Mark one of your notifications as read |
| `GET` | `/api/health` | Check API and SQLite availability (503 when the database is not initialized) |

Project and task queries are scoped to project membership. Assignees must be project members; project invitations, edits, and deletion are restricted to the owner. The dashboard lists accessible projects and provides project creation, editing, and deletion; each project opens a Kanban board with task status, priority, deadline, and assignee controls.

All comment endpoints require authentication and verify that the requester belongs to the task's project. Only comment authors can edit; authors and project owners can delete. Comment responses include the author's display name and creation/update timestamps.

Notifications are private to their authenticated recipient. Task assignees receive assignment notifications, project members can be mentioned in comments using their email address (for example, `@teammate@example.com`), and assignees receive a deduplicated reminder when an unfinished task is due within 24 hours. The API checks for approaching deadlines hourly.

Authenticated Socket.IO connections use the same JWT. Clients must request `project:join` for each board; the server checks project membership before joining its room. Task and comment changes are broadcast to authorized project rooms, while newly created notifications are sent to the recipient's private user room. Vite proxies the `/socket.io` WebSocket endpoint during development.

Live events include `task:created`, `task:updated`, `task:deleted`, `comment:created`, `comment:updated`, `comment:deleted`, and `notification:new`. Socket connections are disconnected when their JWT expires.

## Structure

- `client/` — React single-page app, Vite config, and responsive Kanban UI
- `server/src/database.js` and `server/src/data.js` — SQLite schema and data access
- `server/src/routes/` — Authentication and REST endpoints
- `server/src/middleware/` — JWT authentication, async route handling, and errors
