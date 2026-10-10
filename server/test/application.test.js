import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { io as createClient } from 'socket.io-client';
import app from '../src/app.js';
import { closeDatabase, initializeDatabase } from '../src/database.js';
import { createSocketServer } from '../src/socket.js';
import { setRealtimeServer } from '../src/services/realtime.js';

process.env.JWT_SECRET = 'teamboard-integration-test-secret-32-bytes';
process.env.DB_PATH = ':memory:';

let server;
let socketServer;
let baseUrl;

before(async () => {
  initializeDatabase();
  server = createServer(app);
  socketServer = createSocketServer(server);
  setRealtimeServer(socketServer);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (socketServer) await new Promise((resolve) => socketServer.close(resolve));
  closeDatabase();
});

async function request(path, { token, ...options } = {}) {
  const response = await fetch(`${baseUrl}/api${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  return {
    status: response.status,
    body: response.status === 204 ? null : await response.json(),
  };
}

async function register(name, email) {
  const response = await request('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name, email, password: 'safe-passphrase-123' }),
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body;
}

function waitForEvent(socket, eventName, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${eventName}.`)), timeoutMs);
    socket.once(eventName, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

async function connectSocket(token) {
  const socket = createClient(baseUrl, {
    auth: { token },
    transports: ['websocket'],
    reconnection: false,
    timeout: 4000,
  });
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  return socket;
}

test('auth, project, task, comment, notification, and realtime flows', async (t) => {
  await t.test('validates auth input and protects private APIs', async () => {
    const unauthenticated = await request('/projects');
    assert.equal(unauthenticated.status, 401);

    const invalidRegister = await request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: '  ', email: 'bad-email', password: 'short' }),
    });
    assert.equal(invalidRegister.status, 400);

    const oversizedPassword = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'nobody@example.test', password: 'x'.repeat(73) }),
    });
    assert.equal(oversizedPassword.status, 400);
    assert.match(oversizedPassword.body.message, /72 bytes/i);
  });

  await t.test('health and request parsing report database and input failures accurately', async () => {
    const health = await request('/health');
    assert.equal(health.status, 200);
    assert.deepEqual(health.body, { status: 'ok', database: 'connected' });

    const malformed = await request('/auth/login', {
      method: 'POST',
      body: '{',
    });
    assert.equal(malformed.status, 400);
    assert.match(malformed.body.message, /invalid JSON/i);

    const oversized = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ data: 'x'.repeat(1_048_576) }),
    });
    assert.equal(oversized.status, 413);
  });

  const owner = await register('Project Owner', 'owner@example.test');
  await t.test('registration rejects duplicate email addresses with HTTP 409', async () => {
    const duplicate = await request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Duplicate Account',
        email: ' OWNER@example.test ',
        password: 'safe-passphrase-123',
      }),
    });
    assert.equal(duplicate.status, 409);
    assert.deepEqual(duplicate.body, {
      message: 'That email address is already registered.',
      error: 'An account with this email already exists.',
    });
  });

  const member = await register('Project Member', 'member@example.test');
  const outsider = await register('Outside User', 'outsider@example.test');

  await t.test('login and session verification return the authenticated profile', async () => {
    const login = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'OWNER@example.test', password: 'safe-passphrase-123' }),
    });
    assert.equal(login.status, 200);
    assert.equal(login.body.user.email, 'owner@example.test');
    const session = await request('/auth/me', { token: login.body.token });
    assert.equal(session.status, 200);
    assert.equal(session.body.user.id, owner.user.id);
  });

  const createdProject = await request('/projects', {
    token: owner.token,
    method: 'POST',
    body: JSON.stringify({ name: 'Launch plan', description: 'Shared launch work' }),
  });
  assert.equal(createdProject.status, 201);
  const project = createdProject.body.project;
  const projectId = project._id;

  await t.test('project access, edits, membership, and owner authorization work', async () => {
    const addedMember = await request(`/projects/${projectId}/members`, {
      token: owner.token,
      method: 'POST',
      body: JSON.stringify({ email: member.user.email }),
    });
    assert.equal(addedMember.status, 200);
    assert.equal(addedMember.body.project.members.length, 2);

    const memberProject = await request(`/projects/${projectId}`, { token: member.token });
    assert.equal(memberProject.status, 200);
    assert.equal(memberProject.body.project._id, projectId);

    const outsiderProject = await request(`/projects/${projectId}`, { token: outsider.token });
    assert.equal(outsiderProject.status, 404);

    const forbiddenEdit = await request(`/projects/${projectId}`, {
      token: member.token,
      method: 'PATCH',
      body: JSON.stringify({ name: 'No permission' }),
    });
    assert.equal(forbiddenEdit.status, 403);

    const editedProject = await request(`/projects/${projectId}`, {
      token: owner.token,
      method: 'PATCH',
      body: JSON.stringify({ name: 'Launch plan v2', description: 'Updated launch work' }),
    });
    assert.equal(editedProject.status, 200);
    assert.equal(editedProject.body.project.name, 'Launch plan v2');
  });

  const ownerSocket = await connectSocket(owner.token);
  const memberSocket = await connectSocket(member.token);
  const outsiderSocket = await connectSocket(outsider.token);
  t.after(() => {
    ownerSocket.disconnect();
    memberSocket.disconnect();
    outsiderSocket.disconnect();
  });

  await t.test('Socket.IO verifies membership before joining project rooms', async () => {
    const joinRoom = (socket, id) => new Promise((resolve) => {
      socket.emit('project:join', id, resolve);
    });
    assert.deepEqual(await joinRoom(ownerSocket, projectId), { ok: true });
    assert.deepEqual(await joinRoom(memberSocket, projectId), { ok: true });
    assert.match((await joinRoom(outsiderSocket, projectId)).error, /do not have access/i);
  });

  const assignmentEvent = waitForEvent(memberSocket, 'notification:new');
  const createdTask = await request('/tasks', {
    token: owner.token,
    method: 'POST',
    body: JSON.stringify({
      projectId,
      title: 'Prepare release notes',
      description: 'Collect the changes',
      priority: 'medium',
      status: 'todo',
      dueDate: '2026-11-01',
      assignedTo: member.user.id,
    }),
  });
  assert.equal(createdTask.status, 201);
  const taskId = createdTask.body.task._id;
  assert.equal((await assignmentEvent).type, 'task-assigned');

  await t.test('dashboard summaries include SQLite projects and tasks', async () => {
    const dashboard = await request('/dashboard', { token: owner.token });
    assert.equal(dashboard.status, 200);
    assert.equal(dashboard.body.stats.totalProjects, 1);
    assert.equal(dashboard.body.stats.totalTasks, 1);
    assert.equal(dashboard.body.projects[0].taskStats.total, 1);
  });

  await t.test('task CRUD and live project events work', async () => {
    const ownerEvent = waitForEvent(ownerSocket, 'task:created');
    const memberEvent = waitForEvent(memberSocket, 'task:created');
    const anotherTask = await request('/tasks', {
      token: owner.token,
      method: 'POST',
      body: JSON.stringify({ projectId, title: 'Socket event task' }),
    });
    assert.equal(anotherTask.status, 201);
    assert.equal((await ownerEvent).task._id, anotherTask.body.task._id);
    assert.equal((await memberEvent).task._id, anotherTask.body.task._id);

    const ownerUpdateEvent = waitForEvent(ownerSocket, 'task:updated');
    const memberUpdateEvent = waitForEvent(memberSocket, 'task:updated');
    const updated = await request(`/tasks/${taskId}`, {
      token: member.token,
      method: 'PATCH',
      body: JSON.stringify({ status: 'in-progress', priority: 'high' }),
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.task.status, 'in-progress');
    assert.equal((await ownerUpdateEvent).task.status, 'in-progress');
    assert.equal((await memberUpdateEvent).task.status, 'in-progress');

    const tasks = await request(`/tasks?projectId=${projectId}`, { token: member.token });
    assert.equal(tasks.status, 200);
    assert.equal(tasks.body.tasks.length, 2);

    const forbiddenTask = await request(`/tasks/${taskId}`, {
      token: outsider.token,
      method: 'PATCH',
      body: JSON.stringify({ status: 'done' }),
    });
    assert.equal(forbiddenTask.status, 404);
  });

  await t.test('comments and assignment/mention notifications support CRUD and read state', async () => {
    const assignmentFeed = await request('/notifications', { token: member.token });
    const assignment = assignmentFeed.body.notifications.find((item) => item.type === 'task-assigned');
    assert.ok(assignment);
    assert.equal(assignmentFeed.body.unreadCount, 1);

    const commentEvent = waitForEvent(ownerSocket, 'comment:created');
    const mentionEvent = waitForEvent(ownerSocket, 'notification:new');
    const createdComment = await request(`/tasks/${taskId}/comments`, {
      token: member.token,
      method: 'POST',
      body: JSON.stringify({ text: 'Please review this, @owner@example.test' }),
    });
    assert.equal(createdComment.status, 201);
    const commentId = createdComment.body.comment._id;
    assert.equal(createdComment.body.comment.author.name, 'Project Member');
    assert.equal((await commentEvent).comment._id, commentId);
    assert.equal((await mentionEvent).type, 'comment-mention');

    const mentionFeed = await request('/notifications', { token: owner.token });
    assert.ok(mentionFeed.body.notifications.some((item) => item.type === 'comment-mention'));

    const updatedComment = await request(`/comments/${commentId}`, {
      token: member.token,
      method: 'PATCH',
      body: JSON.stringify({ text: 'Updated review note' }),
    });
    assert.equal(updatedComment.status, 200);
    assert.equal(updatedComment.body.comment.text, 'Updated review note');

    const forbiddenCommentEdit = await request(`/comments/${commentId}`, {
      token: owner.token,
      method: 'PATCH',
      body: JSON.stringify({ text: 'Not my comment' }),
    });
    assert.equal(forbiddenCommentEdit.status, 403);

    const markedRead = await request(`/notifications/${assignment._id}/read`, {
      token: member.token,
      method: 'PATCH',
    });
    assert.equal(markedRead.status, 200);
    assert.ok(markedRead.body.notification.readAt);

    const readAll = await request('/notifications/read-all', {
      token: owner.token,
      method: 'PATCH',
    });
    assert.equal(readAll.status, 200);

    const removedComment = await request(`/comments/${commentId}`, {
      token: owner.token,
      method: 'DELETE',
    });
    assert.equal(removedComment.status, 204);

    const invalidComment = await request(`/tasks/${taskId}/comments`, {
      token: member.token,
      method: 'POST',
      body: JSON.stringify({ text: '   ' }),
    });
    assert.equal(invalidComment.status, 400);
  });

  await t.test('task and project deletion clean up related records', async () => {
    const deletedEvent = waitForEvent(memberSocket, 'task:deleted');
    const deletedTask = await request(`/tasks/${taskId}`, { token: owner.token, method: 'DELETE' });
    assert.equal(deletedTask.status, 204);
    assert.equal((await deletedEvent).taskId, taskId);

    const deletedProject = await request(`/projects/${projectId}`, {
      token: owner.token,
      method: 'DELETE',
    });
    assert.equal(deletedProject.status, 204);
    const memberProjects = await request('/projects', { token: member.token });
    assert.equal(memberProjects.body.projects.length, 0);
  });
});
