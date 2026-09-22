const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const cors = require('cors');
const { Resend } = require('resend');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(express.static(__dirname));

// Inicialización de Resend usando la Variable de Entorno segura
const resendApiKey = process.env.RESEND_API_KEY || '';
const resendClient = resendApiKey ? new Resend(resendApiKey) : null;

// Configuración de PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function initDB() {
  if (!process.env.DATABASE_URL) return;
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
    console.log('✅ Base de Datos PostgreSQL lista.');
  } catch (err) {
    console.error('❌ Error DB:', err.message);
  }
}

// PRUEBA 1: Envío Directo vía API HTTP de Resend
app.post('/api/prueba-envio-directo', async (req, res) => {
  const { sucursal, cliente, configSMTP } = req.body;
  const remitenteUser = (configSMTP && configSMTP.user) ? configSMTP.user : 'gbarraza@campoyasociados.com.ar';

  if (!resendClient) {
    return res.status(500).json({ 
      exito: false, 
      error: 'Falta configurar RESEND_API_KEY en las variables de entorno de Render.' 
    });
  }

  if (!cliente || !cliente.email || !cliente.email.includes('@')) {
    return res.status(400).json({ exito: false, error: 'Correo de destino no válido.' });
  }

  const cuerpoHTML = `
    <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
      <h2 style="color: #b80032;">CAMPO & ASOCIADOS — COMPROBANTE DE PRUEBA</h2>
      <p><strong>Sucursal Emisora:</strong> ${sucursal || 'CASA CENTRAL'}</p>
      <p><strong>Cliente:</strong> ${cliente.nombre}</p>
      <p><strong>CUIT:</strong> ${cliente.cuit || '—'}</p>
      <p><strong>Deuda Informada:</strong> $${(parseFloat(cliente.monto) || 0).toLocaleString('es-AR', {minimumFractionDigits: 2})}</p>
      <hr>
      <p style="font-size: 12px; color: #64748b;">Prueba enviada exitosamente el ${new Date().toLocaleString('es-AR')}.</p>
    </div>
  `;

  try {
    // Si tu dominio ya está verificado en Resend, usa remitenteUser (ej: gbarraza@campoyasociados.com.ar).
    // Si aún no terminaste de verificar los registros DNS, Resend usará temporalmente el correo de prueba.
    const senderAddress = remitenteUser.endsWith('@campoyasociados.com.ar') 
      ? `Campo & Asociados <${remitenteUser}>` 
      : 'Campo & Asociados <onboarding@resend.dev>';

    const data = await resendClient.emails.send({
      from: senderAddress,
      to: [cliente.email],
      subject: `[PRUEBA SISTEMA] Estado de Cuenta — ${cliente.nombre}`,
      html: cuerpoHTML
    });

    if (data.error) {
      throw new Error(data.error.message);
    }

    console.log(`✅ Mail enviado con éxito a ${cliente.email} desde ${sucursal}`);

    if (process.env.DATABASE_URL) {
      await pool.query(
        `INSERT INTO auditoria_sucursales 
         (sucursal, usuario_remitente, cliente_nombre, cuit, email_destino, monto_deuda, estado_envio)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [sucursal || 'CASA CENTRAL', remitenteUser, cliente.nombre, cliente.cuit || '—', cliente.email, parseFloat(cliente.monto) || 0, 'ENVIADO']
      );
    }

    return res.json({ exito: true, messageId: data.id });

  } catch (error) {
    console.error(`❌ Error enviando correo desde ${sucursal}:`, error.message);

    if (process.env.DATABASE_URL) {
      await pool.query(
        `INSERT INTO auditoria_sucursales 
         (sucursal, usuario_remitente, cliente_nombre, cuit, email_destino, monto_deuda, estado_envio, detalle_error)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [sucursal || 'CASA CENTRAL', remitenteUser, cliente.nombre, cliente.cuit || '—', cliente.email, parseFloat(cliente.monto) || 0, 'FALLIDO', error.message]
      ).catch(() => {});
    }

    return res.status(500).json({ exito: false, error: error.message });
  }
});

// PRUEBA 2: Auditoría para Casa Central
app.get('/api/auditoria-central', async (req, res) => {
  try {
    if (!process.env.DATABASE_URL) {
      return res.json({ exito: true, registros: [], mensaje: 'Sin DB' });
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
  console.log(`🚀 Servidor listo escuchando en puerto ${PORT}`);
  initDB();
});
