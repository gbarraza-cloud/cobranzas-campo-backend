const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const cors = require('cors');
const nodemailer = require('nodemailer');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(express.static(__dirname));

// Configuración de PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Inicialización de la tabla para auditoría centralizada de Casa Central
async function initDB() {
  if (!process.env.DATABASE_URL) {
    console.log('⚠️ Sin DATABASE_URL configurada.');
    return;
  }
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS auditoria_sucursales (
        id SERIAL PRIMARY KEY,
        fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        sucursal VARCHAR(100) NOT NULL,
        usuario_remitente VARCHAR(150),
        cliente_nombre VARCHAR(255),
        cuit VARCHAR(50),
        email_destino VARCHAR(255),
        monto_deuda NUMERIC(14, 2) DEFAULT 0.0,
        estado_envio VARCHAR(50),
        detalle_error TEXT
      );
    `);
    console.log('✅ Base de Datos PostgreSQL lista para registrar actividad de sucursales.');
  } catch (err) {
    console.error('❌ Error inicializando DB:', err.message);
  }
}

// -----------------------------------------------------------------------------
// PRUEBA 1: Endpoint de Envío Individual Directo con Feedback Inmediato
// -----------------------------------------------------------------------------
app.post('/api/prueba-envio-directo', async (req, res) => {
  const { configSMTP, sucursal, cliente } = req.body;

  if (!configSMTP || !configSMTP.user || !configSMTP.pass) {
    return res.status(400).json({ exito: false, error: 'Faltan credenciales SMTP (usuario o token).' });
  }

  if (!cliente || !cliente.email || !cliente.email.includes('@')) {
    return res.status(400).json({ exito: false, error: 'Dirección de correo de destino no válida.' });
  }

  // Creación del transporte con timeout estricto de 10 segundos
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    requireTLS: true,
    auth: { user: configSMTP.user, pass: configSMTP.pass },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000
  });

  const cuerpoHTML = `
    <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
      <h2 style="color: #b80032;">CAMPO & ASOCIADOS — COMPROBANTE DE PRUEBA</h2>
      <p><strong>Sucursal Emisora:</strong> ${sucursal || 'CASA CENTRAL'}</p>
      <p><strong>Cliente:</strong> ${cliente.nombre}</p>
      <p><strong>CUIT:</strong> ${cliente.cuit || '—'}</p>
      <p><strong>Deuda Informada:</strong> $${(parseFloat(cliente.monto) || 0).toLocaleString('es-AR', {minimumFractionDigits: 2})}</p>
      <hr>
      <p style="font-size: 12px; color: #64748b;">Prueba de conexión directa y centralización de auditoría realizada el ${new Date().toLocaleString('es-AR')}.</p>
    </div>
  `;

  try {
    // 1. Verificamos credenciales SMTP primero
    await transporter.verify();

    // 2. Enviamos el mail
    const info = await transporter.sendMail({
      from: `"Campo & Asociados (${sucursal || 'Casa Central'})" <${configSMTP.user}>`,
      to: cliente.email,
      subject: `[PRUEBA SISTEMA] Estado de Cuenta — ${cliente.nombre}`,
      html: cuerpoHTML
    });

    console.log(`✅ Mail enviado con éxito a ${cliente.email} desde ${sucursal}`);

    // 3. Guardamos en PostgreSQL para que Casa Central lo pueda ver (PRUEBA 2)
    if (process.env.DATABASE_URL) {
      await pool.query(
        `INSERT INTO auditoria_sucursales 
         (sucursal, usuario_remitente, cliente_nombre, cuit, email_destino, monto_deuda, estado_envio)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [sucursal || 'CASA CENTRAL', configSMTP.user, cliente.nombre, cliente.cuit || '—', cliente.email, parseFloat(cliente.monto) || 0, 'ENVIADO']
      );
    }

    return res.json({ exito: true, messageId: info.messageId });

  } catch (error) {
    console.error(`❌ Error en prueba de envío desde ${sucursal}:`, error.message);

    // Registramos la falla en la DB para auditoría de Casa Central
    if (process.env.DATABASE_URL) {
      await pool.query(
        `INSERT INTO auditoria_sucursales 
         (sucursal, usuario_remitente, cliente_nombre, cuit, email_destino, monto_deuda, estado_envio, detalle_error)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [sucursal || 'CASA CENTRAL', configSMTP.user, cliente.nombre, cliente.cuit || '—', cliente.email, parseFloat(cliente.monto) || 0, 'FALLIDO', error.message]
      ).catch(() => {});
    }

    return res.status(500).json({ exito: false, error: error.message });
  }
});

// -----------------------------------------------------------------------------
// PRUEBA 2: Endpoint para que Casa Central vea todo el historial unificado
// -----------------------------------------------------------------------------
app.get('/api/auditoria-central', async (req, res) => {
  try {
    if (!process.env.DATABASE_URL) {
      return res.json({ exito: true, registros: [], mensaje: 'Sin conexión a base de datos.' });
    }
    const result = await pool.query('SELECT * FROM auditoria_sucursales ORDER BY fecha_registro DESC LIMIT 100');
    return res.json({ exito: true, registros: result.rows });
  } catch (err) {
    return res.status(500).json({ exito: false, error: err.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor de Pruebas iniciado en puerto ${PORT}`);
  initDB();
});
