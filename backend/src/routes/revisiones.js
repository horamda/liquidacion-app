// ── REVISIONES ────────────────────────────────────────────────
const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');

// POST /api/revisiones/:liquidacion_id
router.post('/:liquidacion_id', auth(['admin', 'super_admin']), async (req, res) => {
  const client = await db.getClient();
  try {
    const { liquidacion_id } = req.params;
    const {
      diferencia_confirmada, faltante_envases, sobrante_envases,
      merc_faltante_cant, merc_faltante_desc,
      merc_sobrante_cant, merc_sobrante_desc,
      orden_ok, observaciones,
    } = req.body;

    // Verificar plazo
    const { rows: liqRows } = await db.query(
      'SELECT *, NOW() AS ahora FROM liq_liquidaciones WHERE id = $1',
      [liquidacion_id]
    );
    const liq = liqRows[0];
    if (!liq) return res.status(404).json({ error: 'Liquidación no encontrada' });
    if (liq.estado !== 'cerrada') return res.status(400).json({ error: 'La liquidación no está cerrada' });

    const { rows: cfg } = await db.query(
      "SELECT valor FROM liq_configuracion WHERE clave = 'plazo_revision_horas'"
    );
    const plazoHs = parseFloat(cfg[0]?.valor || 24);
    const diffHs = (new Date() - new Date(liq.hora_fin)) / 3600000;
    if (diffHs > plazoHs)
      return res.status(400).json({ error: `El plazo de revisión (${plazoHs} hs) ya venció` });

    await client.query('BEGIN');

    // Upsert revisión
    const { rows } = await client.query(
      `INSERT INTO liq_revisiones
         (liquidacion_id, admin_id, diferencia_confirmada,
          faltante_envases, sobrante_envases,
          merc_faltante_cant, merc_faltante_desc,
          merc_sobrante_cant, merc_sobrante_desc,
          orden_ok, observaciones)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (liquidacion_id) DO UPDATE SET
         admin_id = EXCLUDED.admin_id,
         diferencia_confirmada = EXCLUDED.diferencia_confirmada,
         faltante_envases = EXCLUDED.faltante_envases,
         sobrante_envases = EXCLUDED.sobrante_envases,
         merc_faltante_cant = EXCLUDED.merc_faltante_cant,
         merc_faltante_desc = EXCLUDED.merc_faltante_desc,
         merc_sobrante_cant = EXCLUDED.merc_sobrante_cant,
         merc_sobrante_desc = EXCLUDED.merc_sobrante_desc,
         orden_ok = EXCLUDED.orden_ok,
         observaciones = EXCLUDED.observaciones,
         actualizado_en = NOW()
       RETURNING id`,
      [liquidacion_id, req.user.id, diferencia_confirmada,
       faltante_envases || 0, sobrante_envases || 0,
       merc_faltante_cant || 0, merc_faltante_desc || null,
       merc_sobrante_cant || 0, merc_sobrante_desc || null,
       orden_ok, observaciones || null]
    );

    // Borrar pendientes anteriores de esta liquidación y regenerar
    await client.query('DELETE FROM liq_pendientes WHERE liquidacion_id = $1', [liquidacion_id]);
    await client.query('SELECT generar_pendientes_desde_revision($1)', [rows[0].id]);

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error interno' });
  } finally {
    client.release();
  }
});

module.exports = router;
