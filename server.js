const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const nodemailer = require('nodemailer');
const Imap = require('imap');
const { simpleParser } = require('mailparser');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Inicializar tablas PostgreSQL
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS historial_gestiones_y_eventos (
        id SERIAL PRIMARY KEY,
        sucursal_id INT DEFAULT 1,
        cliente_id INT DEFAULT 1,
        cliente_nombre VARCHAR(255),
        cuit VARCHAR(50),
        canal VARCHAR(50),
        estado_gestion VARCHAR(100),
        fecha_promesa_pago DATE,
        notas_observaciones TEXT,
        monto_deuda NUMERIC(12, 2) DEFAULT 0,
        fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS historial_envios_email (
        id SERIAL PRIMARY KEY,
        cliente_nombre VARCHAR(255),
        email_destino VARCHAR(255),
        estado_envio VARCHAR(50),
        fecha_envio TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Tablas PostgreSQL verificadas en la nube.');
  } catch (err) {
    console.error('❌ Error inicializando DB:', err.message);
  }
}

// 1. Endpoint: Obtener Historial
app.get('/api/historial', async (req, res) => {
  try {
    const resultado = await pool.query('SELECT * FROM historial_gestiones_y_eventos ORDER BY fecha_registro DESC');
    res.json(resultado.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Endpoint: Guardar Gestión Individual o WPP
app.post('/api/gestiones', async (req, res) => {
  const { sucursal_id, cliente_id, cliente_nombre, cuit, canal, estado_gestion, fecha_promesa_pago, notas_observaciones, monto_deuda } = req.body;
  try {
    const promesa = fecha_promesa_pago || null;
    const resultado = await pool.query(
      `INSERT INTO historial_gestiones_y_eventos 
       (sucursal_id, cliente_id, cliente_nombre, cuit, canal, estado_gestion, fecha_promesa_pago, notas_observaciones, monto_deuda) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [sucursal_id || 1, cliente_id || 1, cliente_nombre || 'Cliente General', cuit || '—', canal, estado_gestion, promesa, notas_observaciones, monto_deuda || 0]
    );
    res.status(201).json({ exito: true, gestion: resultado.rows[0] });
  } catch (err) {
    res.status(500).json({ exito: false, error: err.message });
  }
});

// 3. Endpoint: Envío Masivo de Correos SMTP con Plantilla Oficial de Campo & Asociados
app.post('/api/enviar-emails-masivos', async (req, res) => {
  const { configSMTP, listaClientes, sucursal } = req.body;

  if (!configSMTP || !configSMTP.user || !configSMTP.pass) {
    return res.status(400).json({ exito: false, error: 'Credenciales SMTP no proporcionadas.' });
  }

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
      user: configSMTP.user,
      pass: configSMTP.pass
    }
  });

  let enviados = 0;
  let errores = [];

  for (const item of listaClientes) {
    const htmlBody = `
      <!DOCTYPE html>
      <html lang='es'>
      <head><meta charset='UTF-8'></head>
      <body style='margin: 0; padding: 0; background-color: #f4f6f8; font-family: Arial, sans-serif; color: #141414;'>
        <div style='background-color: #f4f6f8; width: 100%; padding: 30px 0;'>
          <table role='presentation' width='800' align='center' style='max-width: 800px; width: 100%; margin: 0 auto; background-color: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0; overflow: hidden;'>
            <tr><td style='background-color: #ffffff; padding: 25px 35px 20px 35px; border-bottom: 4px solid #b80032;'>
              <h2 style='color: #b80032; margin: 0;'>CAMPO & ASOCIADOS</h2>
            </td></tr>
            <tr><td style='padding: 25px 35px 10px 35px; text-align: center;'>
              <h1 style='margin: 0; font-size: 19px; font-weight: 800; color: #141414;'>ESTADO DE CUENTA Y COMPOSICIÓN DE SALDOS</h1>
              <p style='margin: 4px 0 0 0; font-size: 12px; color: #b80032; font-weight: bold;'>Notificación Automática — ${sucursal || 'CASA CENTRAL'}</p>
            </td></tr>
            <tr><td style='padding: 20px 35px 30px 35px;'>
              <p><strong>Estimado cliente ${item.cliente}:</strong></p>
              <p>CUIT: ${item.cuit || '—'}</p>
              <p>Por medio de la presente le recordamos los saldos pendientes de su cuenta:</p>
              <table style='width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 15px;'>
                <thead><tr style='background-color: #141414; color: #ffffff;'>
                  <th style='padding: 8px;'>Comprobantes Pendientes</th>
                </tr></thead>
                <tbody>
                  ${item.facturas.map(f => `<tr style='border-bottom: 1px solid #e2e8f0;'><td style='padding: 8px;'>Comprobante: ${f}</td></tr>`).join('')}
                </tbody>
              </table>
              <h3 style='color: #b80032; margin-top: 20px;'>TOTAL DEUDA PENDIENTE: $${item.deudaTotal.toLocaleString('es-AR')}</h3>
              
              <div style='background-color: #fafafa; border: 1px solid #e2e8f0; padding: 15px; border-radius: 6px; margin-top: 20px;'>
                <strong>Transferencias Bancarias (CBUs Habilitadas):</strong>
                <ul style='font-size: 12px; line-height: 1.8;'>
                  <li>Banco Provincia Alias: <strong>HOJOBAR.PROV.BSAS</strong></li>
                  <li>Banco Nación Alias: <strong>HOJOBAR.NACION</strong></li>
                  <li>Banco Galicia Alias: <strong>HOJOBAR.GALICIA</strong></li>
                  <li>Banco Macro Alias: <strong>HOJOBAR.MACRO</strong></li>
                </ul>
              </div>
            </td></tr>
          </table>
        </div>
      </body>
      </html>
    `;

    try {
      await transporter.sendMail({
        from: `"Campo y Asociados — Cobranzas" <${configSMTP.user}>`,
        to: item.email,
        subject: `Estado de Cuenta y Composición de Saldos — ${item.cliente}`,
        html: htmlBody
      });

      enviados++;
      await pool.query(
        'INSERT INTO historial_envios_email (cliente_nombre, email_destino, estado_envio) VALUES ($1, $2, $3)',
        [item.cliente, item.email, 'ENVIADO']
      );
    } catch (err) {
      errores.push({ cliente: item.cliente, error: err.message });
    }
  }

  res.json({ exito: true, enviados, errores });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Servidor activo en puerto ${PORT}`);
  initDB();
});
