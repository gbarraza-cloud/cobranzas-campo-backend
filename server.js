const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const cors = require('cors');
const nodemailer = require('nodemailer');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use(express.static(__dirname));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function initDB() {
  if (!process.env.DATABASE_URL) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS historial_gestiones_y_eventos (
        id SERIAL PRIMARY KEY,
        sucursal VARCHAR(100) DEFAULT 'CASA CENTRAL',
        sucursal_id INT DEFAULT 1,
        cliente_id INT DEFAULT 1,
        cliente_nombre VARCHAR(255),
        cuit VARCHAR(50),
        canal VARCHAR(50),
        estado_gestion VARCHAR(100),
        fecha_promesa_pago DATE,
        notas_observaciones TEXT,
        monto_deuda NUMERIC(14, 2) DEFAULT 0.0,
        fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS historial_envios_email (
        id SERIAL PRIMARY KEY,
        cliente_nombre VARCHAR(255),
        email_destino VARCHAR(255),
        estado_envio VARCHAR(50),
        fecha_envio TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS gestion_whatsapp (
        cliente_key VARCHAR(255) PRIMARY KEY,
        estado VARCHAR(100),
        fecha_promesa VARCHAR(50),
        notas TEXT,
        ruta_comprobante TEXT,
        fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ PostgreSQL inicializado correctamente.');
  } catch (err) {
    console.log('⚠️ Aviso DB:', err.message);
  }
}

function generarCuerpoHTML(cliente, cuit, facturas, sucursal, emailRemitente) {
  let totalDeuda = 0.0;
  const filas = (facturas || []).map(f => {
    const montoNum = parseFloat(f.monto) || 0.0;
    totalDeuda += montoNum;
    return `
      <tr style='border-bottom: 1px solid #e2e8f0;'>
        <td style='padding: 10px;'>${f.cliente || cliente}</td>
        <td style='padding: 10px;'>${f.empresa || '—'}</td>
        <td style='padding: 10px;'>${f.comprobante || '—'}</td>
        <td style='padding: 10px; text-align: center;'>${f.fechaComp || '—'}</td>
        <td style='padding: 10px; text-align: center;'>${f.fechaVenc || '—'}</td>
        <td style='padding: 10px; text-align: center;'>${f.moneda || 'ARS'}</td>
        <td style='padding: 10px; text-align: right; font-weight: bold;'>$${montoNum.toLocaleString('es-AR', {minimumFractionDigits: 2})}</td>
      </tr>`;
  }).join('');

  return `<!DOCTYPE html><html lang='es'><head><meta charset='UTF-8'></head>
  <body style='margin: 0; padding: 0; background-color: #f4f6f8; font-family: Arial, sans-serif; color: #141414;'>
  <div style='background-color: #f4f6f8; width: 100%; padding: 30px 0;'>
  <table role='presentation' width='800' align='center' style='max-width: 800px; width: 100%; margin: 0 auto; background-color: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0; overflow: hidden;'>
  <tr><td style='background-color: #ffffff; padding: 25px 35px 20px 35px; border-bottom: 4px solid #b80032;'>
  <h2 style='color: #b80032; margin: 0; font-size: 22px;'>CAMPO & ASOCIADOS</h2>
  </td></tr>
  <tr><td style='padding: 25px 35px 10px 35px; text-align: center;'>
  <h1 style='margin: 0; font-size: 19px; font-weight: 800; color: #141414; text-transform: uppercase;'>ESTADO DE CUENTA Y COMPOSICIÓN DE SALDOS</h1>
  <p style='margin: 4px 0 0 0; font-size: 12px; color: #b80032; font-weight: bold;'>Notificación Automática Periódica — ${(sucursal || 'CASA CENTRAL').toUpperCase()}</p>
  </td></tr>
  <tr><td style='padding: 20px 35px 30px 35px;'>
  <div style='background-color: #f8fafc; border-left: 4px solid #b80032; padding: 12px 16px; margin-bottom: 25px; font-size: 13px; color: #334155;'>
  ℹ️ <strong>Aviso del sistema:</strong> Este es un correo automático enviado periódicamente por el sistema para mantenerlo informado sobre el estado actualizado de su cuenta.
  </div>
  <p style='margin-top: 0; font-size: 14px; color: #141414;'><strong>Estimado cliente ${cliente}:</strong></p>
  ${cuit ? `<p style='margin-top: -8px; font-size: 13px; color: #475569;'><strong>CUIT:</strong> ${cuit}</p>` : ''}
  <p style='font-size: 14px; line-height: 1.6; color: #334155;'>Por medio de la presente le recordamos los siguientes puntos a tener en cuenta para la correcta liquidación y cancelación de sus respectivas facturas pendientes:</p>
  
  <div style='font-size: 14px; font-weight: 700; color: #141414; margin: 25px 0 12px 0; padding-bottom: 6px; border-bottom: 2px solid #b80032; text-transform: uppercase;'>Composición de Saldos Pendientes</div>
  <table style='width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13px;'>
  <thead><tr style='background-color: #141414; color: #ffffff;'>
  <th style='padding: 10px; text-align: left;'>Cliente</th>
  <th style='padding: 10px; text-align: left;'>Empresa</th>
  <th style='padding: 10px; text-align: left;'>Comprobante</th>
  <th style='padding: 10px; text-align: center;'>Fecha Comp.</th>
  <th style='padding: 10px; text-align: center;'>Fecha Vto.</th>
  <th style='padding: 10px; text-align: center;'>Moneda</th>
  <th style='padding: 10px; text-align: right;'>Importe Ppal</th>
  </tr></thead>
  <tbody>${filas}</tbody>
  <tfoot><tr style='background-color: #f1f5f9; font-weight: bold; border-top: 2px solid #b80032;'>
  <td colspan='6' style='padding: 12px; text-align: right; color: #141414;'>TOTAL DEUDA PENDIENTE</td>
  <td style='padding: 12px; text-align: right; color: #b80032; font-size: 14px;'>$${totalDeuda.toLocaleString('es-AR', {minimumFractionDigits: 2})}</td>
  </tr></tfoot></table>

  <div style='background-color: #fafafa; border: 1px solid #e2e8f0; border-radius: 6px; padding: 20px; margin-top: 25px;'>
  <div style='margin-bottom: 14px; font-size: 13.5px;'><strong>1. Cheques Electrónicos (Echeqs):</strong> En caso de abonar con cheques electrónicos, por favor enviar previamente detalle de CUIT emisor, monto y fecha de cobro al correo <a href='mailto:${emailRemitente}' style='color:#b80032; font-weight: bold;'>${emailRemitente}</a>.</div>
  <div style='margin-bottom: 10px; font-size: 13.5px;'><strong>2. Transferencias Bancarias:</strong> Se detallan las CBUs habilitadas para transferencia:</div>
  <table style='width: 100%; border-collapse: collapse; font-size: 12.5px;'>
  <thead><tr style='background-color: #141414; color: #ffffff;'><th>Banco</th><th>Sucursal</th><th>Cta Cte en $</th><th>CBU</th><th>Alias</th></tr></thead>
  <tbody>
  <tr style='border-bottom: 1px solid #e2e8f0;'><td style='padding: 6px; text-align: center;'>Provincia</td><td style='padding: 6px; text-align: center;'>4004</td><td style='padding: 6px; text-align: center;'>18797/8</td><td style='padding: 6px; text-align: center;'>0140004501400401879785</td><td style='padding: 6px; text-align: center; font-weight: bold;'>HOJOBAR.PROV.BSAS</td></tr>
  <tr style='border-bottom: 1px solid #e2e8f0;'><td style='padding: 6px; text-align: center;'>Nación</td><td style='padding: 6px; text-align: center;'>San Cristóbal</td><td style='padding: 6px; text-align: center;'>65600157568</td><td style='padding: 6px; text-align: center;'>0110656120065600157682</td><td style='padding: 6px; text-align: center; font-weight: bold;'>HOJOBAR.NACION</td></tr>
  <tr style='border-bottom: 1px solid #e2e8f0;'><td style='padding: 6px; text-align: center;'>Galicia</td><td style='padding: 6px; text-align: center;'>San Cristóbal</td><td style='padding: 6px; text-align: center;'>13509/8 002/7</td><td style='padding: 6px; text-align: center;'>0070002320000013509877</td><td style='padding: 6px; text-align: center; font-weight: bold;'>HOJOBAR.GALICIA</td></tr>
  <tr style='border-bottom: 1px solid #e2e8f0;'><td style='padding: 6px; text-align: center;'>Macro</td><td style='padding: 6px; text-align: center;'>San Cristóbal</td><td style='padding: 6px; text-align: center;'>330209424970971</td><td style='padding: 6px; text-align: center;'>2850302630094249709711</td><td style='padding: 6px; text-align: center; font-weight: bold;'>HOJOBAR.MACRO</td></tr>
  </tbody></table>
  <div style='margin-top: 15px; font-size: 13.5px;'><strong>3. Informe de Pago:</strong> Todo pago realizado debe ser informado indefectiblemente a <a href='mailto:${emailRemitente}' style='color:#b80032; font-weight: bold;'>${emailRemitente}</a>.</div>
  </div></td></tr>
  <tr><td style='background-color: #f8fafc; padding: 18px; text-align: center; font-size: 11.5px; color: #94a3b8;'>
  Mensaje generado y enviado periódicamente de forma automática por el sistema de gestión el ${new Date().toLocaleDateString('es-AR')}.
  </td></tr></table></div></body></html>`;
}

// Test SMTP
app.post('/api/test-smtp', async (req, res) => {
  const { mail, pass } = req.body;
  try {
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: mail, pass: pass },
      connectionTimeout: 8000
    });
    await transporter.verify();
    return res.json({ exito: true });
  } catch (err) {
    return res.status(400).json({ exito: false, error: err.message });
  }
});

