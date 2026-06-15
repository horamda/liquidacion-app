-- ============================================================
-- LIQUIDACIÓN DE REPARTO · del Palacio S.A.
-- Schema PostgreSQL v1.0
-- ============================================================

-- EXTENSIONES
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- CONFIGURACIÓN GLOBAL
-- ============================================================
CREATE TABLE liq_configuracion (
  clave               VARCHAR(100) PRIMARY KEY,
  valor               TEXT NOT NULL,
  descripcion         TEXT,
  actualizado_en      TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO liq_configuracion (clave, valor, descripcion) VALUES
  ('umbral_retiro',         '5000',  'Faltante máximo en $ para retirarse sin hablar con admin'),
  ('plazo_revision_horas',  '24',    'Horas que tiene el admin para cargar la revisión post-liquidación');

-- ============================================================
-- USUARIOS
-- ============================================================
CREATE TABLE liq_usuarios (
  id              SERIAL PRIMARY KEY,
  nombre          VARCHAR(100) NOT NULL,
  apellido        VARCHAR(100) NOT NULL,
  dni             VARCHAR(20)  NOT NULL UNIQUE,
  legajo          VARCHAR(30)  NOT NULL UNIQUE,
  rol             VARCHAR(20)  NOT NULL CHECK (rol IN ('chofer','admin','super_admin')),
  password_hash   TEXT         NOT NULL,
  activo          BOOLEAN      NOT NULL DEFAULT TRUE,
  creado_en       TIMESTAMPTZ  DEFAULT NOW(),
  actualizado_en  TIMESTAMPTZ  DEFAULT NOW()
);

-- Super-admin inicial (password: admin1234 — cambiar en producción)
INSERT INTO liq_usuarios (nombre, apellido, dni, legajo, rol, password_hash) VALUES
  ('Super', 'Admin', '00000000', 'SA-001',
   'super_admin', crypt('admin1234', gen_salt('bf')));

-- ============================================================
-- CAMIONES
-- ============================================================
CREATE TABLE liq_camiones (
  id              SERIAL PRIMARY KEY,
  patente         VARCHAR(20)  NOT NULL UNIQUE,
  descripcion     VARCHAR(200),
  activo          BOOLEAN      NOT NULL DEFAULT TRUE,
  creado_en       TIMESTAMPTZ  DEFAULT NOW()
);

-- ============================================================
-- MENSAJES DEL ADMIN AL CHOFER
-- ============================================================
CREATE TABLE liq_mensajes_admin (
  id              SERIAL PRIMARY KEY,
  admin_id        INTEGER      NOT NULL REFERENCES liq_usuarios(id),
  chofer_id       INTEGER      REFERENCES liq_usuarios(id),  -- NULL = todos los choferes
  titulo          VARCHAR(200) NOT NULL,
  cuerpo          TEXT         NOT NULL,
  visible_desde   DATE         NOT NULL DEFAULT CURRENT_DATE,
  visible_hasta   DATE,                                  -- NULL = sin vencimiento
  activo          BOOLEAN      NOT NULL DEFAULT TRUE,
  creado_en       TIMESTAMPTZ  DEFAULT NOW()
);

-- ============================================================
-- LIQUIDACIONES
-- ============================================================
CREATE TABLE liq_liquidaciones (
  id                    SERIAL PRIMARY KEY,
  chofer_id             INTEGER      NOT NULL REFERENCES liq_usuarios(id),
  camion_id             INTEGER      NOT NULL REFERENCES liq_camiones(id),
  acomp1_id             INTEGER      REFERENCES liq_usuarios(id),
  acomp2_id             INTEGER      REFERENCES liq_usuarios(id),
  fecha                 DATE         NOT NULL DEFAULT CURRENT_DATE,
  hora_inicio           TIMESTAMPTZ,
  hora_fin              TIMESTAMPTZ,
  duracion_minutos      INTEGER,                         -- calculado al cerrar
  estado                VARCHAR(20)  NOT NULL DEFAULT 'abierta'
                          CHECK (estado IN ('abierta','cerrada','reabierta')),
  pantalla_actual       INTEGER      NOT NULL DEFAULT 2, -- última pantalla visitada
  diferencia_calculada  NUMERIC(14,2) DEFAULT 0,         -- se recalcula en cada guardado
  mensaje_cierre        TEXT,                            -- generado al cerrar
  creado_en             TIMESTAMPTZ  DEFAULT NOW(),
  actualizado_en        TIMESTAMPTZ  DEFAULT NOW()
);

-- ============================================================
-- ENTREGAS DE EFECTIVO (múltiples por liquidación)
-- ============================================================
CREATE TABLE liq_entregas_efectivo (
  id              SERIAL PRIMARY KEY,
  liquidacion_id  INTEGER      NOT NULL REFERENCES liq_liquidaciones(id) ON DELETE CASCADE,
  nro_entrega     INTEGER      NOT NULL,                 -- 1, 2, 3…
  hora_entrega    TIMESTAMPTZ  DEFAULT NOW(),
  total_entrega   NUMERIC(14,2) DEFAULT 0,               -- calculado al guardar
  UNIQUE (liquidacion_id, nro_entrega)
);

-- ============================================================
-- BILLETES POR ENTREGA DE EFECTIVO
-- ============================================================
CREATE TABLE liq_billetes (
  id              SERIAL PRIMARY KEY,
  entrega_id      INTEGER      NOT NULL REFERENCES liq_entregas_efectivo(id) ON DELETE CASCADE,
  denominacion    INTEGER      NOT NULL CHECK (denominacion IN (20000,10000,2000,1000,500,200,100,50,20,10)),
  cantidad        INTEGER      NOT NULL DEFAULT 0,
  importe         NUMERIC(14,2) NOT NULL DEFAULT 0,      -- cantidad * denominacion
  UNIQUE (entrega_id, denominacion)
);

-- ============================================================
-- ITEMS DE LIQUIDACIÓN (CC, cheques, transferencias, rechazos, etc.)
-- ============================================================
CREATE TABLE liq_items (
  id              SERIAL PRIMARY KEY,
  liquidacion_id  INTEGER      NOT NULL REFERENCES liq_liquidaciones(id) ON DELETE CASCADE,
  tipo            VARCHAR(30)  NOT NULL CHECK (tipo IN (
                    'cc',             -- cuenta corriente
                    'cheque',
                    'transferencia',
                    'rechazo_parcial',
                    'rechazo_total',
                    'pospuesto',
                    'cobranza',
                    'botella',
                    'gasto',
                    'resumen'         -- resumen de venta
                  )),
  codigo_cliente  VARCHAR(50),
  importe         NUMERIC(14,2) NOT NULL DEFAULT 0,
  descripcion     VARCHAR(300),
  orden           INTEGER      NOT NULL DEFAULT 0,       -- para mantener el orden de carga
  creado_en       TIMESTAMPTZ  DEFAULT NOW()
);

-- ============================================================
-- REVISIONES DEL ADMIN (post-cierre)
-- ============================================================
CREATE TABLE liq_revisiones (
  id                    SERIAL PRIMARY KEY,
  liquidacion_id        INTEGER      NOT NULL REFERENCES liq_liquidaciones(id) UNIQUE,
  admin_id              INTEGER      NOT NULL REFERENCES liq_usuarios(id),
  diferencia_confirmada NUMERIC(14,2),
  faltante_envases      INTEGER      DEFAULT 0,
  sobrante_envases      INTEGER      DEFAULT 0,
  merc_faltante_cant    NUMERIC(10,2) DEFAULT 0,
  merc_faltante_desc    TEXT,
  merc_sobrante_cant    NUMERIC(10,2) DEFAULT 0,
  merc_sobrante_desc    TEXT,
  orden_ok              BOOLEAN,
  observaciones         TEXT,
  cargado_en            TIMESTAMPTZ  DEFAULT NOW(),
  actualizado_en        TIMESTAMPTZ  DEFAULT NOW()
);

-- ============================================================
-- PENDIENTES DEL CHOFER
-- ============================================================
CREATE TABLE liq_pendientes (
  id              SERIAL PRIMARY KEY,
  chofer_id       INTEGER      NOT NULL REFERENCES liq_usuarios(id),
  liquidacion_id  INTEGER      NOT NULL REFERENCES liq_liquidaciones(id),
  tipo            VARCHAR(30)  NOT NULL CHECK (tipo IN (
                    'diferencia',
                    'env_faltante',
                    'env_sobrante',
                    'merc_faltante',
                    'merc_sobrante',
                    'desorden'
                  )),
  descripcion     TEXT         NOT NULL,
  estado          VARCHAR(20)  NOT NULL DEFAULT 'pendiente'
                    CHECK (estado IN ('pendiente','resuelto')),
  resuelto_en     TIMESTAMPTZ,
  creado_en       TIMESTAMPTZ  DEFAULT NOW()
);

-- ============================================================
-- ÍNDICES
-- ============================================================
CREATE INDEX idx_liquidaciones_chofer    ON liq_liquidaciones(chofer_id);
CREATE INDEX idx_liquidaciones_fecha     ON liq_liquidaciones(fecha);
CREATE INDEX idx_liquidaciones_estado    ON liq_liquidaciones(estado);
CREATE INDEX idx_liq_items_liquidacion   ON liq_items(liquidacion_id);
CREATE INDEX idx_liq_items_tipo          ON liq_items(tipo);
CREATE INDEX idx_pendientes_chofer       ON liq_pendientes(chofer_id);
CREATE INDEX idx_pendientes_estado       ON liq_pendientes(estado);
CREATE INDEX idx_mensajes_chofer         ON liq_mensajes_admin(chofer_id);
CREATE INDEX idx_mensajes_activo         ON liq_mensajes_admin(activo);
CREATE INDEX idx_entregas_liquidacion    ON liq_entregas_efectivo(liquidacion_id);

-- ============================================================
-- FUNCIÓN: recalcular diferencia de liquidación
-- Se llama desde la API cada vez que se guarda una pantalla
-- ============================================================
CREATE OR REPLACE FUNCTION calcular_diferencia(p_liq_id INTEGER)
RETURNS NUMERIC AS $$
DECLARE
  v_efectivo      NUMERIC := 0;
  v_cheques       NUMERIC := 0;
  v_transferencias NUMERIC := 0;
  v_cc            NUMERIC := 0;
  v_cobranzas     NUMERIC := 0;
  v_botellas      NUMERIC := 0;
  v_resumenes     NUMERIC := 0;
BEGIN
  -- Efectivo: suma de todas las entregas
  SELECT COALESCE(SUM(total_entrega), 0)
    INTO v_efectivo
    FROM liq_entregas_efectivo
   WHERE liquidacion_id = p_liq_id;

  -- Items por tipo
  SELECT
    COALESCE(SUM(CASE WHEN tipo = 'cheque'        THEN importe ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN tipo = 'transferencia' THEN importe ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN tipo = 'cc'            THEN importe ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN tipo = 'cobranza'      THEN importe ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN tipo = 'botella'       THEN importe ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN tipo = 'resumen'       THEN importe ELSE 0 END), 0)
  INTO v_cheques, v_transferencias, v_cc, v_cobranzas, v_botellas, v_resumenes
  FROM liq_items
  WHERE liquidacion_id = p_liq_id;

  RETURN (v_efectivo + v_cheques + v_transferencias + v_cc + v_cobranzas + v_botellas) - v_resumenes;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- FUNCIÓN: generar liq_pendientes automáticamente tras revisión del admin
-- ============================================================
CREATE OR REPLACE FUNCTION generar_pendientes_desde_revision(p_revision_id INTEGER)
RETURNS VOID AS $$
DECLARE
  v_rev     liq_revisiones%ROWTYPE;
  v_liq     liq_liquidaciones%ROWTYPE;
  v_umbral  NUMERIC;
BEGIN
  SELECT * INTO v_rev FROM liq_revisiones WHERE id = p_revision_id;
  SELECT * INTO v_liq FROM liq_liquidaciones WHERE id = v_rev.liquidacion_id;
  SELECT valor::NUMERIC INTO v_umbral FROM liq_configuracion WHERE clave = 'umbral_retiro';

  -- Diferencia de caja
  IF v_rev.diferencia_confirmada IS NOT NULL AND ABS(v_rev.diferencia_confirmada) > v_umbral THEN
    INSERT INTO liq_pendientes (chofer_id, liquidacion_id, tipo, descripcion)
    VALUES (v_liq.chofer_id, v_liq.id, 'diferencia',
            'Diferencia de caja confirmada por administración: $' || v_rev.diferencia_confirmada);
  END IF;

  -- Faltante de envases
  IF v_rev.faltante_envases > 0 THEN
    INSERT INTO liq_pendientes (chofer_id, liquidacion_id, tipo, descripcion)
    VALUES (v_liq.chofer_id, v_liq.id, 'env_faltante',
            'Faltaron ' || v_rev.faltante_envases || ' envase(s)');
  END IF;

  -- Sobrante de envases
  IF v_rev.sobrante_envases > 0 THEN
    INSERT INTO liq_pendientes (chofer_id, liquidacion_id, tipo, descripcion)
    VALUES (v_liq.chofer_id, v_liq.id, 'env_sobrante',
            'Sobraron ' || v_rev.sobrante_envases || ' envase(s)');
  END IF;

  -- Mercadería faltante
  IF v_rev.merc_faltante_cant > 0 THEN
    INSERT INTO liq_pendientes (chofer_id, liquidacion_id, tipo, descripcion)
    VALUES (v_liq.chofer_id, v_liq.id, 'merc_faltante',
            'Mercadería faltante: ' || v_rev.merc_faltante_cant || ' unidades — ' || COALESCE(v_rev.merc_faltante_desc,''));
  END IF;

  -- Mercadería sobrante
  IF v_rev.merc_sobrante_cant > 0 THEN
    INSERT INTO liq_pendientes (chofer_id, liquidacion_id, tipo, descripcion)
    VALUES (v_liq.chofer_id, v_liq.id, 'merc_sobrante',
            'Mercadería sobrante: ' || v_rev.merc_sobrante_cant || ' unidades — ' || COALESCE(v_rev.merc_sobrante_desc,''));
  END IF;

  -- Liquidación desordenada
  IF v_rev.orden_ok = FALSE THEN
    INSERT INTO liq_pendientes (chofer_id, liquidacion_id, tipo, descripcion)
    VALUES (v_liq.chofer_id, v_liq.id, 'desorden',
            'La liquidación fue marcada como desordenada por administración');
  END IF;
END;
$$ LANGUAGE plpgsql;
