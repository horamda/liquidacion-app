require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { getCorsOrigins, parsePositiveInteger, requireEnv } = require('./config/env');

requireEnv('JWT_SECRET');
const db = require('./db');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

const corsOrigins = getCorsOrigins();
app.use(corsOrigins.length ? cors({ origin: corsOrigins }) : cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

const { pendientesRouter, usuariosRouter, camionesRouter, mensajesRouter, configRouter } = require('./routes/otros');

app.use('/api/auth', require('./routes/auth'));
app.use('/api/liquidaciones', require('./routes/liquidaciones'));
app.use('/api/revisiones', require('./routes/revisiones'));
app.use('/api/pendientes', pendientesRouter);
app.use('/api/usuarios', usuariosRouter);
app.use('/api/camiones', camionesRouter);
app.use('/api/mensajes', mensajesRouter);
app.use('/api/configuracion', configRouter);

app.get('/', (req, res) => {
  res.json({ ok: true, service: 'liquidacion-backend' });
});

app.get('/health', async (req, res) => {
  try {
    await db.ping();
    res.json({ ok: true, database: 'up' });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(503).json({ ok: false, database: 'down' });
  }
});

const PORT = parsePositiveInteger(process.env.PORT, 3001);
const server = app.listen(PORT, '0.0.0.0', () => console.log(`Servidor corriendo en puerto ${PORT}`));

const shutdown = (signal) => {
  console.log(`Received ${signal}. Closing server...`);

  const timeout = setTimeout(() => {
    console.error('Shutdown timeout reached. Forcing exit.');
    process.exit(1);
  }, 10000);
  timeout.unref();

  server.close(async (error) => {
    if (error) {
      console.error('Error closing HTTP server:', error);
      process.exit(1);
      return;
    }

    try {
      await db.close();
      clearTimeout(timeout);
      process.exit(0);
    } catch (closeError) {
      console.error('Error closing database pool:', closeError);
      process.exit(1);
    }
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
