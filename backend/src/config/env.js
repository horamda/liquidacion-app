const LOCAL_DB_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function requireEnv(name) {
  const value = process.env[name];
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new Error(`Falta la variable de entorno requerida: ${name}`);
  }

  return String(value).trim();
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function getCorsOrigins() {
  const rawValue = process.env.CORS_ORIGIN;
  if (!rawValue) return [];

  const normalized = String(rawValue).trim();
  if (!normalized || normalized === '*') return [];

  return normalized
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function shouldUseSsl(connectionString) {
  const sslOverride = process.env.DATABASE_SSL;
  if (sslOverride) {
    const normalized = sslOverride.trim().toLowerCase();
    if (['false', '0', 'disable', 'disabled', 'off'].includes(normalized)) return false;
    if (['true', '1', 'require', 'required', 'on'].includes(normalized)) return true;
  }

  if (!connectionString) return false;

  try {
    const hostname = new URL(connectionString).hostname.toLowerCase();
    return !LOCAL_DB_HOSTS.has(hostname);
  } catch {
    return true;
  }
}

module.exports = {
  getCorsOrigins,
  parsePositiveInteger,
  requireEnv,
  shouldUseSsl,
};
