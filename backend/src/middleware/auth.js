const jwt = require('jsonwebtoken');

const auth = (roles = []) => {
  return (req, res, next) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token requerido' });
    }
    try {
      const token = header.split(' ')[1];
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      req.user = payload;
      if (roles.length && !roles.includes(payload.rol)) {
        return res.status(403).json({ error: 'Sin permisos para esta acción' });
      }
      next();
    } catch {
      return res.status(401).json({ error: 'Token inválido o expirado' });
    }
  };
};

module.exports = auth;
