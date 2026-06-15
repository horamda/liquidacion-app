const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const auth = require('../middleware/auth');

// ── PENDIENTES ────────────────────────────────────────────────
const pendientesRouter = express.Router();

// PATCH /api/pendientes/:id/resolver
pendientesRouter.patch('/:id/resolver', auth(['chofer']), async (req, res) => {
  try {
    const { rows } = await db.query(
      `UPDATE liq_pendientes SET estado = 'resuelto', resuelto_en = NOW()
        WHERE id = $1 AND chofer_id = $2 RETURNING *`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Pendiente no encontrado' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── USUARIOS ─────────────────────────────────────────────────
const usuariosRouter = express.Router();

// GET /api/usuarios (choferes activos para acompañantes)
usuariosRouter.get('/', auth(), async (req, res) => {
  try {
    const { rol } = req.query;
    const params = [];
    const filtroRol = rol ? `AND rol = $${params.push(rol)}` : '';
    const { rows } = await db.query(
      `SELECT id, nombre, apellido, dni, legajo, rol
         FROM liq_usuarios WHERE activo = TRUE ${filtroRol}
         ORDER BY apellido, nombre`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// POST /api/usuarios
usuariosRouter.post('/', auth(['super_admin']), async (req, res) => {
  try {
    const { nombre, apellido, dni, legajo, rol, password } = req.body;
    if (!nombre || !apellido || !dni || !legajo || !rol || !password)
      return res.status(400).json({ error: 'Todos los campos son requeridos' });
    if (!['chofer', 'admin', 'super_admin'].includes(rol))
      return res.status(400).json({ error: 'Rol inválido' });

    const hash = await bcrypt.hash(password, 10);
    const { rows } = await db.query(
      `INSERT INTO liq_usuarios (nombre, apellido, dni, legajo, rol, password_hash)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, nombre, apellido, dni, legajo, rol`,
      [nombre, apellido, dni, legajo, rol, hash]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'DNI o legajo ya existe' });
    console.error(err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// PATCH /api/usuarios/:id
usuariosRouter.patch('/:id', auth(['super_admin']), async (req, res) => {
  try {
    const { nombre, apellido, activo, password } = req.body;
    const updates = [];
    const params = [];

    if (nombre !== undefined)  { params.push(nombre);  updates.push(`nombre = $${params.length}`); }
    if (apellido !== undefined){ params.push(apellido); updates.push(`apellido = $${params.length}`); }
    if (activo !== undefined)  { params.push(activo);   updates.push(`activo = $${params.length}`); }
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      params.push(hash);
      updates.push(`password_hash = $${params.length}`);
    }
    if (!updates.length) return res.status(400).json({ error: 'Nada que actualizar' });

    params.push(req.params.id);
    await db.query(
      `UPDATE liq_usuarios SET ${updates.join(', ')}, actualizado_en = NOW() WHERE id = $${params.length}`,
      params
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── CAMIONES ─────────────────────────────────────────────────
const camionesRouter = express.Router();

camionesRouter.get('/', auth(), async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM liq_camiones WHERE activo = TRUE ORDER BY patente'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

camionesRouter.post('/', auth(['super_admin']), async (req, res) => {
  try {
    const { patente, descripcion } = req.body;
    if (!patente) return res.status(400).json({ error: 'Patente requerida' });
    const { rows } = await db.query(
      'INSERT INTO liq_camiones (patente, descripcion) VALUES ($1, $2) RETURNING *',
      [patente.toUpperCase(), descripcion || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Patente ya existe' });
    res.status(500).json({ error: 'Error interno' });
  }
});

camionesRouter.patch('/:id', auth(['super_admin']), async (req, res) => {
  try {
    const { descripcion, activo } = req.body;
    await db.query(
      'UPDATE liq_camiones SET descripcion = COALESCE($1, descripcion), activo = COALESCE($2, activo) WHERE id = $3',
      [descripcion, activo, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── MENSAJES ADMIN ────────────────────────────────────────────
const mensajesRouter = express.Router();

mensajesRouter.get('/', auth(['admin', 'super_admin']), async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT m.*, u.nombre || ' ' || u.apellido AS admin_nombre,
              ch.nombre || ' ' || ch.apellido AS chofer_nombre
         FROM liq_mensajes_admin m
         JOIN liq_usuarios u ON u.id = m.admin_id
         LEFT JOIN liq_usuarios ch ON ch.id = m.chofer_id
         ORDER BY m.creado_en DESC LIMIT 100`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

mensajesRouter.post('/', auth(['admin', 'super_admin']), async (req, res) => {
  try {
    const { chofer_id, titulo, cuerpo, visible_desde, visible_hasta } = req.body;
    if (!titulo || !cuerpo) return res.status(400).json({ error: 'Título y cuerpo requeridos' });
    const { rows } = await db.query(
      `INSERT INTO liq_mensajes_admin (admin_id, chofer_id, titulo, cuerpo, visible_desde, visible_hasta)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.user.id, chofer_id || null, titulo, cuerpo,
       visible_desde || new Date().toISOString().slice(0,10),
       visible_hasta || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

mensajesRouter.patch('/:id/desactivar', auth(['admin', 'super_admin']), async (req, res) => {
  try {
    await db.query('UPDATE liq_mensajes_admin SET activo = FALSE WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── CONFIGURACIÓN ─────────────────────────────────────────────
const configRouter = express.Router();

configRouter.get('/', auth(['admin', 'super_admin']), async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM liq_configuracion ORDER BY clave');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

configRouter.patch('/:clave', auth(['admin', 'super_admin']), async (req, res) => {
  try {
    const { valor } = req.body;
    await db.query(
      'UPDATE liq_configuracion SET valor = $1, actualizado_en = NOW() WHERE clave = $2',
      [valor, req.params.clave]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = { pendientesRouter, usuariosRouter, camionesRouter, mensajesRouter, configRouter };
