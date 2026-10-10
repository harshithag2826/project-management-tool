let io;

export function setRealtimeServer(server) {
  io = server;
}

export function emitToProject(projectId, event, payload) {
  io?.to(`project:${projectId}`).emit(event, payload);
}

export function emitToUser(userId, event, payload) {
  io?.to(`user:${userId}`).emit(event, payload);
}
