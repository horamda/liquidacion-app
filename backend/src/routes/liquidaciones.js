const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');

// ── helpers ──────────────────────────────────────────────────
async function recalcularDiferencia(liqId) {
  const { rows } = await db.query('SELECT calcular_diferencia($1) AS dif', [liqId]);
  const dif = rows[0].dif;
  await db.query(
    'UPDATE liq_liquidaciones SET diferencia_calculada = $1, actualizado_en = NOW() WHERE id = $2',
    [dif, liqId]
  );
  return dif;
}

async function liquidacionDelUsuario(liqId, userId) {
  const { rows } = await db.query(
    'SELECT * FROM liq_liquidaciones WHERE id = $1 AND chofer_id = $2',
    [liqId, userId]
  );
  return rows[0];
}

// ── GET /api/liquidaciones/dashboard ─────────────────────────
// Dashboard del chofer: última liq, historial del mes, pendientes, mensajes
router.get('/dashboard', auth(['chofer']), async (req, res) => {
  try {
    const userId = req.user.id;
    const hoy = new Date();
    const primerDiaMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().slice(0, 10);

    const [liquidaciones, pendientes, mensajes] = await Promise.all([
      db.query(
        `SELECT l.*, c.patente,
                u1.nombre || ' ' || u1.apellido AS acomp1_nombre,
                u2.nombre || ' ' || u2.apellido AS acomp2_nombre
           FROM liq_liquidaciones l
           LEFT JOIN liq_camiones c ON c.id = l.camion_id
           LEFT JOIN liq_usuarios u1 ON u1.id = l.acomp1_id
           LEFT JOIN liq_usuarios u2 ON u2.id = l.acomp2_id
          WHERE l.chofer_id = $1 AND l.fecha >= $2
          ORDER BY l.creado_en DESC`,
        [userId, primerDiaMes]
      ),
      db.query(
        `SELECT p.*, l.fecha AS liq_fecha
           FROM liq_pendientes p
           JOIN liq_liquidaciones l ON l.id = p.liquidacion_id
          WHERE p.chofer_id = $1 AND p.estado = 'pendiente'
          ORDER BY p.creado_en DESC`,
        [userId]
      ),
      db.query(
        `SELECT * FROM liq_mensajes_admin
          WHERE activo = TRUE
            AND (chofer_id = $1 OR chofer_id IS NULL)
            AND visible_desde <= CURRENT_DATE
            AND (visible_hasta IS NULL OR visible_hasta >= CURRENT_DATE)
          ORDER BY creado_en DESC`,
        [userId]
      ),
    ]);

    res.json({
      liquidaciones: liquidaciones.rows,
      pendientes: pendientes.rows,
      mensajes: mensajes.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── POST /api/liquidaciones ───────────────────────────────────
// Crear nueva liquidación
router.post('/', auth(['chofer']), async (req, res) => {
  try {
    const { camion_id, acomp1_id, acomp2_id } = req.body;
    if (!camion_id) return res.status(400).json({ error: 'Camión requerido' });

    // Verificar que no haya una liquidación abierta
    const { rows: abiertas } = await db.query(
      "SELECT id FROM liq_liquidaciones WHERE chofer_id = $1 AND estado = 'abierta'",
      [req.user.id]
    );
    if (abiertas.length > 0)
      return res.status(400).json({
        error: 'Tenés una liquidación abierta. Cerrala antes de iniciar una nueva.',
        liquidacion_abierta_id: abiertas[0].id,
      });

    const { rows } = await db.query(
      `INSERT INTO liq_liquidaciones (chofer_id, camion_id, acomp1_id, acomp2_id, hora_inicio, pantalla_actual)
       VALUES ($1, $2, $3, $4, NOW(), 2)
       RETURNING *`,
      [req.user.id, camion_id, acomp1_id || null, acomp2_id || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── GET /api/liquidaciones/:id ────────────────────────────────
router.get('/:id', auth(), async (req, res) => {
  try {
    const { id } = req.params;
    const isAdmin = ['admin', 'super_admin'].includes(req.user.rol);

    const { rows } = await db.query(
      `SELECT l.*,
              c.patente, c.descripcion AS camion_desc,
              ch.nombre || ' ' || ch.apellido AS chofer_nombre,
              u1.nombre || ' ' || u1.apellido AS acomp1_nombre,
              u2.nombre || ' ' || u2.apellido AS acomp2_nombre
         FROM liq_liquidaciones l
         JOIN liq_camiones c ON c.id = l.camion_id
         JOIN liq_usuarios ch ON ch.id = l.chofer_id
         LEFT JOIN liq_usuarios u1 ON u1.id = l.acomp1_id
         LEFT JOIN liq_usuarios u2 ON u2.id = l.acomp2_id
        WHERE l.id = $1 ${isAdmin ? '' : 'AND l.chofer_id = $2'}`,
      isAdmin ? [id] : [id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Liquidación no encontrada' });

    // Cargar datos completos
    const [entregas, items, revision] = await Promise.all([
      db.query(
        `SELECT e.*, json_agg(b ORDER BY b.denominacion DESC) AS billetes
           FROM liq_entregas_efectivo e
           LEFT JOIN liq_billetes b ON b.entrega_id = e.id
          WHERE e.liquidacion_id = $1
          GROUP BY e.id ORDER BY e.nro_entrega`,
        [id]
      ),
      db.query(
        'SELECT * FROM liq_items WHERE liquidacion_id = $1 ORDER BY tipo, orden',
        [id]
      ),
      db.query('SELECT * FROM liq_revisiones WHERE liquidacion_id = $1', [id]),
    ]);

    res.json({
      ...rows[0],
      entregas_efectivo: entregas.rows,
      items: items.rows,
      revision: revision.rows[0] || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── PATCH /api/liquidaciones/:id/pantalla ─────────────────────
// Actualizar pantalla actual (navegación)
router.patch('/:id/pantalla', auth(['chofer']), async (req, res) => {
  try {
    const liq = await liquidacionDelUsuario(req.params.id, req.user.id);
    if (!liq) return res.status(404).json({ error: 'No encontrada' });
    if (liq.estado !== 'abierta') return res.status(400).json({ error: 'Liquidación cerrada' });

    await db.query(
      'UPDATE liq_liquidaciones SET pantalla_actual = $1, actualizado_en = NOW() WHERE id = $2',
      [req.body.pantalla, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── PUT /api/liquidaciones/:id/efectivo ──────────────────────
// Guardar entregas de efectivo completas (reemplaza todas)
router.put('/:id/efectivo', auth(['chofer']), async (req, res) => {
  const client = await db.getClient();
  try {
    const liq = await liquidacionDelUsuario(req.params.id, req.user.id);
    if (!liq) return res.status(404).json({ error: 'No encontrada' });
    if (liq.estado !== 'abierta') return res.status(400).json({ error: 'Liquidación cerrada' });

    const { entregas } = req.body; // [{ nro_entrega, billetes: [{denominacion, cantidad}] }]
    await client.query('BEGIN');

    // Borrar entregas existentes (cascade elimina billetes)
    await client.query('DELETE FROM liq_entregas_efectivo WHERE liquidacion_id = $1', [req.params.id]);

    for (const entrega of entregas) {
      const totalEntrega = entrega.billetes.reduce((s, b) => s + b.denominacion * b.cantidad, 0);
      const { rows } = await client.query(
        `INSERT INTO liq_entregas_efectivo (liquidacion_id, nro_entrega, total_entrega)
         VALUES ($1, $2, $3) RETURNING id`,
        [req.params.id, entrega.nro_entrega, totalEntrega]
      );
      const entregaId = rows[0].id;
      for (const b of entrega.billetes) {
        if (b.cantidad > 0) {
          await client.query(
            `INSERT INTO liq_billetes (entrega_id, denominacion, cantidad, importe)
             VALUES ($1, $2, $3, $4)`,
            [entregaId, b.denominacion, b.cantidad, b.denominacion * b.cantidad]
          );
        }
      }
    }

    await client.query('COMMIT');
    const dif = await recalcularDiferencia(req.params.id);
    res.json({ ok: true, diferencia: dif });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error interno' });
  } finally {
    client.release();
  }
});

// ── PUT /api/liquidaciones/:id/items/:tipo ───────────────────
// Guardar items de un tipo específico (reemplaza todos los de ese tipo)
router.put('/:id/items/:tipo', auth(['chofer']), async (req, res) => {
  const TIPOS_VALIDOS = ['cc','cheque','transferencia','rechazo_parcial','rechazo_total',
                         'pospuesto','cobranza','botella','gasto','resumen'];
  const client = await db.getClient();
  try {
    const { tipo } = req.params;
    if (!TIPOS_VALIDOS.includes(tipo))
      return res.status(400).json({ error: 'Tipo inválido' });

    const liq = await liquidacionDelUsuario(req.params.id, req.user.id);
    if (!liq) return res.status(404).json({ error: 'No encontrada' });
    if (liq.estado !== 'abierta') return res.status(400).json({ error: 'Liquidación cerrada' });

    const { items } = req.body; // [{codigo_cliente, importe, descripcion}]
    await client.query('BEGIN');
    await client.query('DELETE FROM liq_items WHERE liquidacion_id = $1 AND tipo = $2', [req.params.id, tipo]);

    for (let i = 0; i < items.length; i++) {
      const { codigo_cliente, importe, descripcion } = items[i];
      if (parseFloat(importe) !== 0 || codigo_cliente) {
        await client.query(
          `INSERT INTO liq_items (liquidacion_id, tipo, codigo_cliente, importe, descripcion, orden)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [req.params.id, tipo, codigo_cliente || null, importe, descripcion || null, i]
        );
      }
    }

    await client.query('COMMIT');
    const dif = await recalcularDiferencia(req.params.id);
    res.json({ ok: true, diferencia: dif });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error interno' });
  } finally {
    client.release();
  }
});

// ── POST /api/liquidaciones/:id/cerrar ───────────────────────
router.post('/:id/cerrar', auth(['chofer']), async (req, res) => {
  try {
    const liq = await liquidacionDelUsuario(req.params.id, req.user.id);
    if (!liq) return res.status(404).json({ error: 'No encontrada' });
    if (liq.estado !== 'abierta') return res.status(400).json({ error: 'Ya está cerrada' });

    const dif = await recalcularDiferencia(req.params.id);
    const { rows: cfg } = await db.query("SELECT valor FROM liq_configuracion WHERE clave = 'umbral_retiro'");
    const umbral = parseFloat(cfg[0]?.valor || 5000);

    const faltante = dif < 0 ? Math.abs(dif) : 0;
    const mensaje = faltante <= umbral
      ? `✓ Podés retirarte. ${dif >= 0 ? 'Sobrante' : 'Faltante'}: $${Math.abs(dif).toFixed(2)}`
      : `⚠ Tenés un faltante de $${faltante.toFixed(2)}. Hablá con administración antes de retirarte.`;

    await db.query(
      `UPDATE liq_liquidaciones
          SET estado = 'cerrada', hora_fin = NOW(), pantalla_actual = 9,
              duracion_minutos = EXTRACT(EPOCH FROM (NOW() - hora_inicio))::INTEGER / 60,
              diferencia_calculada = $1, mensaje_cierre = $2, actualizado_en = NOW()
        WHERE id = $3`,
      [dif, mensaje, req.params.id]
    );

    res.json({ ok: true, diferencia: dif, mensaje_cierre: mensaje });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── POST /api/liquidaciones/:id/reabrir ──────────────────────
router.post('/:id/reabrir', auth(['admin', 'super_admin']), async (req, res) => {
  try {
    await db.query(
      "UPDATE liq_liquidaciones SET estado = 'reabierta', hora_fin = NULL, actualizado_en = NOW() WHERE id = $1",
      [req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── GET /api/liquidaciones (admin) ───────────────────────────
router.get('/', auth(['admin', 'super_admin']), async (req, res) => {
  try {
    const { fecha, chofer_id, page = 1, limit = 30 } = req.query;
    const filtroFecha = fecha || new Date().toISOString().slice(0, 10);
    const offset = (page - 1) * limit;

    const params = [filtroFecha, limit, offset];
    const filtroChofer = chofer_id ? `AND l.chofer_id = $${params.push(chofer_id)}` : '';

    const { rows } = await db.query(
      `SELECT l.*,
              c.patente,
              ch.nombre || ' ' || ch.apellido AS chofer_nombre,
              u1.nombre || ' ' || u1.apellido AS acomp1_nombre,
              u2.nombre || ' ' || u2.apellido AS acomp2_nombre,
              r.cargado_en AS revision_cargada_en
         FROM liq_liquidaciones l
         JOIN liq_camiones c ON c.id = l.camion_id
         JOIN liq_usuarios ch ON ch.id = l.chofer_id
         LEFT JOIN liq_usuarios u1 ON u1.id = l.acomp1_id
         LEFT JOIN liq_usuarios u2 ON u2.id = l.acomp2_id
         LEFT JOIN liq_revisiones r ON r.liquidacion_id = l.id
        WHERE l.fecha = $1 ${filtroChofer}
        ORDER BY l.creado_en DESC
        LIMIT $2 OFFSET $3`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;
