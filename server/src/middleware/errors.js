export function notFound(_req, res) {
  res.status(404).json({ message: 'The requested resource was not found.' });
}

export function errorHandler(error, _req, res, next) {
  if (res.headersSent) return next(error);
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'Request body contains invalid JSON.' });
  }
  if (error.type === 'entity.too.large') {
    return res.status(413).json({ message: 'Request body is too large.' });
  }
  if (error.type === 'request.aborted') {
    return res.status(400).json({ message: 'Request body was interrupted. Please try again.' });
  }
  const status = Number(error.status || error.statusCode);
  if (status >= 400 && status < 500) {
    return res.status(status).json({ message: error.message || 'The request could not be processed.' });
  }
  console.error(error);
  res.status(500).json({ message: 'An unexpected server error occurred.' });
}
