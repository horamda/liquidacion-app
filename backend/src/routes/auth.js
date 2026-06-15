const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { legajo, password } = req.body;
    if (!legajo || !password)
      return res.status(400).json({ error: 'Legajo y contraseña requeridos' });

    const { rows } = await db.query(
      'SELECT * FROM liq_usuarios WHERE legajo = $1 AND activo = TRUE',
      [legajo.trim()]
    );
    const user = rows[0];
    if (!user)
      return res.status(401).json({ error: 'Legajo o contraseña incorrectos' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok)
      return res.status(401).json({ error: 'Legajo o contraseña incorrectos' });

    const token = jwt.sign(
      { id: user.id, nombre: user.nombre, apellido: user.apellido, rol: user.rol, legajo: user.legajo },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        nombre: user.nombre,
        apellido: user.apellido,
        rol: user.rol,
        legajo: user.legajo,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// POST /api/auth/cambiar-password
router.post('/cambiar-password', require('../middleware/auth')(), async (req, res) => {
  try {
    const { password_actual, password_nuevo } = req.body;
    if (!password_actual || !password_nuevo)
      return res.status(400).json({ error: 'Datos incompletos' });
    if (password_nuevo.length < 6)
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });

    const { rows } = await db.query('SELECT password_hash FROM liq_usuarios WHERE id = $1', [req.user.id]);
    const ok = await bcrypt.compare(password_actual, rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: 'Contraseña actual incorrecta' });

    const hash = await bcrypt.hash(password_nuevo, 10);
    await db.query('UPDATE liq_usuarios SET password_hash = $1, actualizado_en = NOW() WHERE id = $2', [hash, req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;
