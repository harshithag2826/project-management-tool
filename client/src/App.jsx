import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { format, formatDistanceToNow, isPast, isToday, parseISO } from 'date-fns';
import { io } from 'socket.io-client';
import {
  Activity, AlertCircle, ArrowDownUp, ArrowRight, Bell, CalendarDays, Check,
  ChevronDown, CircleCheck, CircleHelp, Clock3, Columns3, Command,
  FolderKanban, LayoutDashboard, ListTodo, LogOut, Menu, MessageCircle,
  MoreHorizontal, Plus, RefreshCw, Search, Send, Settings2, Sparkles, Users, X,
} from 'lucide-react';

const columns = [
  { id: 'todo', label: 'To Do', color: 'slate', hint: 'A fresh start' },
  { id: 'in-progress', label: 'In Progress', color: 'blue', hint: 'Making moves' },
  { id: 'done', label: 'Done', color: 'green', hint: 'Look at you go' },
];

const priorities = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
];

const apiBaseUrl = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');
const realtimeEnabled = import.meta.env.VITE_ENABLE_REALTIME !== 'false';

async function api(path, { token, ...options } = {}) {
  let response;
  try {
    response = await fetch(`${apiBaseUrl}/api${path}`, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new Error('Unable to reach TeamBoard. Check your connection and try again.');
  }
  if (response.status === 204) return null;
  let responseText;
  try {
    responseText = await response.text();
  } catch {
    throw new Error('The server response was interrupted. Please try again.');
  }
  let data = null;
  if (responseText) {
    try {
      data = JSON.parse(responseText);
    } catch {
      if (response.ok) throw new Error('The server returned an unreadable response. Please try again.');
    }
  }
  if (!response.ok) {
    const message = [data?.message, data?.error].filter(Boolean).join(' ');
    const error = new Error(message || `Request failed (HTTP ${response.status}).`);
    error.status = response.status;
    if (response.status === 401 && token) {
      window.dispatchEvent(new Event('teamboard:session-expired'));
    }
    throw error;
  }
  return data;
}

function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function App() {
  const [token, setToken] = useState(() => localStorage.getItem('teamboard-token'));
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('teamboard-user') || 'null'); } catch { return null; }
  });
  const [authChecked, setAuthChecked] = useState(!localStorage.getItem('teamboard-token'));
  const [authMode, setAuthMode] = useState('login');
  const [authErrors, setAuthErrors] = useState({});
  const [projects, setProjects] = useState([]);
  const [dashboardData, setDashboardData] = useState(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState('');
  const [projectId, setProjectId] = useState('');
  const [activeView, setActiveView] = useState('dashboard');
  const [tasks, setTasks] = useState([]);
  const [boardLoading, setBoardLoading] = useState(false);
  const [boardError, setBoardError] = useState('');
  const boardRequestId = useRef(0);
  const dashboardRequestId = useRef(0);
  const [comments, setComments] = useState([]);
  const [commentsTaskId, setCommentsTaskId] = useState('');
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsError, setCommentsError] = useState('');
  const [commentsRetry, setCommentsRetry] = useState(0);
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [commentSaving, setCommentSaving] = useState(false);
  const [commentDeletingId, setCommentDeletingId] = useState('');
  const [activeTask, setActiveTask] = useState(null);
  const [editingCommentId, setEditingCommentId] = useState('');
  const [commentDraft, setCommentDraft] = useState('');
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [toastType, setToastType] = useState('success');
  const toastTimer = useRef(null);
  const [query, setQuery] = useState('');
  const [dragging, setDragging] = useState('');
  const taskWrites = useRef(new Set());
  const [mobileNav, setMobileNav] = useState(false);
  const [authForm, setAuthForm] = useState({ name: '', email: '', password: '' });
  const [commentText, setCommentText] = useState('');
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const notificationsRef = useRef(null);
  const notificationRequestId = useRef(0);
  const [realtimeSocket, setRealtimeSocket] = useState(null);

  const currentProject = projects.find((project) => project._id === projectId) || null;
  const projectRoomKey = projects.map((project) => project._id).join(',');

  const notify = useCallback((message, type = 'success') => {
    setToast(message);
    setToastType(type);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 3200);
  }, []);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  useEffect(() => {
    const clearSession = () => {
      localStorage.removeItem('teamboard-token');
      localStorage.removeItem('teamboard-user');
      setToken(null);
      setUser(null);
      setProjects([]);
      setDashboardData(null);
      setDashboardError('');
      setDashboardLoading(false);
      setTasks([]);
      setComments([]);
      setCommentsTaskId('');
      setCommentsLoading(false);
      setCommentsError('');
      setCommentText('');
      setCommentDraft('');
      setCommentSubmitting(false);
      setCommentSaving(false);
      setCommentDeletingId('');
      setAuthForm({ name: '', email: '', password: '' });
      setAuthErrors({});
      setBusy(false);
      setToast('');
      setToastType('success');
      window.clearTimeout(toastTimer.current);
      taskWrites.current.clear();
      setBoardError('');
      setBoardLoading(false);
      dashboardRequestId.current += 1;
      boardRequestId.current += 1;
      setProjectId('');
      setQuery('');
      setDragging('');
      setMobileNav(false);
      setActiveView('dashboard');
      setActiveTask(null);
      setModal(null);
      setNotifications([]);
      setUnreadCount(0);
      setNotificationsOpen(false);
      setNotificationsLoading(false);
      notificationRequestId.current += 1;
      setAuthChecked(true);
    };
    window.addEventListener('teamboard:session-expired', clearSession);
    return () => window.removeEventListener('teamboard:session-expired', clearSession);
  }, []);

  const loadNotifications = useCallback(async () => {
    if (!token) return;
    const requestId = ++notificationRequestId.current;
    setNotificationsLoading(true);
    try {
      const data = await api('/notifications', { token });
      if (requestId !== notificationRequestId.current ||
          localStorage.getItem('teamboard-token') !== token) return;
      setNotifications(data.notifications);
      setUnreadCount(data.unreadCount);
    } catch (error) {
      if (requestId === notificationRequestId.current &&
          localStorage.getItem('teamboard-token') === token) notify(error.message, 'error');
    } finally {
      if (requestId === notificationRequestId.current) setNotificationsLoading(false);
    }
  }, [token]);

  const loadDashboard = useCallback(async () => {
    if (!token) return;
    const requestId = ++dashboardRequestId.current;
    setDashboardLoading(true);
    setDashboardError('');
    try {
      const data = await api('/dashboard', { token });
      if (requestId !== dashboardRequestId.current ||
          localStorage.getItem('teamboard-token') !== token) return;
      setDashboardData(data);
      setProjects(data.projects);
      setProjectId((selected) => data.projects.some((project) => project._id === selected)
        ? selected
        : data.projects[0]?._id || '');
    } catch (error) {
      if (requestId === dashboardRequestId.current) setDashboardError(error.message);
    } finally {
      if (requestId === dashboardRequestId.current) setDashboardLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!token) {
      setNotifications([]);
      setUnreadCount(0);
      return undefined;
    }
    void loadNotifications();
    const timer = window.setInterval(loadNotifications, 60_000);
    return () => window.clearInterval(timer);
  }, [loadNotifications, token]);

  useEffect(() => {
    if (!token || !realtimeEnabled) {
      setRealtimeSocket(null);
      return undefined;
    }
    let connectionErrorReported = false;
    const socket = io(apiBaseUrl || '/', {
      path: '/socket.io',
      auth: { token },
      reconnection: true,
      reconnectionAttempts: 8,
      reconnectionDelayMax: 5000,
    });
    setRealtimeSocket(socket);
    const onConnect = () => { connectionErrorReported = false; };
    const onConnectError = (error) => {
      if (connectionErrorReported) return;
      connectionErrorReported = true;
      notify(`Live updates unavailable: ${error.message}`, 'error');
    };
    socket.on('connect', onConnect);
    socket.on('connect_error', onConnectError);
    return () => {
      socket.off('connect', onConnect);
      socket.off('connect_error', onConnectError);
      socket.disconnect();
      setRealtimeSocket(null);
    };
  }, [notify, token]);

  useEffect(() => {
    if (!realtimeSocket) return undefined;
    const onTaskCreated = ({ projectId: eventProjectId, task }) => {
      if (activeView === 'dashboard') void loadDashboard();
      if (activeView !== 'board' || eventProjectId !== projectId) return;
      setTasks((items) => items.some((item) => item._id === task._id) ? items : [...items, task]);
    };
    const onTaskUpdated = ({ projectId: eventProjectId, task }) => {
      if (activeView === 'dashboard') void loadDashboard();
      if (activeView !== 'board' || eventProjectId !== projectId) return;
      setTasks((items) => items.map((item) => item._id === task._id ? task : item));
      setActiveTask((active) => active?._id === task._id ? task : active);
    };
    const onTaskDeleted = ({ projectId: eventProjectId, taskId }) => {
      if (activeView === 'dashboard') void loadDashboard();
      if (activeView !== 'board' || eventProjectId !== projectId) return;
      setTasks((items) => items.filter((item) => item._id !== taskId));
      setActiveTask((active) => active?._id === taskId ? null : active);
    };
    const onCommentCreated = ({ projectId: eventProjectId, taskId, comment }) => {
      if (activeView === 'dashboard') void loadDashboard();
      if (activeView !== 'board' || eventProjectId !== projectId || activeTask?._id !== taskId) return;
      setComments((items) => items.some((item) => item._id === comment._id) ? items : [...items, comment]);
      setCommentsTaskId(taskId);
    };
    const onCommentUpdated = ({ projectId: eventProjectId, taskId, comment }) => {
      if (activeView === 'dashboard') void loadDashboard();
      if (activeView !== 'board' || eventProjectId !== projectId || activeTask?._id !== taskId) return;
      setComments((items) => items.map((item) => item._id === comment._id ? comment : item));
    };
    const onCommentDeleted = ({ projectId: eventProjectId, taskId, commentId }) => {
      if (activeView === 'dashboard') void loadDashboard();
      if (activeView !== 'board' || eventProjectId !== projectId || activeTask?._id !== taskId) return;
      setComments((items) => items.filter((item) => item._id !== commentId));
    };
    const onNewNotification = () => { void loadNotifications(); };

    realtimeSocket.on('task:created', onTaskCreated);
    realtimeSocket.on('task:updated', onTaskUpdated);
    realtimeSocket.on('task:deleted', onTaskDeleted);
    realtimeSocket.on('comment:created', onCommentCreated);
    realtimeSocket.on('comment:updated', onCommentUpdated);
    realtimeSocket.on('comment:deleted', onCommentDeleted);
    realtimeSocket.on('notification:new', onNewNotification);
    return () => {
      realtimeSocket.off('task:created', onTaskCreated);
      realtimeSocket.off('task:updated', onTaskUpdated);
      realtimeSocket.off('task:deleted', onTaskDeleted);
      realtimeSocket.off('comment:created', onCommentCreated);
      realtimeSocket.off('comment:updated', onCommentUpdated);
      realtimeSocket.off('comment:deleted', onCommentDeleted);
      realtimeSocket.off('notification:new', onNewNotification);
    };
  }, [activeTask?._id, activeView, loadDashboard, loadNotifications, projectId, realtimeSocket]);

  useEffect(() => {
    if (!realtimeSocket) return undefined;
    const projectIds = activeView === 'dashboard'
      ? projects.map((project) => project._id)
      : activeView === 'board' && projectId ? [projectId] : [];
    const roomKey = projectIds.join(',');
    const joinProjects = () => {
      projectIds.forEach((id) => {
        realtimeSocket.emit('project:join', id, (result) => {
          if (result?.error) notify(result.error, 'error');
        });
      });
    };
    realtimeSocket.on('connect', joinProjects);
    if (realtimeSocket.connected) joinProjects();
    return () => {
      realtimeSocket.off('connect', joinProjects);
      projectIds.forEach((id) => realtimeSocket.emit('project:leave', id));
    };
  }, [activeView, notify, projectId, projectRoomKey, realtimeSocket]);

  useEffect(() => {
    if (!notificationsOpen) return undefined;
    const closeOnOutsideClick = (event) => {
      if (!notificationsRef.current?.contains(event.target)) setNotificationsOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setNotificationsOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [notificationsOpen]);

  async function markNotificationRead(notification) {
    if (notification.readAt) return;
    notificationRequestId.current += 1;
    setNotificationsLoading(false);
    try {
      await api(`/notifications/${notification._id}/read`, { token, method: 'PATCH' });
      notificationRequestId.current += 1;
      setNotifications((items) => items.map((item) => item._id === notification._id
        ? { ...item, readAt: new Date().toISOString() }
        : item));
      setUnreadCount((count) => Math.max(0, count - 1));
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  async function markAllNotificationsRead() {
    if (!unreadCount) return;
    notificationRequestId.current += 1;
    setNotificationsLoading(false);
    try {
      await api('/notifications/read-all', { token, method: 'PATCH' });
      notificationRequestId.current += 1;
      const readAt = new Date().toISOString();
      setNotifications((items) => items.map((item) => item.readAt ? item : { ...item, readAt }));
      setUnreadCount(0);
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  async function openNotification(notification) {
    await markNotificationRead(notification);
    setNotificationsOpen(false);
    if (!notification.project?._id || !notification.task?._id) {
      notify('This task is no longer available.', 'error');
      return;
    }
    setProjectId(notification.project._id);
    setActiveView('board');
    try {
      const data = await api(`/tasks?projectId=${encodeURIComponent(notification.project._id)}`, { token });
      setTasks(data.tasks);
      const task = data.tasks.find((item) => item._id === notification.task._id);
      if (!task) {
        notify('This task is no longer available.', 'error');
        return;
      }
      setActiveTask(task);
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  async function openDashboardActivity(activity) {
    if (!activity.projectId) return;
    const project = projects.find((item) => item._id === activity.projectId);
    if (!project) {
      notify('This project is no longer available.', 'error');
      return;
    }
    setProjectId(project._id);
    setActiveView('board');
    try {
      const data = await api(`/tasks?projectId=${encodeURIComponent(project._id)}`, { token });
      setTasks(data.tasks);
      const task = data.tasks.find((item) => item._id === activity.taskId);
      if (task) setActiveTask(task);
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  useEffect(() => {
    if (!token) return;
    api('/auth/me', { token })
      .then(({ user: currentUser }) => {
        setUser(currentUser);
        localStorage.setItem('teamboard-user', JSON.stringify(currentUser));
      })
      .then(() => loadDashboard())
      .catch((error) => {
        if (error.status === 401) {
          localStorage.removeItem('teamboard-token');
          localStorage.removeItem('teamboard-user');
          setToken(null);
          setUser(null);
        } else {
          notify(error.message, 'error');
        }
      })
      .finally(() => setAuthChecked(true));
  }, [token, loadDashboard, notify]);

  const loadBoard = useCallback(async () => {
    const requestId = ++boardRequestId.current;
    if (!token || !projectId || activeView !== 'board') {
      setBoardError('');
      setBoardLoading(false);
      return;
    }
    setBoardLoading(true);
    setBoardError('');
    try {
      const [projectData, taskData] = await Promise.all([
        api(`/projects/${projectId}?includeTasks=false`, { token }),
        api(`/tasks?projectId=${encodeURIComponent(projectId)}`, { token }),
      ]);
      if (requestId !== boardRequestId.current) return;
      setTasks(taskData.tasks);
      setProjects((existing) => existing.map((project) => project._id === projectData.project._id ? projectData.project : project));
    } catch (error) {
      if (requestId === boardRequestId.current) setBoardError(error.message);
    } finally {
      if (requestId === boardRequestId.current) setBoardLoading(false);
    }
  }, [activeView, projectId, token]);

  useEffect(() => { loadBoard(); }, [loadBoard]);

  useEffect(() => {
    let current = true;
    setEditingCommentId('');
    setCommentDraft('');
    setCommentText('');
    if (!token || !activeTask) {
      setComments([]);
      setCommentsTaskId('');
      setCommentsLoading(false);
      setCommentsError('');
      return () => { current = false; };
    }
    setComments([]);
    setCommentsTaskId('');
    setCommentsError('');
    setCommentsLoading(true);
    api(`/tasks/${activeTask._id}/comments`, { token })
      .then(({ comments: items }) => {
        if (!current) return;
        setComments(items);
        setCommentsTaskId(activeTask._id);
      })
      .catch((error) => {
        if (!current) return;
        setCommentsError(error.message);
        notify(error.message, 'error');
      })
      .finally(() => { if (current) setCommentsLoading(false); });
    return () => { current = false; };
  }, [activeTask, commentsRetry, notify, token]);

  async function submitAuth(event) {
    event.preventDefault();
    const errors = {};
    const email = authForm.email.trim();
    if (authMode === 'register' && !authForm.name.trim()) {
      errors.name = 'Enter your name.';
    } else if (authMode === 'register' && authForm.name.trim().length > 80) {
      errors.name = 'Your name must be 80 characters or fewer.';
    }
    if (!email) {
      errors.email = 'Enter your email address.';
    } else if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = 'Enter a valid email address.';
    }
    if (!authForm.password) {
      errors.password = 'Enter your password.';
    } else if (authMode === 'register' && authForm.password.length < 8) {
      errors.password = 'Use at least 8 characters.';
    } else if (new TextEncoder().encode(authForm.password).length > 72) {
      errors.password = 'Password must be 72 bytes or fewer.';
    }
    setAuthErrors(errors);
    if (Object.keys(errors).length) return;

    setBusy(true);
    try {
      const endpoint = authMode === 'login' ? '/auth/login' : '/auth/register';
      const result = await api(endpoint, {
        method: 'POST',
        body: JSON.stringify({
          ...authForm,
          name: authForm.name.trim(),
          email: email.toLowerCase(),
        }),
      });
      localStorage.setItem('teamboard-token', result.token);
      localStorage.setItem('teamboard-user', JSON.stringify(result.user));
      setToken(result.token);
      setUser(result.user);
      setAuthForm({ name: '', email: '', password: '' });
      setAuthErrors({});
    } catch (error) {
      setAuthErrors({ form: error.message });
    } finally {
      setBusy(false);
    }
  }

  function signOut() {
    window.dispatchEvent(new Event('teamboard:session-expired'));
  }

  async function createProject(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = form.get('name').trim();
    if (!name) {
      event.currentTarget.elements.name.setCustomValidity('Enter a project name.');
      event.currentTarget.elements.name.reportValidity();
      return;
    }
    setBusy(true);
    try {
      const { project } = await api('/projects', {
        token,
        method: 'POST',
        body: JSON.stringify({ name, description: form.get('description').trim() }),
      });
      setProjects((items) => [project, ...items]);
      setProjectId(project._id);
      setActiveView('board');
      setModal(null);
      void loadDashboard();
      notify('Your new project is ready.');
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function updateProject(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const targetProjectId = modal?.projectId || projectId;
    const name = form.get('name').trim();
    if (!name) {
      event.currentTarget.elements.name.setCustomValidity('Enter a project name.');
      event.currentTarget.elements.name.reportValidity();
      return;
    }
    setBusy(true);
    try {
      const { project } = await api(`/projects/${targetProjectId}`, {
        token,
        method: 'PATCH',
        body: JSON.stringify({ name, description: form.get('description').trim() }),
      });
      setProjects((items) => items.map((item) => item._id === project._id ? project : item));
      setModal(null);
      void loadDashboard();
      notify('Project details saved.');
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function deleteProject(project) {
    if (!project || busy) return;
    if (!window.confirm(`Delete "${project.name}" and all its tasks and comments? This can't be undone.`)) return;
    setBusy(true);
    try {
      await api(`/projects/${project._id}`, { token, method: 'DELETE' });
      const remaining = projects.filter((item) => item._id !== project._id);
      setProjects(remaining);
      setTasks([]);
      setActiveTask(null);
      if (projectId === project._id) setProjectId(remaining[0]?._id || '');
      setModal(null);
      setActiveView('dashboard');
      void loadDashboard();
      notify('Project deleted.');
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function inviteMember(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const { project } = await api(`/projects/${projectId}/members`, {
        token,
        method: 'POST',
        body: JSON.stringify({ email: form.get('email') }),
      });
      setProjects((items) => items.map((item) => item._id === project._id ? project : item));
      setModal(null);
      void loadDashboard();
      notify('Teammate added to the project.');
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function saveTask(values) {
    setBusy(true);
    try {
      if (modal?.mode === 'create') {
        const { task } = await api('/tasks', {
          token,
          method: 'POST',
          body: JSON.stringify({ ...values, projectId }),
        });
        setTasks((items) => items.some((item) => item._id === task._id)
          ? items.map((item) => item._id === task._id ? task : item)
          : [task, ...items]);
        notify('Task added to your board.');
      } else if (modal?.task) {
        const { task } = await api(`/tasks/${modal.task._id}`, {
          token,
          method: 'PATCH',
          body: JSON.stringify(values),
        });
        setTasks((items) => items.map((item) => item._id === task._id ? task : item));
        setActiveTask(task);
        notify('Task updated.');
      }
      setModal(null);
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function moveTask(taskId, status) {
    const task = tasks.find((item) => item._id === taskId);
    if (!task || task.status === status || taskWrites.current.has(taskId)) return;
    taskWrites.current.add(taskId);
    setTasks((items) => items.map((item) => item._id === taskId ? { ...item, status } : item));
    try {
      const { task: updated } = await api(`/tasks/${taskId}`, {
        token,
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setTasks((items) => items.map((item) => item._id === updated._id ? updated : item));
    } catch (error) {
      notify(error.message, 'error');
      loadBoard();
    } finally {
      taskWrites.current.delete(taskId);
    }
  }

  async function removeTask(task) {
    if (busy) return;
    if (!window.confirm(`Delete "${task.title}"? This can't be undone.`)) return;
    setBusy(true);
    try {
      await api(`/tasks/${task._id}`, { token, method: 'DELETE' });
      setTasks((items) => items.filter((item) => item._id !== task._id));
      setActiveTask(null);
      setModal(null);
      notify('Task deleted.');
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function addComment(event) {
    event.preventDefault();
    const text = commentText.trim();
    if (!text || !activeTask || commentsLoading || commentSubmitting) return;
    if (text.length > 2000) {
      notify('Comments must be 2,000 characters or fewer.', 'error');
      return;
    }
    setCommentSubmitting(true);
    try {
      const { comment } = await api(`/tasks/${activeTask._id}/comments`, {
        token,
        method: 'POST',
        body: JSON.stringify({ text }),
      });
      setComments((items) => items.some((item) => item._id === comment._id)
        ? items
        : [...items, comment]);
      setCommentText('');
      notify('Comment added.');
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setCommentSubmitting(false);
    }
  }

  async function saveComment(event, comment) {
    event.preventDefault();
    const text = commentDraft.trim();
    if (!text || text.length > 2000) {
      notify('Comments must contain between 1 and 2,000 characters.', 'error');
      return;
    }
    setCommentSaving(true);
    try {
      const { comment: updated } = await api(`/comments/${comment._id}`, {
        token,
        method: 'PATCH',
        body: JSON.stringify({ text }),
      });
      setComments((items) => items.map((item) => item._id === updated._id ? updated : item));
      setEditingCommentId('');
      setCommentDraft('');
      notify('Comment updated.');
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setCommentSaving(false);
    }
  }

  async function deleteComment(comment) {
    if (commentDeletingId) return;
    setCommentDeletingId(comment._id);
    try {
      await api(`/comments/${comment._id}`, { token, method: 'DELETE' });
      setComments((items) => items.filter((item) => item._id !== comment._id));
      if (editingCommentId === comment._id) {
        setEditingCommentId('');
        setCommentDraft('');
      }
      notify('Comment deleted.');
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setCommentDeletingId('');
    }
  }

  const visibleTasks = useMemo(() => tasks.filter((task) => (
    `${task.title} ${task.description} ${task.assignedTo?.name || ''}`.toLowerCase().includes(query.toLowerCase())
  )), [query, tasks]);

  if (!authChecked) return <div className="loading-screen"><span className="brand-mark">t</span><div className="loading-dots">Getting your workspace ready...</div></div>;

  if (!token || !user) {
    return (
      <main className="auth-page">
        <div className="auth-decoration decor-one" /><div className="auth-decoration decor-two" />
        <section className="auth-card">
          <a className="brand auth-brand" href="#"><span className="brand-mark">t</span><span>teamboard</span></a>
          <div className="auth-kicker"><Sparkles size={14} /> YOUR WORK, IN GOOD COMPANY</div>
          <h1>{authMode === 'login' ? 'A little more in sync.' : 'Make room for good work.'}</h1>
          <p className="auth-description">{authMode === 'login' ? 'Pick up right where your team left off.' : 'A shared space for the projects you care about.'}</p>
          <form className="auth-form" onSubmit={submitAuth}>
            {authErrors.form && <div className="auth-error-banner" role="alert">{authErrors.form}</div>}
            {authMode === 'register' && <label>Your name<input required maxLength="80" autoComplete="name" aria-invalid={Boolean(authErrors.name)} aria-describedby={authErrors.name ? 'auth-name-error' : undefined} value={authForm.name} onChange={(event) => { setAuthForm({ ...authForm, name: event.target.value }); setAuthErrors((errors) => ({ ...errors, name: '', form: '' })); }} placeholder="Jamie Parker" />{authErrors.name && <span className="auth-field-error" id="auth-name-error">{authErrors.name}</span>}</label>}
            <label>Email address<input required type="email" maxLength="254" autoComplete="email" aria-invalid={Boolean(authErrors.email)} aria-describedby={authErrors.email ? 'auth-email-error' : undefined} value={authForm.email} onChange={(event) => { setAuthForm({ ...authForm, email: event.target.value }); setAuthErrors((errors) => ({ ...errors, email: '', form: '' })); }} placeholder="you@company.com" />{authErrors.email && <span className="auth-field-error" id="auth-email-error">{authErrors.email}</span>}</label>
            <label>Password<input required type="password" minLength={authMode === 'register' ? 8 : undefined} autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} aria-invalid={Boolean(authErrors.password)} aria-describedby={authErrors.password ? 'auth-password-error' : undefined} value={authForm.password} onChange={(event) => { setAuthForm({ ...authForm, password: event.target.value }); setAuthErrors((errors) => ({ ...errors, password: '', form: '' })); }} placeholder={authMode === 'register' ? 'At least 8 characters' : 'Your password'} />{authErrors.password && <span className="auth-field-error" id="auth-password-error">{authErrors.password}</span>}</label>
            <button className="button button-primary auth-submit" disabled={busy}>{busy ? 'One moment...' : authMode === 'login' ? 'Sign in' : 'Create your account'}<ArrowRight size={17} /></button>
          </form>
          <p className="auth-switch">{authMode === 'login' ? 'New to TeamBoard?' : 'Already part of the team?'} <button type="button" onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setAuthErrors({}); }}>{authMode === 'login' ? 'Create an account' : 'Sign in'}</button></p>
          <div className="auth-footnote"><span /> Thoughtful teamwork starts here</div>
        </section>
        {toast && <Toast message={toast} type={toastType} />}
      </main>
    );
  }

  const totalDone = tasks.filter((task) => task.status === 'done').length;
  const isOwner = currentProject?.owner?._id === user.id || currentProject?.owner?.id === user.id;

  return (
    <div className="app-shell">
      {mobileNav && <button className="mobile-scrim" aria-label="Close menu" onClick={() => setMobileNav(false)} />}
      <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
        <div className="sidebar-top">
          <a className="brand" href="#"><span className="brand-mark">t</span><span>teamboard</span></a>
          <button className="icon-button sidebar-collapse" aria-label="Close navigation" onClick={() => setMobileNav(false)}><X size={18} /></button>
        </div>
        <div className="workspace-switcher">
          <div className="workspace-avatar">{initials(user.name)[0]}</div>
          <div className="workspace-label"><strong>{user.name.split(' ')[0]}'s workspace</strong><span>Your shared projects</span></div>
          <ChevronDown size={15} className="muted-icon" />
        </div>
        <nav className="main-nav" aria-label="Main navigation">
          <button className={`nav-link ${activeView === 'dashboard' ? 'nav-link-active' : ''}`} onClick={() => { setActiveView('dashboard'); setMobileNav(false); void loadDashboard(); }}><LayoutDashboard size={17} /><span>My workspace</span><span className="nav-count">{projects.length}</span></button>
          <button className={`nav-link ${activeView === 'board' ? 'nav-link-active' : ''}`} onClick={() => { if (projectId) setActiveView('board'); setQuery(''); setMobileNav(false); }}><Columns3 size={17} /><span>Board view</span></button>
        </nav>
        <div className="sidebar-section-title"><span>YOUR PROJECTS</span><button className="tiny-icon" aria-label="Create project" onClick={() => setModal({ mode: 'project' })}><Plus size={16} /></button></div>
        <nav className="project-nav" aria-label="Projects">
          {projects.map((project, index) => (
            <button key={project._id} className={`project-link ${activeView === 'board' && project._id === projectId ? 'project-link-active' : ''}`} onClick={() => { setProjectId(project._id); setActiveView('board'); setMobileNav(false); }}>
              <span className={`project-dot dot-${index % 4}`} /> <span className="project-name">{project.name}</span>
              {project._id === projectId && <span className="project-mini-count">{tasks.length}</span>}
            </button>
          ))}
          <button className="add-project-link" onClick={() => setModal({ mode: 'project' })}><span><Plus size={14} /></span> Add a project</button>
        </nav>
        <div className="sidebar-bottom">
          <div className="upgrade-card"><div className="upgrade-icon"><Sparkles size={16} /></div><strong>Good work deserves a good home.</strong><p>Invite your crew and make something great together.</p>{isOwner && <button onClick={() => setModal({ mode: 'invite' })}>Invite your team <ArrowRight size={14} /></button>}</div>
          <button className="nav-link bottom-link" onClick={() => notify('Need a hand? Ask your project owner for help.', 'info')}><CircleHelp size={17} /><span>Help & resources</span><ArrowRight size={13} className="help-arrow" /></button>
          <div className="profile-row">
            <Avatar name={user.name} size="small" />
            <div className="profile-info"><strong>{user.name}</strong><span>{user.email}</span></div>
            <button className="icon-button signout-button" aria-label="Sign out" title="Sign out" onClick={signOut}><LogOut size={16} /></button>
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb"><button className="mobile-menu icon-button" aria-label="Open menu" onClick={() => setMobileNav(true)}><Menu size={19} /></button><span>Workspace</span><span className="crumb-slash">/</span><strong>{activeView === 'board' ? currentProject?.name || 'Board' : 'My projects'}</strong></div>
          <div className="topbar-actions">
            <div className="search-box"><Search size={16} /><input aria-label="Search tasks" placeholder="Search anything..." value={query} onChange={(event) => setQuery(event.target.value)} /><kbd><Command size={11} /> K</kbd></div>
            <div className="notification-menu" ref={notificationsRef}>
              <button
                className={`icon-button notification-button ${notificationsOpen ? 'notification-open' : ''}`}
                aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}
                aria-expanded={notificationsOpen}
                aria-haspopup="dialog"
                onClick={() => {
                  const opening = !notificationsOpen;
                  setNotificationsOpen(opening);
                  if (opening) void loadNotifications();
                }}
              >
                <Bell size={18} />
                {unreadCount > 0 && <span className="notification-count">{unreadCount > 99 ? '99+' : unreadCount}</span>}
              </button>
              {notificationsOpen && (
                <section className="notification-dropdown" aria-label="Notifications">
                  <header className="notification-dropdown-header">
                    <div><h2>Notifications</h2><span>{unreadCount ? `${unreadCount} unread` : 'You’re all caught up'}</span></div>
                    <button className="mark-all-read" onClick={markAllNotificationsRead} disabled={!unreadCount}>Mark all read</button>
                  </header>
                  <div className="notification-list" aria-live="polite">
                    {notificationsLoading && notifications.length === 0 ? (
                      <div className="notification-empty">Checking for updates...</div>
                    ) : notifications.length === 0 ? (
                      <div className="notification-empty"><span className="notification-empty-icon"><Bell size={17} /></span><strong>All quiet here</strong><span>We’ll let you know when something needs your attention.</span></div>
                    ) : notifications.map((notification) => (
                      <button key={notification._id} className={`notification-item ${notification.readAt ? '' : 'notification-unread'}`} onClick={() => openNotification(notification)}>
                        <span className={`notification-type-icon notification-type-${notification.type}`}>
                          {notification.type === 'task-assigned' ? <Users size={15} /> : notification.type === 'comment-mention' ? <MessageCircle size={15} /> : <CalendarDays size={15} />}
                        </span>
                        <span className="notification-copy">
                          <span className="notification-message">{notification.message}</span>
                          <span className="notification-meta">{notification.project?.name || 'Project'} · {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}</span>
                        </span>
                        {!notification.readAt && <span className="notification-unread-dot" />}
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </div>
            <Avatar name={user.name} size="small" />
          </div>
        </header>

        {activeView === 'dashboard' ? (
          <ProjectDashboard
            projects={projects}
            user={user}
            stats={dashboardData?.stats}
            recentActivity={dashboardData?.recentActivity || []}
            notifications={notifications.slice(0, 4)}
            unreadCount={unreadCount}
            loading={dashboardLoading}
            error={dashboardError}
            onRefresh={loadDashboard}
            onCreate={() => setModal({ mode: 'project' })}
            onOpen={(project) => { setProjectId(project._id); setActiveView('board'); }}
            onEdit={(project) => setModal({ mode: 'edit-project', projectId: project._id })}
            onDelete={deleteProject}
            onOpenNotification={openNotification}
            onOpenActivity={openDashboardActivity}
          />
        ) : !currentProject ? (
          <section className="empty-workspace">
            <div className="empty-illustration"><div className="empty-sun" /><div className="empty-card"><span /><span /><span /></div><div className="empty-plant">✳</div></div>
            <span className="eyebrow">A CLEAR SPACE TO BEGIN</span>
            <h1>Your next good idea<br />starts right here.</h1>
            <p>Create a project, bring your team in, and turn the big picture into little wins.</p>
            <button className="button button-primary" onClick={() => setModal({ mode: 'project' })}><Plus size={17} /> Create your first project</button>
          </section>
        ) : (
          <div className="board-page">
            <section className="project-heading">
              <div className="heading-copy">
                <div className="eyebrow"><span className="live-dot" /> YOUR TEAM'S SHARED SPACE</div>
                <div className="title-row"><h1>{currentProject.name}</h1>{isOwner && <button className="more-button" aria-label="Edit project details" onClick={() => setModal({ mode: 'edit-project', projectId: currentProject._id })}><MoreHorizontal size={20} /></button>}</div>
                <p>{currentProject.description || 'A place for thoughtful work and great ideas.'}</p>
              </div>
              <div className="heading-actions">
                <div className="member-stack">
                  {(currentProject.members || []).slice(0, 4).map((member) => <Avatar key={member._id || member.id} name={member.name} size="small" stacked />)}
                  {(currentProject.members || []).length > 4 && <span className="extra-members">+{currentProject.members.length - 4}</span>}
                  <span className="member-label">{currentProject.members?.length || 1} {currentProject.members?.length === 1 ? 'member' : 'members'}</span>
                </div>
                {isOwner && <button className="button button-outline invite-button" onClick={() => setModal({ mode: 'invite' })}><Users size={15} /> Invite</button>}
                <button className="button button-primary add-task-top" onClick={() => setModal({ mode: 'create', status: 'todo' })}><Plus size={17} /> New task</button>
              </div>
            </section>

            <section className="board-summary">
              <div className="summary-tabs"><button className="summary-tab active"><Columns3 size={15} /> Board <span>3</span></button><button className="summary-tab" onClick={() => notify('List view is coming soon.', 'info')}><ArrowDownUp size={15} /> Timeline</button></div>
              <div className="board-tools"><span className="task-total">{tasks.length} {tasks.length === 1 ? 'task' : 'tasks'}</span><span className="tool-divider" /><span className="completion-label"><span className="completion-dot" />{totalDone} completed</span><button className="filter-button" onClick={() => notify('Search tasks by title, description, or assignee.', 'info')}><Settings2 size={15} /> Filters</button></div>
            </section>

            {boardError && <div className="board-error" role="alert"><AlertCircle size={17} /><span>{boardError}</span><button className="button button-outline" onClick={loadBoard}><RefreshCw size={13} /> Retry</button></div>}
            {boardLoading ? <BoardSkeleton /> : (
              <section className="kanban-board" aria-label="Project task board">
                {columns.map((column) => {
                  const items = visibleTasks.filter((task) => task.status === column.id);
                  return (
                    <div key={column.id} className={`kanban-column column-${column.color} ${dragging ? 'drop-ready' : ''}`} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (dragging) moveTask(dragging, column.id); setDragging(''); }}>
                      <div className="column-header">
                        <span className={`column-icon ${column.color}`}><span /></span>
                        <h2>{column.label}</h2><span className="column-count">{items.length}</span>
                        <button className="column-menu" aria-label={`${column.label} options`} onClick={() => setModal({ mode: 'create', status: column.id })}><Plus size={17} /></button>
                      </div>
                      <div className="column-subtitle">{column.hint}</div>
                      <div className="task-list">
                        {items.map((task, index) => <TaskCard key={task._id} task={task} index={index} onOpen={() => setActiveTask(task)} onDragStart={() => setDragging(task._id)} onDragEnd={() => setDragging('')} />)}
                        {items.length === 0 && !query && <div className="column-empty"><span><Sparkles size={15} /></span><small>Nothing here yet</small></div>}
                      </div>
                      <button className="add-card-button" onClick={() => setModal({ mode: 'create', status: column.id })}><Plus size={16} /> Add a task</button>
                    </div>
                  );
                })}
                {visibleTasks.length === 0 && query && <div className="no-search-results">No tasks match “{query}”.</div>}
              </section>
            )}
            <div className="board-footnote"><Sparkles size={14} /><span>Small steps make remarkable things.</span><span className="footnote-line" /></div>
          </div>
        )}
      </main>

      {modal?.mode === 'project' && <Modal title="Start a new project" subtitle="Give your next big thing a space of its own." onClose={() => setModal(null)}><form className="modal-form" onSubmit={createProject}><label>Project name<input name="name" required maxLength="100" autoFocus onInput={(event) => event.currentTarget.setCustomValidity('')} placeholder="e.g. Spring launch" /></label><label>A little context <span className="optional">(optional)</span><textarea name="description" maxLength="500" rows="3" placeholder="What are you and your team working on?" /></label><div className="modal-actions"><button className="button button-quiet" type="button" onClick={() => setModal(null)}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? 'Creating...' : 'Create project'}<ArrowRight size={15} /></button></div></form></Modal>}
      {modal?.mode === 'edit-project' && <Modal title="Project details" subtitle="Give everyone a little more context." onClose={() => setModal(null)}><form className="modal-form" onSubmit={updateProject}><label>Project name<input name="name" required maxLength="100" autoFocus onInput={(event) => event.currentTarget.setCustomValidity('')} defaultValue={projects.find((project) => project._id === modal.projectId)?.name || ''} /></label><label>A little context <span className="optional">(optional)</span><textarea name="description" maxLength="500" rows="3" defaultValue={projects.find((project) => project._id === modal.projectId)?.description || ''} /></label><div className="modal-actions"><button className="button button-danger-text" type="button" disabled={busy} onClick={() => deleteProject(projects.find((project) => project._id === modal.projectId))}>Delete project</button><span className="action-spacer" /><button className="button button-quiet" type="button" onClick={() => setModal(null)}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? 'Saving...' : 'Save details'}<Check size={15} /></button></div></form></Modal>}
      {modal?.mode === 'invite' && <Modal title="Bring your people in" subtitle={`Invite someone to collaborate on ${currentProject?.name || 'your project'}.`} onClose={() => setModal(null)}><form className="modal-form" onSubmit={inviteMember}><label>Teammate's email<input name="email" type="email" required autoFocus placeholder="teammate@company.com" /></label><p className="invite-note"><Users size={15} /> They'll need a TeamBoard account to join this project.</p><div className="modal-actions"><button className="button button-quiet" type="button" onClick={() => setModal(null)}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? 'Inviting...' : 'Send invite'}<ArrowRight size={15} /></button></div></form></Modal>}
      {modal?.mode === 'create' && <TaskForm key={`new-${modal.status}`} status={modal.status} members={currentProject?.members || []} busy={busy} onClose={() => setModal(null)} onSave={saveTask} />}
      {modal?.mode === 'edit' && <TaskForm key={`edit-${modal.task._id}`} task={{ ...modal.task, onDelete: () => removeTask(modal.task) }} members={currentProject?.members || []} busy={busy} onClose={() => setModal(null)} onSave={saveTask} />}
      {activeTask && <TaskDetail task={activeTask} comments={commentsTaskId === activeTask._id ? comments : []} commentsLoading={commentsLoading} commentsError={commentsError} onRetryComments={() => setCommentsRetry((value) => value + 1)} commentSubmitting={commentSubmitting} commentSaving={commentSaving} commentDeletingId={commentDeletingId} user={user} projectOwnerId={currentProject?.owner?._id || currentProject?.owner?.id} onClose={() => { setActiveTask(null); setEditingCommentId(''); setCommentDraft(''); }} onEdit={() => setModal({ mode: 'edit', task: activeTask })} onDelete={() => removeTask(activeTask)} onComment={addComment} commentText={commentText} setCommentText={setCommentText} onDeleteComment={deleteComment} editingCommentId={editingCommentId} commentDraft={commentDraft} setCommentDraft={setCommentDraft} onEditComment={(comment) => { setEditingCommentId(comment._id); setCommentDraft(comment.text); }} onCancelEditComment={() => { setEditingCommentId(''); setCommentDraft(''); }} onSaveComment={saveComment} />}
      {toast && <Toast message={toast} type={toastType} />}
    </div>
  );
}

function Avatar({ name, size = '', stacked = false }) {
  const colors = ['avatar-lilac', 'avatar-peach', 'avatar-mint', 'avatar-blue'];
  const color = colors[(name || '').length % colors.length];
  return <span className={`avatar ${color} avatar-${size} ${stacked ? 'avatar-stacked' : ''}`} title={name}>{initials(name)}</span>;
}

function ProjectDashboard({
  projects,
  user,
  stats,
  recentActivity,
  notifications,
  unreadCount,
  loading,
  error,
  onRefresh,
  onCreate,
  onOpen,
  onEdit,
  onDelete,
  onOpenNotification,
  onOpenActivity,
}) {
  const completion = stats?.totalTasks ? Math.round((stats.done / stats.totalTasks) * 100) : 0;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return (
    <section className="dashboard-page">
      <header className="dashboard-heading">
        <div>
          <div className="eyebrow"><span className="live-dot" /> YOUR WORKSPACE OVERVIEW</div>
          <h1>{greeting}, {user.name.split(' ')[0]}.</h1>
          <p>Here’s what’s happening across your projects. Let’s make today count.</p>
        </div>
        <div className="dashboard-heading-actions">
          <button className="icon-button dashboard-refresh" aria-label="Refresh dashboard" onClick={onRefresh} disabled={loading}><RefreshCw size={16} /></button>
          <button className="button button-primary" onClick={onCreate}><Plus size={17} /> New project</button>
        </div>
      </header>
      {error && <div className="dashboard-error" role="alert"><AlertCircle size={17} /><span>{error}</span><button onClick={onRefresh}>Try again</button></div>}
      {loading && !stats ? <DashboardSkeleton /> : error && !stats ? (
        <div className="dashboard-failure"><span><AlertCircle size={20} /></span><h2>We couldn’t load your workspace.</h2><p>{error}</p><button className="button button-primary" onClick={onRefresh}><RefreshCw size={15} /> Try again</button></div>
      ) : (
        <>
          <section className="dashboard-stat-grid" aria-label="Task statistics">
            <StatCard icon={<FolderKanban size={17} />} label="Total projects" value={stats?.totalProjects ?? projects.length} tone="lilac" helper="Across your workspace" />
            <StatCard icon={<ListTodo size={17} />} label="Active tasks" value={(stats?.todo || 0) + (stats?.inProgress || 0)} tone="blue" helper={`${stats?.todo || 0} to do · ${stats?.inProgress || 0} in progress`} />
            <StatCard icon={<CircleCheck size={17} />} label="Completed" value={stats?.done || 0} tone="green" helper={`${completion}% of all tasks`} />
            <StatCard icon={<AlertCircle size={17} />} label="Overdue" value={stats?.overdue || 0} tone="peach" helper="Needs a little attention" />
          </section>

          <div className="dashboard-main-grid">
            <section className="dashboard-panel projects-panel">
              <div className="dashboard-section-heading">
                <div><div className="panel-title-icon"><FolderKanban size={16} /></div><h2>Projects</h2><span>{projects.length}</span></div>
                <button className="dashboard-create-link" onClick={onCreate}><Plus size={15} /> New project</button>
              </div>
              {projects.length ? (
                <div className="project-grid">
                  {projects.map((project, index) => {
                    const isOwner = project.owner?._id === user.id || project.owner?.id === user.id;
                    const taskStats = project.taskStats || { total: 0, todo: 0, inProgress: 0, done: 0, overdue: 0 };
                    const projectCompletion = taskStats.total ? Math.round((taskStats.done / taskStats.total) * 100) : 0;
                    return (
                      <article className="project-tile" key={project._id} onClick={() => onOpen(project)} onKeyDown={(event) => { if (event.key === 'Enter') onOpen(project); }} tabIndex="0">
                        <div className="project-tile-top">
                          <span className={`project-tile-mark dot-${index % 4}`}><Columns3 size={17} /></span>
                          {isOwner && <div className="project-tile-actions">
                            <button className="icon-button" aria-label={`Edit ${project.name}`} onClick={(event) => { event.stopPropagation(); onEdit(project); }}><Settings2 size={16} /></button>
                            <button className="icon-button project-delete-button" aria-label={`Delete ${project.name}`} onClick={(event) => { event.stopPropagation(); onDelete(project); }}><X size={16} /></button>
                          </div>}
                        </div>
                        <h3>{project.name}</h3>
                        <p>{project.description || 'A shared space for your next good idea.'}</p>
                        <div className="project-progress"><span style={{ width: `${projectCompletion}%` }} /></div>
                        <div className="project-tile-footer">
                          <div className="project-tile-members">
                            {(project.members || []).slice(0, 3).map((member) => <Avatar key={member._id || member.id} name={member.name} size="tiny" stacked />)}
                            <span>{taskStats.total} tasks · {project.members?.length || 1} members</span>
                          </div>
                          <button className="open-board-link" onClick={(event) => { event.stopPropagation(); onOpen(project); }}>Open <ArrowRight size={14} /></button>
                        </div>
                      </article>
                    );
                  })}
                  <button className="project-tile-add" onClick={onCreate}><span><Plus size={19} /></span><strong>Start something new</strong><small>Create a project and bring your team together.</small></button>
                </div>
              ) : (
                <div className="dashboard-empty">
                  <div className="empty-illustration"><div className="empty-sun" /><div className="empty-card"><span /><span /><span /></div><div className="empty-plant">✳</div></div>
                  <span className="eyebrow">A CLEAR SPACE TO BEGIN</span>
                  <h2>Your next good idea starts right here.</h2>
                  <p>Create a project, bring your team in, and turn the big picture into little wins.</p>
                  <button className="button button-primary" onClick={onCreate}><Plus size={17} /> Create your first project</button>
                </div>
              )}
            </section>
            <aside className="dashboard-side-panels">
              <section className="dashboard-panel activity-panel">
                <div className="dashboard-section-heading">
                  <div><div className="panel-title-icon activity-title-icon"><Activity size={16} /></div><h2>Recent activity</h2></div>
                  <span className="panel-caption">Latest updates</span>
                </div>
                {recentActivity.length ? (
                  <div className="activity-list">
                    {recentActivity.slice(0, 6).map((activity) => (
                      <button className="activity-item" key={activity.id} onClick={() => onOpenActivity(activity)}>
                        <span className={`activity-icon activity-${activity.type === 'comment' || activity.type === 'comment-mention' ? 'comment' : activity.type === 'deadline-approaching' ? 'deadline' : 'task'}`}>
                          {activity.type === 'comment' || activity.type === 'comment-mention' ? <MessageCircle size={14} /> : activity.type === 'deadline-approaching' ? <CalendarDays size={14} /> : <ListTodo size={14} />}
                        </span>
                        <span className="activity-copy">
                          <span className="activity-line"><strong>{activity.actorName || 'Project update'}</strong> {activity.type === 'comment' ? 'commented on' : activity.message}</span>
                          <span className="activity-task">{activity.taskTitle}{activity.type === 'comment' ? `: ${activity.message}` : ''}</span>
                          <span className="activity-meta">{activity.projectName} · {formatDistanceToNow(new Date(activity.createdAt), { addSuffix: true })}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : <PanelEmpty icon={<Activity size={17} />} title="No activity yet" text="Updates from your projects will show up here." />}
              </section>
              <section className="dashboard-panel dashboard-notifications-panel">
                <div className="dashboard-section-heading">
                  <div><div className="panel-title-icon notification-title-icon"><Bell size={15} /></div><h2>Notifications</h2>{unreadCount > 0 && <span className="dashboard-unread">{unreadCount}</span>}</div>
                  <span className="panel-caption">Your updates</span>
                </div>
                {notifications.length ? (
                  <div className="mini-notification-list">
                    {notifications.map((notification) => (
                      <button className="mini-notification" key={notification._id} onClick={() => onOpenNotification(notification)}>
                        <span className={`mini-notification-dot ${notification.readAt ? '' : 'mini-notification-unread'}`} />
                        <span><strong>{notification.message}</strong><small>{notification.project?.name || 'Project'} · {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}</small></span>
                      </button>
                    ))}
                  </div>
                ) : <PanelEmpty icon={<Bell size={16} />} title="All caught up" text="Important updates will appear here." />}
              </section>
            </aside>
          </div>
        </>
      )}
    </section>
  );
}

function StatCard({ icon, label, value, tone, helper }) {
  return (
    <article className="stat-card">
      <div className="stat-card-top"><span className={`stat-icon stat-${tone}`}>{icon}</span><span>{label}</span></div>
      <strong>{value}</strong>
      <small>{helper}</small>
    </article>
  );
}

function PanelEmpty({ icon, title, text }) {
  return <div className="panel-empty"><span>{icon}</span><strong>{title}</strong><small>{text}</small></div>;
}

function DashboardSkeleton() {
  return (
    <div className="dashboard-skeleton" role="status" aria-label="Loading dashboard">
      <div className="skeleton-stats">{[0, 1, 2, 3].map((item) => <span key={item} />)}</div>
      <div className="skeleton-panels"><span /><span /></div>
      <span className="visually-hidden">Loading your projects and activity...</span>
    </div>
  );
}

function BoardSkeleton() {
  return (
    <section className="kanban-board board-skeleton" role="status" aria-label="Loading project board">
      {columns.map((column) => <div className="kanban-column" key={column.id}><div className="skeleton-column-heading" /><div className="skeleton-task-card" /><div className="skeleton-task-card" /><div className="skeleton-add" /><span className="visually-hidden">Loading {column.label} tasks...</span></div>)}
    </section>
  );
}

function TaskCard({ task, index, onOpen, onDragStart, onDragEnd }) {
  const dueDate = task.dueDate ? parseISO(task.dueDate.slice(0, 10)) : null;
  const overdue = dueDate && isPast(dueDate) && !isToday(dueDate) && task.status !== 'done';
  const priority = priorities.find((item) => item.id === task.priority) || priorities[1];
  return (
    <article className={`task-card card-entry-${index % 3}`} draggable onDragStart={onDragStart} onDragEnd={onDragEnd} onClick={onOpen} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(); } }} tabIndex="0">
      <div className="task-card-top"><span className={`task-priority task-priority-${priority.id}`}>{priority.label} priority</span><button className="task-more" aria-label="Open task details" onClick={(event) => { event.stopPropagation(); onOpen(); }}><MoreHorizontal size={17} /></button></div>
      <h3>{task.title}</h3>
      {task.description && <p className="task-description">{task.description}</p>}
      <div className="task-card-bottom">
        <div className={`task-due ${overdue ? 'due-overdue' : ''}`}>{dueDate ? <><CalendarDays size={13} />{format(dueDate, 'MMM d')}</> : <><span className="task-card-mini-dot" /> No deadline</>}</div>
        <div className="task-card-people">
          {task.assignedTo && <Avatar name={task.assignedTo.name} size="tiny" />}
          <span className="comment-indicator"><MessageCircle size={13} /></span>
        </div>
      </div>
    </article>
  );
}

function Modal({ title, subtitle, onClose, children }) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-header"><div><h2 id="modal-title">{title}</h2><p>{subtitle}</p></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button></div>{children}</section></div>;
}

function TaskForm({ task, status = 'todo', members, busy, onClose, onSave }) {
  const [form, setForm] = useState({
    title: task?.title || '',
    description: task?.description || '',
    status: task?.status || status,
    priority: task?.priority || 'medium',
    assignedTo: task?.assignedTo?._id || '',
    dueDate: task?.dueDate ? task.dueDate.slice(0, 10) : '',
  });
  function submit(event) {
    event.preventDefault();
    if (!form.title.trim()) {
      event.currentTarget.elements.title.setCustomValidity('Enter a task name.');
      event.currentTarget.elements.title.reportValidity();
      return;
    }
    onSave({
      ...form,
      title: form.title.trim(),
      description: form.description.trim(),
      assignedTo: form.assignedTo || null,
      dueDate: form.dueDate || null,
    });
  }
  return <Modal title={task ? 'A little task tune-up' : 'Add a task'} subtitle={task ? 'Keep the details fresh as things move along.' : 'Every big thing is made of little things.'} onClose={onClose}><form className="modal-form" onSubmit={submit}><label>Task name<input name="title" required maxLength="160" autoFocus value={form.title} onChange={(event) => { event.currentTarget.setCustomValidity(''); setForm({ ...form, title: event.target.value }); }} placeholder="What needs to get done?" /></label><label>Details <span className="optional">(optional)</span><textarea rows="3" maxLength="2000" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Add a few more details..." /></label><div className="form-row"><label>Column<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>{columns.map((column) => <option value={column.id} key={column.id}>{column.label}</option>)}</select></label><label>Priority<select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}>{priorities.map((priority) => <option value={priority.id} key={priority.id}>{priority.label}</option>)}</select></label></div><div className="form-row"><label>Due date<input type="date" value={form.dueDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} /></label><label>Assigned to<select value={form.assignedTo} onChange={(event) => setForm({ ...form, assignedTo: event.target.value })}><option value="">No one just yet</option>{members.map((member) => <option key={member._id || member.id} value={member._id || member.id}>{member.name}</option>)}</select></label></div><div className="modal-actions">{task && <button className="button button-danger-text" type="button" disabled={busy} onClick={task.onDelete}>Delete task</button>}<span className="action-spacer" /><button className="button button-quiet" type="button" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? 'Saving...' : task ? 'Save changes' : 'Add task'}<Check size={15} /></button></div></form></Modal>;
}

function TaskDetail({
  task,
  comments,
  commentsLoading,
  commentsError,
  onRetryComments,
  commentSubmitting,
  commentSaving,
  commentDeletingId,
  user,
  projectOwnerId,
  onClose,
  onEdit,
  onDelete,
  onComment,
  commentText,
  setCommentText,
  onDeleteComment,
  editingCommentId,
  commentDraft,
  setCommentDraft,
  onEditComment,
  onCancelEditComment,
  onSaveComment,
}) {
  const assigned = task.assignedTo;
  const due = task.dueDate ? parseISO(task.dueDate.slice(0, 10)) : null;
  const priority = priorities.find((item) => item.id === task.priority) || priorities[1];
  return (
    <div className="modal-backdrop detail-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="detail-panel" role="dialog" aria-modal="true" aria-labelledby="detail-title">
        <header className="detail-header">
          <span className="detail-project"><span className="live-dot" /> TASK DETAILS</span>
          <div className="detail-header-actions">
            <button className="icon-button" aria-label="Edit task" onClick={onEdit}><Settings2 size={17} /></button>
            <button className="icon-button" aria-label="Close details" onClick={onClose}><X size={18} /></button>
          </div>
        </header>
        <div className="detail-content">
          <span className={`detail-status status-${task.status}`}>{columns.find((column) => column.id === task.status)?.label}</span>
          <h2 id="detail-title">{task.title}</h2>
          <p className="detail-description">{task.description || 'No extra details yet. Edit this task to add some context.'}</p>
          <div className="detail-meta">
            <div className="detail-meta-row"><span className="meta-icon"><Sparkles size={15} /></span><span>Priority</span><span className={`task-priority task-priority-${priority.id}`}>{priority.label}</span></div>
            <div className="detail-meta-row"><span className="meta-icon"><Users size={15} /></span><span>Assigned to</span>{assigned ? <span className="meta-person"><Avatar name={assigned.name} size="tiny" />{assigned.name}</span> : <span className="meta-value">Unassigned</span>}</div>
            <div className="detail-meta-row"><span className="meta-icon"><CalendarDays size={15} /></span><span>Due date</span><span className="meta-value">{due ? format(due, 'EEEE, MMMM d, yyyy') : 'No due date'}</span></div>
            <div className="detail-meta-row"><span className="meta-icon"><Users size={15} /></span><span>Created by</span><span className="meta-person"><Avatar name={task.createdBy?.name || user.name} size="tiny" />{task.createdBy?.name || user.name}</span></div>
          </div>
          <section className="comments-section">
            <div className="comments-heading"><h3>Conversation</h3><span>{comments.length}</span></div>
            <div className="comment-list" aria-live="polite">
              {commentsLoading ? (
                <div className="no-comments"><span>Loading conversation...</span></div>
              ) : commentsError ? (
                <div className="no-comments" role="alert"><span>{commentsError}</span><button className="button button-outline" onClick={onRetryComments}>Retry</button></div>
              ) : comments.length === 0 ? (
                <div className="no-comments"><MessageCircle size={18} /><span>A good place for a thoughtful note.</span></div>
              ) : comments.map((comment) => {
                const isAuthor = comment.author?._id === user.id || comment.author?.id === user.id;
                const canDelete = isAuthor || projectOwnerId === user.id;
                const wasEdited = comment.updatedAt && new Date(comment.updatedAt).getTime() - new Date(comment.createdAt).getTime() > 1000;
                return (
                  <article className="comment" key={comment._id}>
                    <Avatar name={comment.author?.name || 'Teammate'} size="tiny" />
                    <div className="comment-body">
                      <div className="comment-author">
                        <strong>{comment.author?.name || 'Teammate'}</strong>
                          <time dateTime={comment.updatedAt || comment.createdAt} title={format(new Date(comment.updatedAt || comment.createdAt), 'PPpp')}>
                            {format(new Date(comment.updatedAt || comment.createdAt), 'MMM d · h:mm a')}
                        </time>
                        {wasEdited && <span className="comment-edited">edited</span>}
                        {isAuthor && editingCommentId !== comment._id && <button className="comment-action" onClick={() => onEditComment(comment)} aria-label="Edit comment"><Settings2 size={13} /></button>}
                        {canDelete && editingCommentId !== comment._id && <button className="comment-delete" onClick={() => onDeleteComment(comment)} aria-label="Delete comment" disabled={commentDeletingId === comment._id}>{commentDeletingId === comment._id ? '…' : <X size={13} />}</button>}
                      </div>
                      {editingCommentId === comment._id ? (
                        <form className="comment-edit-form" onSubmit={(event) => onSaveComment(event, comment)}>
                          <textarea aria-label="Edit comment" maxLength="2000" rows="3" value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} autoFocus />
                          <div className="comment-edit-actions">
                            <span>{commentDraft.length}/2000</span>
                            <button type="button" className="button button-quiet" onClick={onCancelEditComment}>Cancel</button>
                            <button type="submit" className="button button-primary" disabled={commentSaving || !commentDraft.trim() || commentDraft.length > 2000}>{commentSaving ? 'Saving...' : 'Save'}</button>
                          </div>
                        </form>
                      ) : <p>{comment.text}</p>}
                    </div>
                  </article>
                );
              })}
            </div>
            <form className="comment-form" onSubmit={onComment}>
              <Avatar name={user.name} size="tiny" />
              <div className="comment-input-wrap">
                <textarea rows="2" maxLength="2000" value={commentText} onChange={(event) => setCommentText(event.target.value)} placeholder={commentsLoading ? 'Loading conversation...' : 'Add a comment — mention someone with @email'} aria-label="Add a comment" disabled={commentsLoading || commentSubmitting} />
                <button type="submit" aria-label={commentSubmitting ? 'Sending comment' : 'Send comment'} disabled={commentSubmitting || !commentText.trim() || commentText.length > 2000}><Send size={15} /></button>
              </div>
            </form>
          </section>
          <button className="detail-delete" onClick={onDelete}>Delete this task</button>
        </div>
        <footer className="detail-footer"><span><Clock3 size={14} /> Keep the momentum going</span><button className="button button-outline" onClick={onEdit}>Edit task</button></footer>
      </section>
    </div>
  );
}

function Toast({ message, type }) {
  const isError = type === 'error';
  const isInfo = type === 'info';
  return <div className={`toast ${isError ? 'toast-error' : ''} ${isInfo ? 'toast-info' : ''}`} role={isError ? 'alert' : 'status'} aria-live={isError ? 'assertive' : 'polite'}><span className="toast-check">{isError ? <AlertCircle size={13} /> : isInfo ? <CircleHelp size={13} /> : <Check size={13} />}</span>{message}</div>;
}

export default App;
