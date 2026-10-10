export function getClientOrigins() {
  const configuredOrigins = (process.env.CLIENT_ORIGIN || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (configuredOrigins.length) return configuredOrigins;
  return process.env.NODE_ENV === 'production' ? [] : ['http://localhost:5173'];
}

export function validateEnvironment() {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET must contain at least 32 characters.');
  }

  const port = process.env.PORT === undefined ? 4000 : Number(process.env.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  return port;
}