// Endpoint Enviar Emails Masivos con Reporte Explicito de Errores
app.post('/api/enviar-emails-masivos', async (req, res) => {
  const { configSMTP, listaClientes, sucursal } = req.body;

  if (!configSMTP || !configSMTP.user || !configSMTP.pass) {
    return res.status(400).json({ exito: false, error: 'Credenciales SMTP incompletas.' });
  }

  const clientesValidos = (listaClientes || []).filter(item => item && item.email && item.email.includes('@'));

  if (clientesValidos.length === 0) {
    return res.json({ exito: false, error: 'No se recibieron clientes con correo válido en el servidor.' });
  }

  // Transporte SMTP resiliente compatible con Render
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    requireTLS: true,
    auth: { user: configSMTP.user, pass: configSMTP.pass },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000
  });

  // Verificar conexión primero
  try {
    await transporter.verify();
  } catch (verifyErr) {
    console.error("❌ Error de autenticación SMTP en Gmail:", verifyErr.message);
    return res.status(400).json({
      exito: false,
      error: `Error de autenticación con Gmail (${configSMTP.user}): ${verifyErr.message}. Verifique la contraseña de aplicación.`
    });
  }

  let enviados = 0;
  let errores = [];

  for (const item of clientesValidos) {
    const htmlBody = generarCuerpoHTML(item.cliente, item.cuit, item.facturas, sucursal, configSMTP.user);

    try {
      await transporter.sendMail({
        from: `"Campo y Asociados — Cobranzas" <${configSMTP.user}>`,
        to: item.email,
        subject: `Estado de Cuenta y Composición de Saldos — ${item.cliente}`,
        html: htmlBody
      });

      enviados++;

      if (process.env.DATABASE_URL) {
        pool.query(
          'INSERT INTO historial_envios_email (cliente_nombre, email_destino, estado_envio) VALUES ($1, $2, $3)',
          [item.cliente, item.email, 'ENVIADO']
        ).catch(() => {});

        pool.query(
          `INSERT INTO historial_gestiones_y_eventos 
           (sucursal, cliente_nombre, cuit, canal, estado_gestion, notas_observaciones, monto_deuda) 
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [sucursal || 'CASA CENTRAL', item.cliente, item.cuit, 'Email', 'ENVIADO', 'Notificación automática enviada por correo', item.deudaTotal || 0.0]
        ).catch(() => {});
      }
    } catch (e) {
      console.error(`❌ Error enviando a ${item.cliente}:`, e.message);
      errores.push({ cliente: item.cliente, error: e.message });
    }
  }

  if (enviados === 0 && errores.length > 0) {
    return res.status(500).json({
      exito: false,
      error: `No se pudo entregar ningún correo. Primer error: ${errores[0].error}`
    });
  }

  return res.json({ exito: true, enviados, errores });
});

app.get('/api/historial', async (req, res) => {
  try {
    if (!process.env.DATABASE_URL) return res.json([]);
    const resultado = await pool.query('SELECT * FROM historial_gestiones_y_eventos ORDER BY fecha_registro DESC');
    return res.json(resultado.rows);
  } catch (err) {
    return res.json([]);
  }
});

app.post('/api/gestiones', async (req, res) => {
  const { sucursal, cliente_nombre, cuit, canal, estado_gestion, fecha_promesa_pago, notas_observaciones, monto_deuda } = req.body;
  try {
    const promesa = fecha_promesa_pago || null;
    if (process.env.DATABASE_URL) {
      const resultado = await pool.query(
        `INSERT INTO historial_gestiones_y_eventos 
         (sucursal, cliente_nombre, cuit, canal, estado_gestion, fecha_promesa_pago, notas_observaciones, monto_deuda) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [sucursal || 'CASA CENTRAL', cliente_nombre, cuit || '—', canal, estado_gestion, promesa, notas_observaciones, monto_deuda || 0]
      );

      if (canal === 'WhatsApp') {
        await pool.query(
          `INSERT INTO gestion_whatsapp (cliente_key, estado, fecha_promesa, notas) 
           VALUES ($1, $2, $3, $4) 
           ON CONFLICT (cliente_key) DO UPDATE SET estado = $2, fecha_promesa = $3, notas = $4`,
          [cliente_nombre.toUpperCase(), estado_gestion, promesa || '—', notas_observaciones]
        );
      }
      return res.status(201).json({ exito: true, gestion: resultado.rows[0] });
    }
    return res.status(201).json({ exito: true });
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
